"""Transport bridge only: run the unmodified RxnMiner-dev CLI and native extension.

One loopback MolParser-compatible endpoint translates UniParser SDK responses;
the actual prompts, tools, gates, compaction and continuation belong to RxnMiner.
Credentials are inherited in memory, never written into the job directory.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "RxnMiner/figure_skills/tools"))
from uniparser_client import recognize_molecules


def main():
    root, image, job = map(Path, sys.argv[1:4])
    job.mkdir(parents=True, exist_ok=True)
    recognition_key = os.environ.pop("UNIPARSER_API_KEY")
    from uniparser_tools.api.clients import UniParserClient
    usage_lock = threading.Lock()
    usage = {"attemptedImages": 0, "successfulImages": 0, "failedImages": 0}

    def meter(field=None):
        with usage_lock:
            if field:
                usage[field] += 1
            temporary = job / "recognition-usage.tmp"
            temporary.write_text(json.dumps(usage))
            temporary.replace(job / "recognition-usage.json")

    meter()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            attempted = False
            if self.path != "/extract-mol":
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", 0))
                if size <= 0 or size > 8 * 1024 * 1024:
                    raise ValueError("Invalid request size")
                images = json.loads(self.rfile.read(size))["batch_image"]
                if len(images) != 1:
                    raise ValueError("One figure required")
                with tempfile.TemporaryDirectory(prefix="rxnminer-snip-") as temporary:
                    target = Path(temporary) / "figure.png"
                    target.write_bytes(base64.b64decode(images[0], validate=True))
                    client = UniParserClient(
                        host=os.environ.get("UNIPARSER_BASE_URL", "https://uniparser.dp.tech/"),
                        api_key=recognition_key,
                    )
                    try:
                        meter("attemptedImages")
                        attempted = True
                        detections = recognize_molecules(str(target), client=client)
                        meter("successfulImages")
                        attempted = False
                    finally:
                        client.close()
                (job / "recognition.json").write_text(json.dumps({
                    "provider": "uniparser", "molecules": len(detections),
                }))
                body = json.dumps({"code": 0, "data": [detections]}).encode()
                self.send_response(200)
            except Exception:
                if attempted:
                    meter("failedImages")
                # SDK exception text can include request metadata.
                body = b'{"code":1,"error":"UniParser recognition failed"}'
                self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env["MOLPARSER_URL"] = f"http://127.0.0.1:{server.server_port}/extract-mol"
    env["RXN_SKILLS_PYTHON"] = sys.executable
    # Pi's bash tool must resolve the same Python as chemistry MCP calls.
    env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    env["PI_OFFLINE"] = "1"
    env["PI_SKIP_VERSION_CHECK"] = "1"
    env["PI_TELEMETRY"] = "0"
    command = [
        sys.executable, str(root / "bin/rxnminer"), "extract", str(image),
        "--out", str(job / "result"), "--workdir", str(job / "workspace"),
        "--provider", "openai-compat", "--model", env["Q38_MODEL"],
        "--timeout", env.get("RXNMINER_DEMO_TIMEOUT", "3600"),
    ]
    try:
        return subprocess.call(command, env=env)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())

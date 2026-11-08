#!/usr/bin/env python3
"""Verify third_party/ against its SHA-256 manifest (third_party/MANIFEST.json).

Exit 0 when every manifest entry is present with the recorded digest and no unexpected
regular file exists under a manifest-covered package; exit 1 otherwise. Byte-code caches are
ignored.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "third_party" / "MANIFEST.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if not MANIFEST.is_file():
        print(f"missing manifest: {MANIFEST}")
        return 1
    files = json.loads(MANIFEST.read_text())["files"]
    problems = []
    for relative, expected in sorted(files.items()):
        path = ROOT / relative
        if not path.is_file():
            problems.append(f"missing  {relative}")
        elif sha256(path) != expected:
            problems.append(f"changed  {relative}")
    covered = {Path(r).parts[1] for r in files}
    for package in sorted(covered):
        for path in (ROOT / "third_party" / package).rglob("*"):
            if not path.is_file() or path.suffix == ".pyc" or "__pycache__" in path.parts:
                continue
            relative = path.relative_to(ROOT).as_posix()
            if relative not in files:
                problems.append(f"untracked {relative}")
    for line in problems:
        print(line)
    print(f"third_party manifest: {len(files)} entries, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

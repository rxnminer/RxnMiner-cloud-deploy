"""bin/rxnminer composes the prompt the paper lane used, never enables adaptive thinking, and
materializes only Pi settings that Pi 0.82.1 actually reads."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "bin" / "rxnminer"
PROMPTS = ROOT / "prompts"


def _runner_namespace():
    import runpy
    return runpy.run_path(str(RUNNER), run_name="rxnminer_test")


def run_prompt(*args):
    return subprocess.run([sys.executable, str(RUNNER), "prompt", *args], capture_output=True, text=True, check=True).stdout


def test_prompt_is_instruction_plus_contract():
    instruction = (PROMPTS / "task_instruction.md").read_text()
    contract = (PROMPTS / "execution_contract.txt").read_text().strip()
    expected = (instruction + "\n\nHARBOR EXECUTION CONTRACT (mandatory):\n" + contract).rstrip("\n")
    assert run_prompt() == expected


def test_closed_book_policy_names_the_hosts_and_ends_without_trailing_newline():
    prompt = run_prompt("--closed-book", "llmapi.example.com")
    assert "NETWORK POLICY (OFFLINE RUN)" in prompt
    assert "Only model API traffic to llmapi.example.com" in prompt
    assert not prompt.endswith("\n")


def test_workdir_rewrites_every_app_path():
    prompt = run_prompt("--workdir", "/tmp/rxn-work")
    assert "/app/" not in prompt
    assert "/tmp/rxn-work/figure.png" in prompt
    assert "/tmp/rxn-work/answer.json" in prompt


def test_task_instruction_is_the_pool_instruction():
    digest = hashlib.sha256((PROMPTS / "task_instruction.md").read_bytes()).hexdigest()
    assert digest.startswith("efbdaa28f3a4"), digest


def test_model_profiles_never_force_adaptive_thinking():
    profiles = json.loads((ROOT / "runtime" / "models.example.json").read_text())["profiles"]
    assert set(profiles) >= {"anthropic", "openai-compat"}
    text = json.dumps(profiles)
    assert '"forceAdaptiveThinking": true' not in text
    assert profiles["anthropic"]["config"]["api"] == "anthropic-messages"
    assert profiles["anthropic"]["config"]["apiKey"] == "$PI_PROVIDER_API_KEY"
    assert profiles["openai-compat"]["default_model"] == "gpt-5.6-sol"
    assert profiles["openai-compat"]["config"]["models"][0]["contextWindow"] == 1_000_000


def _dry_run(tmp_path, extra_env):
    figure = tmp_path / "figure.png"
    figure.write_bytes(b"synthetic")
    fake_pi = tmp_path / "pi"
    fake_pi.write_text("#!/bin/sh\nexit 0\n")
    fake_pi.chmod(0o755)
    out = tmp_path / "out"
    env = os.environ.copy()
    env.update({"ANTHROPIC_BASE_URL": "https://example.invalid", "ANTHROPIC_API_KEY": "test-only",
                "RXNMINER_PI": str(fake_pi)})
    env.update(extra_env)
    subprocess.run(
        [sys.executable, str(RUNNER), "extract", str(figure), "--out", str(out),
         "--workdir", str(tmp_path / "app"), "--dry-run"],
        env=env, check=True, capture_output=True, text=True,
    )
    return json.loads((out / "pi-agent-dir" / "settings.json").read_text())


def test_extract_materializes_pi_defaults_when_nothing_is_overridden(tmp_path):
    """Pi's own defaults, so a plain run behaves like the benchmark sidecar (which writes no
    settings file): 5 min HTTP idle timeout, 3 provider retries, 2 s base delay, 60 s max delay."""
    settings = _dry_run(tmp_path, {})
    assert settings == {
        "httpIdleTimeoutMs": 300_000,
        "retry": {"maxRetries": 3, "baseDelayMs": 2_000, "provider": {"maxRetryDelayMs": 60_000}},
    }
    assert "timeoutMs" not in json.dumps(settings["retry"]["provider"])


def test_extract_honours_the_timeout_and_retry_overrides(tmp_path):
    settings = _dry_run(tmp_path, {
        "PI_HTTP_IDLE_TIMEOUT_MS": "600000", "PI_RETRY_MAX_RETRIES": "6",
        "PI_RETRY_BASE_DELAY_MS": "5000", "PI_RETRY_MAX_RETRY_DELAY_MS": "120000",
    })
    assert settings["httpIdleTimeoutMs"] == 600_000
    assert settings["retry"] == {"maxRetries": 6, "baseDelayMs": 5_000, "provider": {"maxRetryDelayMs": 120_000}}


def test_extract_rejects_non_integer_override(tmp_path):
    figure = tmp_path / "figure.png"
    figure.write_bytes(b"synthetic")
    env = os.environ.copy()
    env.update({"ANTHROPIC_BASE_URL": "https://example.invalid", "ANTHROPIC_API_KEY": "test-only",
                "RXNMINER_PI": "/bin/true", "PI_RETRY_MAX_RETRIES": "many"})
    result = subprocess.run(
        [sys.executable, str(RUNNER), "extract", str(figure), "--out", str(tmp_path / "out"),
         "--workdir", str(tmp_path / "app"), "--dry-run"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "PI_RETRY_MAX_RETRIES" in result.stderr


def test_completed_chemistry_steps_require_successful_results(tmp_path):
    steps = tmp_path / "session.jsonl"
    steps.write_text("\n".join([
        json.dumps({"message": {"role": "toolResult", "toolName": "assemble", "isError": False}}),
        json.dumps({"message": {"role": "toolResult", "toolName": "render_reactions", "isError": True}}),
    ]))
    completed = _runner_namespace()["completed_chemistry_steps"]([steps])
    assert completed == {"assemble"}


@pytest.mark.parametrize("reasons,tools,expected_complete,expected_fragment", [
    (["error", "stop"], ("assemble", "render_reactions"), True, None),
    (["stop", "error"], ("assemble", "render_reactions"), False, "stopReason=error"),
    (["stop"], ("assemble", "render_reactions"), True, None),
    (["stop"], ("assemble",), False, "render_reactions"),
])
def test_answer_is_always_harvested_and_completeness_is_recorded(tmp_path, monkeypatch, reasons, tools,
                                                                 expected_complete, expected_fragment):
    """A candidate answer is harvested whenever it exists; run.json says whether the run was complete."""
    runner = _runner_namespace()
    figure = tmp_path / "figure.png"
    figure.write_bytes(b"synthetic")
    out = tmp_path / "out"
    workdir = tmp_path / "app"

    def fake_pi_run(command, **kwargs):
        (workdir / "answer.json").write_text("{}")
        session_dir = Path(command[command.index("--session-dir") + 1])
        entries = [{"message": {"role": "toolResult", "toolName": tool, "isError": False}} for tool in tools]
        entries += [{"message": {"role": "assistant", "stopReason": reason}} for reason in reasons]
        entries.append({"type": "compaction", "summary": "summary after the assistant"})
        (session_dir / "session.jsonl").write_text("\n".join(map(json.dumps, entries)))
        return SimpleNamespace(returncode=0)

    monkeypatch.setenv("RXNMINER_PI", str(RUNNER))
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://example.invalid")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    monkeypatch.setattr(subprocess, "run", fake_pi_run)
    rc = runner["cmd_extract"](SimpleNamespace(
        figure=str(figure), out=str(out), workdir=str(workdir), force=False,
        provider="anthropic", model=None, closed_book=None, session_name="test",
        thinking=None, dry_run=False, timeout=60,
    ))
    assert rc == 0
    assert (out / "answer.json").exists()
    summary = json.loads((out / "run.json").read_text())
    assert summary["last_stop_reason"] == reasons[-1]
    assert summary["completed_steps"] == sorted(tools)
    assert summary["answer_complete"] is expected_complete
    if expected_complete:
        assert summary["incomplete_reason"] is None
    else:
        assert expected_fragment in summary["incomplete_reason"]


def test_runner_records_completeness_instead_of_dropping_the_answer():
    source = RUNNER.read_text()
    assert 'answer_complete = not missing_steps and last_stop_reason != "error"' in source
    assert '"incomplete_reason": incomplete_reason' in source
    assert "harvest_answer" not in source

def test_runner_publishes_the_deadline_to_the_agent():
    """The extension can only spend the last minutes wrapping up if it knows when the hour ends.

    In a finished 604-figure round every run that produced no answer had used the whole hour and was
    killed mid-work; none stopped early. So the runner passes the wall-clock end of the budget, and
    the extension refuses new chemistry inside the wrap-up window.
    """
    source = RUNNER.read_text(encoding="utf-8")
    assert '"RXNMINER_DEADLINE_EPOCH": str(int(time.time()) + int(args.timeout))' in source

    namespace = _runner_namespace()
    env = namespace["runtime_env"]({"RXNMINER_DEADLINE_EPOCH": "1003600"})
    assert env["RXNMINER_DEADLINE_EPOCH"] == "1003600"

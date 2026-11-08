"""The Skill documents keep the current agent session as the only chemical decision-maker and
separate sealed agent output from reviewed corrections. These sentences are load-bearing: the
trajectory audit and the paper's evaluation protocol rely on them. Assertions ignore line
wrapping so that reflowing a paragraph does not break them."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "reaction-extract" / "SKILL.md"
LESSONS = ROOT / "skills" / "reaction-extract" / "LESSONS.md"
EXTENSION = ROOT / "pi-extension" / "index.ts"


def flat(path: Path) -> str:
    return " ".join(path.read_text().split())


def test_skill_makes_current_session_the_only_model_decision_maker():
    source = flat(SKILL)
    assert "You, the current Claude Code, Codex, or Pi session, are the extractor" in source
    assert "one-shot VLM" in source
    assert "workflow/subagent" in source
    assert "hidden helper model" in source
    assert "This does not forbid visual reasoning" in source


def test_skill_separates_sealed_agent_score_from_reviewed_uplift():
    source = flat(SKILL)
    assert "seal the raw prediction before GT access" in source
    assert "A reviewed uplift is not agent accuracy" in source
    assert "reviewed uplift measures human correction, not agent accuracy" in flat(LESSONS)


def test_lessons_capture_multistep_reverse_chain_and_coordination_guards():
    source = flat(LESSONS)
    assert "explicit intermediate followed by a new condition arrow" in source
    assert "Exact product roundtrip is necessary but not sufficient" in source


def test_extension_requires_lessons_before_perception():
    """The perception gate in the Pi extension requires LESSONS.md to have been read in full."""
    source = EXTENSION.read_text()
    assert "reaction-extract/LESSONS.md" in source
    assert 'event.toolName !== "detect" && event.toolName !== "ocsr_detect"' in source

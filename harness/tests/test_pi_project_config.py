"""The Pi extension registers every chemistry tool the MCP server exposes, and the Skill
directory carries the two documents the extension gates on."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_TOOLS = {
    "detect",
    "ocsr_detect",
    "reverse_rgroup",
    "fill_rgroup",
    "reverse_assemble",
    "verify_smiles",
    "assemble",
    "render_reactions",
}


def test_pi_bridge_registers_all_shared_mcp_tools():
    extension = (ROOT / "pi-extension" / "index.ts").read_text()
    for name in EXPECTED_TOOLS:
        assert name in extension, name


def test_skill_directory_is_complete():
    skill = ROOT / "skills" / "reaction-extract"
    assert (skill / "SKILL.md").is_file()
    assert (skill / "LESSONS.md").is_file()
    assert (ROOT / "scripts" / "run_chem_mcp.py").is_file()
    assert (ROOT / "pi-extension" / "index.ts").is_file()


def test_length_threshold_compaction_queues_continuation_but_stop_does_not():
    """Length runs compact and resume; normal stop remains terminal."""
    source = (ROOT / "pi-extension" / "index.ts").read_text()
    assert 'pi.on("agent_end"' in source
    assert 'lengthEndedAgentRun = lastAssistant?.stopReason === "length"' in source
    assert 'pi.on("agent_settled", (_event, ctx)' in source
    assert 'ctx.compact({' in source
    assert 'onComplete: continueExtraction' in source
    assert 'event.reason !== "threshold" || event.willRetry || !lengthEndedAgentRun' in source
    assert 'deliverAs: "followUp"' in source

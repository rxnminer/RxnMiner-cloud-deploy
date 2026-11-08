"""The developer skills under .agents/skills stay discoverable and consistent."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / ".agents" / "skills"


def _frontmatter(path):
    text = path.read_text(encoding="utf-8")
    match = re.match(r"---\n(.*?)\n---\n", text, re.S)
    assert match, f"{path} has no frontmatter"
    meta = dict(line.split(":", 1) for line in match.group(1).splitlines() if ":" in line)
    return {k.strip(): v.strip() for k, v in meta.items()}, text


def test_every_developer_skill_has_a_name_and_description():
    found = sorted(p.parent.name for p in SKILLS.glob("*/SKILL.md"))
    assert {"esmiles-2.0", "molparser-extended-smiles", "fhr-rgroup", "repo-development"} <= set(found)
    for skill in found:
        meta, _ = _frontmatter(SKILLS / skill / "SKILL.md")
        assert meta.get("name") == skill
        assert meta.get("description")


def test_wrappers_point_at_existing_common_skills():
    for tool in (".claude", ".codex"):
        for wrapper in (ROOT / tool / "skills" / "domain").glob("*/SKILL.md"):
            meta, text = _frontmatter(wrapper)
            target = re.search(r"\.agents/skills/([\w.-]+)/SKILL\.md", text)
            assert target, f"{wrapper} names no common skill"
            assert (SKILLS / target.group(1) / "SKILL.md").exists()
            assert meta.get("name") == target.group(1) == wrapper.parent.name


def test_esmiles_digest_referenced_by_the_skill_exists_and_states_the_verbatim_rule():
    digest = ROOT / "skills" / "reaction-extract" / "references" / "extended-smiles-2.0.md"
    assert digest.exists()
    skill = (SKILLS / "esmiles-2.0" / "SKILL.md").read_text(encoding="utf-8")
    assert "byte-verbatim" in skill and "`smiles`" in skill
    assert "byte-verbatim" in digest.read_text(encoding="utf-8")


def test_developer_skills_are_kept_out_of_the_image():
    ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8").split()
    for entry in (".agents", ".claude", ".codex"):
        assert entry in ignore, f"{entry} must be excluded from the docker image"


def test_root_agent_files_are_linked():
    assert (ROOT / "AGENTS.md").exists()
    assert "@AGENTS.md" in (ROOT / "CLAUDE.md").read_text(encoding="utf-8")


def test_fhr_skill_names_the_real_entry_points():
    text = (SKILLS / "fhr-rgroup" / "SKILL.md").read_text(encoding="utf-8")
    for needle in ("engine/markush.py", "tool_reverse_assemble", "_reverse_assemble_row_failures",
                   "third_party/molecular_assembly_v2/src/chemistry/reverse_assembly.py",
                   "tests/test_reverse_assemble_status.py"):
        assert needle in text, needle
        path = needle.split("::")[0]
        if "/" in path:
            assert (ROOT / path).exists(), path


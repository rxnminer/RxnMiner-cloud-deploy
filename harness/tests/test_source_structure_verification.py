from pathlib import Path

from tools.chem_mcp import tool_render_reactions, tool_verify_smiles


def test_verify_smiles_writes_viewable_png_renders():
    result = tool_verify_smiles("CCOC(=O)CCCCCCCCCc1ccc(OC)cc1")

    assert result["valid"] is True
    assert result["formula"] == "C19H30O3"
    for key in ("render_png_path", "indexed_render_png_path"):
        path = Path(result[key])
        assert path.is_file()
        assert path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_assemble_inventory_does_not_trust_unseen_ocsr_provenance(tmp_path):
    import tools.chem_mcp as chem_mcp

    chem_mcp.KNOWN_OCSR_ESMI.clear()
    plan = {
        "reaction_templates": [],
        "selected_examples": [{
            "reactants": [{"smiles": "CC", "identifier": "1", "molparser_esmi": "CC", "bbox_index": 0}],
            "products": [{"smiles": "CC", "identifier": "2", "molparser_esmi": "CC", "bbox_index": 1}],
            "conditions": [],
        }],
    }
    result = chem_mcp.tool_assemble(plan=plan, out_path=str(tmp_path / "candidate.json"))

    assert result["molecule_inventory"]
    assert all(item["origin"] == "agent" for item in result["molecule_inventory"])
    assert all(item["ocsr_known_from_detect"] is False for item in result["molecule_inventory"])


def test_render_reactions_writes_a_candidate_png(tmp_path):
    v2 = tmp_path / "candidate.v2.json"
    v2.write_text(
        '{"reaction_class":"test","reaction_templates":[],"selected_examples":[{'
        '"reactants":[{"smiles":"CC","identifier":"1"}],'
        '"products":[{"smiles":"CO","identifier":"2"}],'
        '"conditions":[[{"role":"reagent","text":"test"}]],"metrics":[]}]}'
    )
    html = tmp_path / "review.html"
    result = tool_render_reactions(str(v2), out_html=str(html))

    png = Path(result["render_png_path"])
    assert html.is_file()
    assert png.is_file()
    assert png.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_verification_skill_requires_source_render_comparison():
    skill = Path(__file__).parents[1] / "skills" / "reaction-verify" / "SKILL.md"
    text = skill.read_text()

    assert "Open both `render_png_path` and `indexed_render_png_path`" in text
    assert "never overwrites the candidate" in text
    assert "FHR closure proves only deterministic consistency" in text
    assert "another model/system's candidate string" in text


def test_pi_extension_attaches_both_verification_pngs():
    extension = (Path(__file__).parents[1] / "pi-extension" / "index.ts").read_text()

    assert 'for (const key of ["render_png_path", "indexed_render_png_path"]' in extension
    assert 'type: "image"' in extension
    assert 'mimeType: "image/png"' in extension
    assert "await readFile(imagePath)" in extension


def test_pi_extension_attaches_the_render_review_png():
    extension = (Path(__file__).parents[1] / "pi-extension" / "index.ts").read_text()

    assert 'name === "render_reactions"' in extension
    assert "data.render_png_path" in extension
    assert "A missing attachment is recorded by the audit" in extension


def test_extraction_skill_has_generic_inventory_and_verification_handoff():
    skill = Path(__file__).parents[1] / "skills" / "reaction-extract" / "SKILL.md"
    text = skill.read_text()

    assert "independent source inventory" in text
    assert "emitted, explicitly excluded, masked, or unresolved" in text
    assert "automatically attached clean and atom-indexed PNG" in text
    assert "immutable candidate before any optional verification stage" in text
    assert "Mechanistic" in text and "plausibility, product closure, or FHR roundtrip alone cannot upgrade" in text

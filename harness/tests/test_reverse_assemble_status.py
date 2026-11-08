from types import SimpleNamespace

import engine.markush as markush
import tools.chem_mcp as chem_mcp


def _row(smiles, *, success=True, partial=False, missing=None, messages=None):
    return SimpleNamespace(
        template_line="template",
        assembled_smiles=smiles,
        success=success,
        partial=partial,
        missing_labels=missing or [],
        messages=messages or [],
    )


def test_engine_preserves_fhr_aggregate_diagnostics(monkeypatch):
    result = SimpleNamespace(
        ok=False,
        peel_ok=True,
        roundtrip_ok=False,
        roundtrip_note="unconnected sites",
        match_index=0,
        match_source="substructure",
        notes=["assembly incomplete"],
        reactants=[
            _row("[24*]CC[99*]", success=False, partial=True,
                 messages=["one unpaired site"]),
            _row("[H]C=C(C)C[Si](C)(C)C"),
        ],
    )
    monkeypatch.setattr(markush, "_load_reverse_assemble", lambda: lambda *a, **k: result)

    details = markush.reverse_assemble_reactants(
        "product", "product-template", ["r1", "r2"], return_details=True
    )

    assert details["ok"] is False
    assert details["peel_ok"] is True
    assert details["roundtrip_ok"] is False
    assert details["match_index"] == 0
    assert details["reactants"][0]["partial"] is True
    assert details["reactants"][0]["messages"] == ["one unpaired site"]


def test_mcp_rejects_partial_isotope_dummy_when_other_row_succeeds(monkeypatch):
    details = {
        "ok": False,
        "peel_ok": True,
        "roundtrip_ok": False,
        "roundtrip_note": "unconnected sites",
        "match_index": 0,
        "match_source": "substructure",
        "notes": ["reactant 1 incomplete"],
        "reactants": [
            {
                "smiles": "[24*]CC[99*]",
                "success": False,
                "partial": True,
                "missing_labels": [],
                "messages": ["one unpaired site"],
            },
            {
                "smiles": "[H]C=C(C)C[Si](C)(C)C",
                "success": True,
                "partial": False,
                "missing_labels": [],
                "messages": [],
            },
        ],
    }
    monkeypatch.setattr(
        markush,
        "reverse_assemble_reactants",
        lambda *a, **k: details,
    )

    result = chem_mcp.tool_reverse_assemble("product", "template", ["r1", "r2"])

    assert result["ok"] is False
    assert result["fhr"]["ok"] is False
    assert len(result["failed_reactants"]) == 1
    failure = result["failed_reactants"][0]
    assert failure["index"] == 0
    assert "unconnected_dummy_atoms" in failure["reasons"]
    assert "partial_assembly" in failure["reasons"]
    assert [d["isotope"] for d in failure["dummy_atoms"]] == [24, 99]


def test_mcp_accepts_only_complete_parseable_dummy_free_rows(monkeypatch):
    details = {
        "ok": True,
        "peel_ok": True,
        "roundtrip_ok": True,
        "roundtrip_note": "",
        "match_index": 0,
        "match_source": "substructure",
        "notes": [],
        "reactants": [
            {
                "smiles": "CCN(C)C",
                "success": True,
                "partial": False,
                "missing_labels": [],
                "messages": [],
            },
            {
                "smiles": "[H]C=C(C)C[Si](C)(C)C",
                "success": True,
                "partial": False,
                "missing_labels": [],
                "messages": [],
            },
        ],
    }
    monkeypatch.setattr(
        markush,
        "reverse_assemble_reactants",
        lambda *a, **k: details,
    )

    result = chem_mcp.tool_reverse_assemble("product", "template", ["r1", "r2"])

    assert result["ok"] is True
    assert result["failed_reactants"] == []
    assert result["reason"] == ""

def test_mcp_refuses_a_peel_the_assembler_itself_calls_unclosed(monkeypatch):
    """ok=True from the assembler is not enough: it reports peel_ok and roundtrip_ok separately.

    Observed on a real scope template, where every row said success while the assembler's own note
    said the assembly still had unconnected sites. Passing that through hands the agent a wrong
    derivation with the authority of a deterministic tool.
    """
    details = {
        "ok": True,
        "peel_ok": False,
        "roundtrip_ok": False,
        "roundtrip_note": "assembly failed or sites remain unconnected",
        "match_index": 42,
        "match_source": "substructure",
        "notes": ["kept the abstract methylene repeat"],
        "reactants": [
            {"smiles": "CC=C", "success": True, "partial": False, "missing_labels": [], "messages": []},
            {"smiles": "CB(O)O", "success": True, "partial": False, "missing_labels": [], "messages": []},
        ],
    }
    monkeypatch.setattr(markush, "reverse_assemble_reactants", lambda *a, **k: details)

    result = chem_mcp.tool_reverse_assemble("product", "template", ["r1", "r2"])

    assert result["ok"] is False
    assert "peel_ok=False" in result["reason"]
    assert "roundtrip_ok=False" in result["reason"]
    assert "assembly failed or sites remain unconnected" in result["reason"]


def test_mcp_still_accepts_a_closed_peel(monkeypatch):
    details = {
        "ok": True,
        "peel_ok": True,
        "roundtrip_ok": True,
        "roundtrip_note": "",
        "match_index": 0,
        "match_source": "substructure",
        "notes": [],
        "reactants": [
            {"smiles": "CC=C", "success": True, "partial": False, "missing_labels": [], "messages": []},
            {"smiles": "CB(O)O", "success": True, "partial": False, "missing_labels": [], "messages": []},
        ],
    }
    monkeypatch.setattr(markush, "reverse_assemble_reactants", lambda *a, **k: details)

    result = chem_mcp.tool_reverse_assemble("product", "template", ["r1", "r2"])

    assert result["ok"] is True
    assert result["reason"] == ""

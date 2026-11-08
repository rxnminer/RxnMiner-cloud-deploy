import hashlib
import json

import pytest

from engine.v2 import assemble_and_validate
from tools.chem_mcp import tool_assemble


def _minimal_plan(**extra):
    plan = {
        "selected_examples": [{
            "identifier": "one",
            "reactants": [{"smiles": "CCO", "identifier": "start"}],
            "products": [{"smiles": "CC=O", "identifier": "end"}],
            "conditions": [],
        }],
        "reaction_templates": [],
    }
    plan.update(extra)
    return plan


def test_assemble_emits_content_hash_and_bounded_lineage_inventory(tmp_path):
    out = tmp_path / "result.v2.json"
    result = tool_assemble(plan=_minimal_plan(), out_path=str(out))
    assert result["candidate_sha256"] == hashlib.sha256(out.read_bytes()).hexdigest()
    assert result["inventory_total"] == 2
    assert result["inventory_truncated"] is False
    assert {item["role"] for item in result["molecule_inventory"]} == {"reactants", "products"}
    assert all("E-SMILES" in item for item in result["molecule_inventory"])
    assert json.loads(out.read_text())["selected_examples"]


def test_explicit_identifiers_and_bbox_survive_assembly():
    plan = {
        "selected_examples": [{
            "identifier": "step-1",
            "reactants": [{
                "smiles": "CCO", "identifier": "(R)-3",
                "bbox_index": 0, "bbox": [1, 2, 3, 4],
            }],
            "products": [{
                "smiles": "CC=O", "identifier": "(R)-1",
                "bbox_index": 2, "bbox": [10, 20, 30, 40],
            }],
            "conditions": [[{
                "role": "reagent", "text": "drawn reagent", "smiles": "N",
                "bbox_index": 1, "bbox": [5, 6, 7, 8],
            }]],
            "metrics": [{"role": "yield", "text": "80%", "of": "(R)-1"}],
        }],
        "reaction_templates": [],
    }
    v2, _ = assemble_and_validate(plan)
    ex = v2["selected_examples"][0]
    assert ex["instance_id"] == "step-1"
    assert ex["products"][0]["identifier"] == "(R)-1"
    assert ex["products"][0]["_source"]["bbox_index"] == 2
    assert ex["products"][0]["_source"]["bbox"] == [10, 20, 30, 40]
    condition_source = ex["conditions"][0][0]["_source"]
    assert condition_source["bbox"] == [5, 6, 7, 8]
    assert condition_source["bbox_index"] == 1
    assert condition_source["esmiles_audit"]["concrete_valid"] is True
    assert ex["metrics"][0]["of"] == "(R)-1"


def test_relabel_never_overwrites_explicit_fallback_identifier():
    plan = {
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "r0"}],
            "products": [{"smiles": "CC=O", "identifier": "p7", "bbox_index": 7}],
        }],
        "reaction_templates": [],
    }
    v2, _ = assemble_and_validate(plan)
    ex = v2["selected_examples"][0]
    assert ex["instance_id"] == "7"
    assert ex["products"][0]["identifier"] == "p7"


def test_combined_metric_is_not_attached_to_first_of_multiple_products():
    plan = {
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [
                {"smiles": "CC=O", "identifier": "B"},
                {"smiles": "CC", "identifier": "p7"},
            ],
            "metrics": [
                {"role": "yield", "text": "40%", "of": "B"},
                {"role": "yield", "text": "20%", "of": "p7"},
                {"role": "yield", "text": "60% combined"},
            ],
        }],
        "reaction_templates": [],
    }
    v2, _ = assemble_and_validate(plan)
    metrics = v2["selected_examples"][0]["metrics"]
    assert metrics[0]["of"] == "B"
    assert metrics[1]["of"] == "p7"
    assert "of" not in metrics[2]


def test_drawn_template_preserves_molparser_esmi_verbatim():
    plan = {
        "reaction_templates": [{
            "template_id": "T1",
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [{
                "smiles": "CC(=O)OCC", "identifier": "B",
                "molparser_markush": False,
                "molparser_esmi": "CCOC12CC3CC(C1)CC(C2)C3<sep><a>3:OAd</a>",
            }],
        }],
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [{"smiles": "CC(=O)OCC", "identifier": "B"}],
            "inherit_template": "T1",
        }],
    }
    v2, _ = assemble_and_validate(plan)
    product = v2["reaction_templates"][0]["products"][0]
    assert product["E-SMILES"] == "CCOC12CC3CC(C1)CC(C2)C3<sep><a>3:OAd</a>"
    assert product["_source"]["ocsr_esmi"] == product["E-SMILES"]
    assert "ocsr_smi" not in product["_source"]
    assert "ocsr_caption" not in product["_source"]


def test_concrete_ocsr_is_default_but_explicit_image_override_survives():
    base_product = {
        "smiles": "CCCCOC(=O)CC", "identifier": "P", "bbox_index": 3,
        "molparser_esmi": "CC(C)(C)OC(=O)CC<sep>",
        "molparser_markush": False,
    }
    default_plan = {
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [dict(base_product)],
        }],
        "reaction_templates": [],
    }
    default_v2, default_report = assemble_and_validate(default_plan)
    default_product = default_v2["selected_examples"][0]["products"][0]
    assert default_product["E-SMILES"] == "CC(C)(C)OC(=O)CC<sep>"     # MolParser wire form, verbatim
    assert default_product["smiles"] == "CCC(=O)OC(C)(C)C"              # plain canonical form next to it
    assert default_product["_source"]["model_esmiles"] == "CCCCOC(=O)CC"
    assert default_product["_source"]["_ocsr_preferred"] is True
    assert "VERDICT: INVALID" in default_report
    assert "missing_ocsr_audits=1" in default_report

    accepted = dict(base_product)
    accepted["smiles"] = accepted["molparser_esmi"]
    accepted["ocsr_audit"] = {
        "decision": "accepted",
        "evidence": "raw crop shows the branched alkoxy substituent",
    }
    accepted_v2, accepted_report = assemble_and_validate({
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [accepted],
        }],
        "reaction_templates": [],
    })
    assert accepted_v2["selected_examples"][0]["products"][0]["_source"]["ocsr_audit"] == accepted["ocsr_audit"]
    assert "VERDICT: VALID" in accepted_report
    assert "missing_ocsr_audits=0" in accepted_report

    corrected = dict(base_product)
    corrected["ocsr_audit"] = {
        "decision": "override",
        "evidence": "bbox 3 explicitly labels the linear isomer",
    }
    corrected["ocsr_override"] = {
        "reason": "printed substituent conflicts with OCSR",
        "evidence": "bbox 3 explicitly labels the linear isomer",
    }
    override_plan = {
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [corrected],
        }],
        "reaction_templates": [],
    }
    override_v2, override_report = assemble_and_validate(override_plan)
    override_product = override_v2["selected_examples"][0]["products"][0]
    assert override_product["E-SMILES"] == "CCCCOC(=O)CC"
    assert override_product["_source"]["ocsr_esmi"] == "CC(C)(C)OC(=O)CC<sep>"
    assert override_product["_source"]["ocsr_override"] == corrected["ocsr_override"]
    assert override_product["_source"]["_ocsr_override_applied"] is True
    assert "accepted image-grounded override" in override_report
    assert "VERDICT: VALID" in override_report


def test_drawn_reactant_preserves_molparser_esmi_verbatim():
    raw_esmi = "OCC<sep>"
    plan = {
        "selected_examples": [{
            "reactants": [{
                "smiles": "CCO", "identifier": "alcohol", "bbox_index": 0,
                "molparser_esmi": raw_esmi, "molparser_markush": False,
                "ocsr_audit": {"decision": "accepted", "evidence": "crop shows a two-carbon alcohol"},
            }],
            "products": [{"smiles": "CC=O", "identifier": "aldehyde"}],
        }],
        "reaction_templates": [],
    }
    v2, report = assemble_and_validate(plan)
    reactant = v2["selected_examples"][0]["reactants"][0]
    assert reactant["E-SMILES"] == raw_esmi              # byte-verbatim, empty <sep> included
    assert reactant["smiles"] == "CCO"                   # plain canonical form next to it
    assert reactant["_source"]["ocsr_esmi"] == raw_esmi
    assert list(reactant)[:3] == ["identifier", "smiles", "E-SMILES"]
    assert "VERDICT: VALID" in report


def test_text_only_reagent_can_opt_out_of_bbox_inheritance():
    plan = {
        "reaction_templates": [{
            "template_id": "T1",
            "reactants": [{"smiles": "CCO", "bbox_index": 0, "bbox": [1, 2, 3, 4]}],
            "products": [{"smiles": "CC=O", "bbox_index": 1, "bbox": [5, 6, 7, 8]}],
        }],
        "selected_examples": [{
            "inherit_template": "T1",
            "reactants": [{"smiles": "CCO", "identifier": "text-reagent", "bbox_inherit": False}],
            "products": [{"smiles": "CC=O", "identifier": "product", "bbox_index": 2, "bbox": [9, 10, 11, 12]}],
        }],
    }
    v2, report = assemble_and_validate(plan)
    source = v2["selected_examples"][0]["reactants"][0]["_source"]
    assert "VERDICT: VALID" in report
    assert source["bbox_inherit"] is False
    assert "bbox" not in source
    assert "bbox_index" not in source
    assert "_bbox_inherited" not in source


def test_unmatched_product_elements_are_reported_but_never_block_the_verdict():
    """Field placement wins over element accounting: an arrow-printed boron reagent stays condition
    text, so a product carrying B without a boron reactant is still a VALID assembly."""
    plan = {
        "selected_examples": [{
            "reactants": [{"smiles": "CC", "identifier": "substrate"}],
            "products": [{"smiles": "CCB(O)O", "identifier": "product"}],
        }],
        "reaction_templates": [],
    }
    _, report = assemble_and_validate(plan)
    assert "VERDICT: VALID" in report
    assert "atom_sources_unmatched=1" in report
    assert "lack reactant source" not in report

    plan["selected_examples"][0]["reactants"].append(
        {"smiles": "OB(O)O", "identifier": "boron-source"}
    )
    _, complete_report = assemble_and_validate(plan)
    assert "VERDICT: VALID" in complete_report
    assert "atom_sources_unmatched=0" in complete_report


def test_potential_alkene_requires_mapped_stereo_audit():
    product = {"smiles": "CC/C=C/CC", "identifier": "P"}
    plan = {
        "selected_examples": [{
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [product],
        }],
        "reaction_templates": [],
    }
    _, missing_report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in missing_report
    assert "missing_stereo_audits=1" in missing_report

    product["stereo_audit"] = {
        "decision": "specified",
        "evidence": "mapped crop shows the higher-priority groups on opposite sides",
        "rdkit_ez": "E",
    }
    v2, verified_report = assemble_and_validate(plan)
    source = v2["selected_examples"][0]["products"][0]["_source"]
    assert source["stereo_audit"] == product["stereo_audit"]
    assert "VERDICT: VALID" in verified_report
    assert "missing_stereo_audits=0" in verified_report

    product["stereo_audit"]["rdkit_ez"] = "Z"
    _, mismatch_report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in mismatch_report
    assert "stereo audit says Z but final SMILES has E" in mismatch_report


def test_specified_tetrahedral_requires_matching_cip_rows():
    product = {"smiles": "F[C@H](Cl)Br", "identifier": "P"}
    plan = _minimal_plan(selected_examples=[{
        "reactants": [
            {"smiles": "C", "identifier": "A"},
            {"smiles": "F", "identifier": "B"},
            {"smiles": "Cl", "identifier": "C"},
            {"smiles": "Br", "identifier": "D"},
        ],
        "products": [product],
    }])
    _, missing_report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in missing_report
    assert "missing_tetrahedral_audits=1" in missing_report

    product["stereo_audit"] = {
        "decision": "specified",
        "evidence": "mapped wedge geometry in the source crop",
        "smiles": "F[C@H](Cl)Br",
        "cip": [{"atom_index": 1, "cip": "R"}],
    }
    _, verified_report = assemble_and_validate(plan)
    assert "VERDICT: VALID" in verified_report
    assert "missing_tetrahedral_audits=0" in verified_report

    product["stereo_audit"]["cip"][0]["cip"] = "S"
    _, mismatch_report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in mismatch_report
    assert "mismatched tetrahedral audit" in mismatch_report


def test_tetrahedral_audit_anchor_survives_canonical_atom_reordering():
    raw = "O=C(O)[C@@H](N)C"
    product = {"smiles": raw, "identifier": "P", "stereo_audit": {
        "smiles": raw,
        "decision": "specified",
        "evidence": "mapped wedge geometry in the source crop",
        "cip": [{"atom_index": 3, "cip": "S"}],
    }}
    plan = _minimal_plan(selected_examples=[{
        "reactants": [{"smiles": "C.N.O", "identifier": "A"}],
        "products": [product],
    }])
    _, report = assemble_and_validate(plan)
    assert "VERDICT: VALID" in report
    assert "missing_tetrahedral_audits=0" in report


def test_mixed_alkene_and_tetrahedral_audit_uses_separate_decisions():
    raw = "CC=CC[C@H](F)Cl"
    product = {"smiles": raw, "identifier": "P", "stereo_audit": {
        "decision": "unspecified",
        "tetrahedral_decision": "specified",
        "evidence": "crop shows no alkene geometry and a mapped tetrahedral wedge",
        "smiles": raw,
        "cip": [{"atom_index": 4, "cip": "R"}],
    }}
    plan = _minimal_plan(selected_examples=[{
        "reactants": [{"smiles": "C.F.Cl", "identifier": "A"}],
        "products": [product],
    }])
    _, report = assemble_and_validate(plan)
    assert "VERDICT: VALID" in report
    assert "missing_stereo_audits=0" in report
    assert "missing_tetrahedral_audits=0" in report


def test_partially_unassigned_tetrahedral_centres_are_allowed():
    raw = "F[C@H](Cl)C(Br)I"
    product = {"smiles": raw, "identifier": "P", "stereo_audit": {
        "decision": "specified",
        "tetrahedral_decision": "specified",
        "evidence": "one centre has a mapped wedge; the second centre is not assigned",
        "smiles": raw,
        "cip": [{"atom_index": 1, "cip": "R"}],
    }}
    plan = _minimal_plan(selected_examples=[{
        "reactants": [{"smiles": "F.Cl.Br.I.C", "identifier": "A"}],
        "products": [product],
    }])
    _, report = assemble_and_validate(plan)
    assert "VERDICT: VALID" in report
    assert "missing_tetrahedral_audits=0" in report


@pytest.mark.parametrize("audit", [
    {"decision": [], "evidence": "malformed", "cip": []},
    {"decision": "specified", "evidence": "malformed", "cip": [{"atom_index": 1, "cip": []}]},
    {"decision": "specified", "evidence": "malformed", "smiles": ["F[C@H](Cl)Br"], "cip": [{"atom_index": 1, "cip": "R"}]},
])
def test_malformed_tetrahedral_audit_fails_closed_with_audit_count(audit):
    raw = "F[C@H](Cl)Br"
    plan = _minimal_plan(selected_examples=[{
        "reactants": [{"smiles": "C.F.Cl.Br", "identifier": "A"}],
        "products": [{"smiles": raw, "identifier": "P", "stereo_audit": audit}],
    }])
    _, report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in report
    assert "missing_tetrahedral_audits=1" in report


def test_malformed_stereo_audit_fails_closed_without_crashing():
    plan = _minimal_plan(selected_examples=[{
        "reactants": [{"smiles": "CCO", "identifier": "A"}],
        "products": [{"smiles": "F[C@H](Cl)Br", "identifier": "P",
                      "stereo_audit": {"decision": [], "cip": []}}],
    }])
    _, report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in report


def test_multistep_fields_pass_through_when_skill_supplies_them():
    plan = {
        "is_multistep": True,
        "synthesis_overview": {"type": "linear", "description": "two arrows"},
        "selected_examples": [{
            "identifier": "s1",
            "reactants": [{"smiles": "CCO", "identifier": "A"}],
            "products": [{"smiles": "CC=O", "identifier": "B"}],
        }],
        "reaction_templates": [],
        "reaction_graph": [{
            "edge_id": "e1", "step_order": 1,
            "from_mols": ["A"], "to_mols": ["B"],
        }],
    }
    v2, report = assemble_and_validate(plan)
    assert v2["is_multistep"] is True
    assert v2["reaction_graph"] == plan["reaction_graph"]
    assert v2["synthesis_overview"] == plan["synthesis_overview"]
    assert "multistep-graph=Y" in report


def test_unresolved_tagged_condition_is_provenance_only_and_invalid():
    raw = "[*-].[*][Pd+]([*])<sep><a>0:ClO4</a><a>1:NCMe</a><a>3:NCMe</a>"
    plan = _minimal_plan()
    plan["selected_examples"][0]["conditions"] = [[{
        "role": "catalyst",
        "text": "drawn catalyst",
        "smiles": raw,
        "molparser_esmi": raw,
    }]]

    v2, report = assemble_and_validate(plan)

    condition = v2["selected_examples"][0]["conditions"][0][0]
    assert "E-SMILES" not in condition
    assert condition["_source"]["ocsr_esmi"] == raw
    assert condition["_source"]["esmiles_audit"]["concrete_valid"] is False
    assert condition["_source"]["esmiles_audit"]["unsupported_labels"] == ["ClO4", "NCMe"]
    assert "VERDICT: INVALID" in report
    assert "unresolved_condition_esmiles=1" in report


def test_supported_tagged_condition_preserves_raw_esmiles_when_concrete():
    raw = "*C<sep><a>0:Ph</a>"
    plan = _minimal_plan()
    plan["selected_examples"][0]["conditions"] = [[{
        "role": "reagent",
        "text": "drawn reagent",
        "smiles": raw,
        "molparser_esmi": raw,
    }]]

    v2, report = assemble_and_validate(plan)

    condition = v2["selected_examples"][0]["conditions"][0][0]
    assert condition["E-SMILES"] == raw
    assert condition["_source"]["esmiles_audit"]["concrete_valid"] is True
    assert "unresolved_condition_esmiles=0" in report


def test_multiple_templates_without_graph_require_explicit_independence_audit():
    templates = [
        {"template_id": "T1", "reactants": ["*C"], "products": ["*CO"]},
        {"template_id": "T2", "reactants": ["*N"], "products": ["*NC"]},
    ]
    plan = _minimal_plan(reaction_templates=templates)

    _, missing_report = assemble_and_validate(plan)
    assert "VERDICT: INVALID" in missing_report
    assert "missing_topology_audit=1" in missing_report

    plan["topology_audit"] = {
        "visible_arrows": ["independent arrow 1", "independent arrow 2"],
        "product_reused": False,
        "evidence": "the two panels have distinct inputs and no shared intermediate",
    }
    v2, audited_report = assemble_and_validate(plan)
    assert v2["topology_audit"] == plan["topology_audit"]
    assert "missing_topology_audit=0" in audited_report


def test_multistep_graph_may_reference_template_molecule_identifiers():
    plan = _minimal_plan(
        is_multistep=True,
        synthesis_overview={"type": "fan_out_derivatization", "description": "two linked arrows"},
        reaction_templates=[
            {
                "template_id": "T1",
                "reactants": [{"smiles": "*C", "identifier": "generic-start"}],
                "products": [{"smiles": "*CO", "identifier": "generic-intermediate"}],
            },
            {
                "template_id": "T2",
                "reactants": [{"smiles": "*CO", "identifier": "generic-intermediate"}],
                "products": [{"smiles": "*C=O", "identifier": "generic-final"}],
            },
        ],
        reaction_graph=[{
            "edge_id": "e2",
            "step_order": 2,
            "from_mols": ["generic-intermediate"],
            "to_mols": ["generic-final"],
            "via_template": "T2",
        }],
    )

    _, report = assemble_and_validate(plan)

    assert "missing_topology_audit=0" in report
    assert "not a known mol-id/label" not in report



def test_structured_condition_can_supply_atom_source_without_field_move():
    from engine.v2 import _count_missing_atom_sources

    examples = [{
        "instance_id": "condition-source",
        "reactants": [{"E-SMILES": "C"}],
        "conditions": [[{"role": "reagent", "smiles": "N"}]],
        "products": [{"E-SMILES": "CN"}],
    }]
    issues = []
    assert _count_missing_atom_sources(examples, issues) == 0
    assert issues == []
    assert examples[0]["reactants"] == [{"E-SMILES": "C"}]


def test_text_only_condition_does_not_fake_an_atom_source():
    from engine.v2 import _count_missing_atom_sources

    examples = [{
        "instance_id": "text-only",
        "reactants": [{"E-SMILES": "C"}],
        "conditions": [[{"role": "reagent", "text": "nitrogen source"}]],
        "products": [{"E-SMILES": "CN"}],
    }]
    issues = []
    assert _count_missing_atom_sources(examples, issues) == 1
    assert "N" in issues[0]


def test_concrete_molecules_carry_plain_smiles_next_to_verbatim_esmiles():
    plan = _minimal_plan()
    plan["selected_examples"][0]["reactants"] = [{"smiles": "OCC<sep>", "identifier": "typed"}]
    plan["selected_examples"][0]["products"] = [{
        "smiles": "C/C=C/C(=O)O", "identifier": "drawn", "bbox_index": 4,
        "molparser_esmi": "OC(=O)/C=C/C<sep>", "molparser_markush": False,
        "ocsr_audit": {"decision": "accepted", "evidence": "crop shows the E alkene"},
        "stereo_audit": {"decision": "specified", "evidence": "trans drawn", "rdkit_ez": "E"},
    }]
    v2, _ = assemble_and_validate(plan)
    ex = v2["selected_examples"][0]
    typed = ex["reactants"][0]
    assert typed["E-SMILES"] == "CCO<sep>"                  # agent-built: canonicalised body, <sep> kept
    assert typed["smiles"] == "CCO"
    drawn = ex["products"][0]
    assert drawn["E-SMILES"] == "OC(=O)/C=C/C<sep>"         # OCSR read: byte-verbatim
    assert drawn["smiles"] == "C/C=C/C(=O)O"                # stereo survives canonicalisation
    assert drawn["_source"]["ocsr_esmi"] == "OC(=O)/C=C/C<sep>"
    for m in ex["reactants"] + ex["products"]:
        assert list(m)[:3] == ["identifier", "smiles", "E-SMILES"]


def test_template_molecules_keep_esmiles_verbatim_and_get_no_fake_smiles():
    plan = {
        "reaction_templates": [{
            "template_id": "T1",
            "reactants": [{"smiles": "*C(=O)OC<sep><a>0:R</a>", "identifier": "ester"}],
            "products": [{"smiles": "*C(=O)N<sep><a>0:R</a>", "identifier": "amide"}],
        }],
        "selected_examples": [{
            "reactants": [{"smiles": "CC(=O)OC", "identifier": "ester-1"}],
            "products": [{"smiles": "CC(=O)N", "identifier": "amide-1"}],
            "inherit_template": "T1",
        }],
    }
    v2, _ = assemble_and_validate(plan)
    for mol in v2["reaction_templates"][0]["reactants"] + v2["reaction_templates"][0]["products"]:
        assert "smiles" not in mol                          # open Markush label: no plain form
        assert mol["E-SMILES"].endswith("<sep><a>0:R</a>")  # tags untouched
    for mol in v2["selected_examples"][0]["reactants"] + v2["selected_examples"][0]["products"]:
        assert mol["smiles"] == mol["E-SMILES"]             # concrete instances get both


def test_tagged_concrete_molecule_keeps_tags_and_derives_expanded_smiles():
    raw = "*C(=O)O<sep><a>0:Ph</a>"                         # benzoic acid written with an abbreviation tag
    plan = _minimal_plan()
    plan["selected_examples"][0]["conditions"] = [[{
        "role": "reagent", "text": "drawn reagent", "smiles": raw, "molparser_esmi": raw,
    }]]
    v2, _ = assemble_and_validate(plan)
    cond = v2["selected_examples"][0]["conditions"][0][0]
    assert cond["E-SMILES"] == raw                          # tagged wire form preserved
    assert cond["smiles"] == "O=C(O)c1ccccc1"               # expanded, plain, canonical
    assert list(cond)[:4] == ["role", "text", "smiles", "E-SMILES"]


def test_structured_condition_with_plain_body_gets_smiles():
    plan = _minimal_plan()
    plan["selected_examples"][0]["conditions"] = [[
        {"role": "catalyst", "text": "Pd(OAc)2", "smiles": "CC(=O)O[Pd]OC(C)=O<sep>"},
        {"role": "solvent", "text": "MeCN"},
    ]]
    v2, _ = assemble_and_validate(plan)
    cat, solvent = v2["selected_examples"][0]["conditions"][0]
    assert cat["E-SMILES"] == "CC(=O)O[Pd]OC(C)=O<sep>"     # verbatim
    assert cat["smiles"] == "CC(=O)O[Pd]OC(C)=O"
    assert "smiles" not in solvent and "E-SMILES" not in solvent   # text-only stays text-only


def test_assemble_inventory_reports_plain_smiles():
    result = tool_assemble(plan=_minimal_plan())
    assert {item["smiles"] for item in result["molecule_inventory"]} == {"CCO", "CC=O"}


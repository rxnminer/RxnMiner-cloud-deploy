---
name: fhr-rgroup
description: Use when developing, debugging or reviewing R-group reverse (substituent extraction), fill (Markush materialisation) or product-anchored reverse assembly of undrawn reactants in RxnMiner, and their fail-closed checks.
---

# R-group reverse, fill and reverse assembly (the FHR engine)

Three of the agent's eight tools do deterministic Markush chemistry. Everything below is what the
code actually does; read the files, not just this page.

## Read first

1. `engine/markush.py`: the wrapper the tools call. Its docstring reproduces the two core functions
   verbatim and states the round-trip law: `forward_fill(template, reverse_r(template, x)) == canon(x)`.
2. `tools/chem_mcp.py`: `tool_reverse_rgroup`, `tool_fill_rgroup`, `tool_reverse_assemble` and the
   row validator `_reverse_assemble_row_failures`.
3. `third_party/molecular_assembly_v2/src/chemistry/reverse_assembly.py` (vendored FHR: "peel
   R-groups from product, fill reactant Markush templates"); `chemistry/decompose.py`
   (`step0_scaffold_map`), `chemistry/assembly.py` (`assemble_fragments`), `chemistry/candidates.py`
   (round-trip and full-pass candidate checks). Never edit vendored code for a workaround; put guards
   in `engine/` or `tools/` and keep attribution (`THIRD_PARTY.md`).
4. `skills/reaction-extract/SKILL.md`, the "derive undrawn reactants" step: (a) mechanism reasoning,
   (b) deterministic `reverse_assemble` for a scope grid, and the rule that closure alone never
   upgrades a reactant to `uniquely_derivable`.
5. `../esmiles-2.0/SKILL.md`: label positions (`<a>idx:label</a>`) are bound to the MolParser
   traversal of the template body; a canonicalised template breaks them.

## How it works

A Markush template is an E-SMILES whose body carries `*` at every variable position and whose
extension names each position: `*C(=O)OC1CC1<sep><a>0:R</a>`. A concrete cell of a scope table is
the same scaffold with the variables filled in.

| operation | tool | engine | what it does |
|---|---|---|---|
| reverse | `reverse_rgroup(template, concrete)` | `engine.markush.reverse_r` | match the template scaffold as a substructure of the concrete product; each `*` position becomes a `*`-rooted fragment SMILES: `{"R": "*c1ccccc1"}`. With `FHR_REVERSE=1` it uses FHR `step0_scaffold_map`; otherwise MarkushMapMulti with an RDKit R-group-decomposition union fallback. Returns `{}` when the scaffold does not match. |
| fill | `fill_rgroup(template, r_map)` | `engine.markush.forward_fill` | substitute fragments into the template. Values may be `*`-rooted fragment SMILES (the general path) or substituent names (`"OMe"`, `"Ph"`) resolved through `engine/markush_substitute.py::SUB_SMILES`; the name layer is sugar. With `FHR_REVERSE=1` it uses FHR `assemble_fragments` (keeps E/Z and tetrahedral stereo), else an RDKit molzip fallback. `r_map` may be a list for a batch (one product per cell). |
| reverse assembly | `reverse_assemble(target_product, product_template, reactant_templates)` | `engine.markush.reverse_assemble_reactants` -> FHR `reverse_assemble` | product-anchored: peel the R-groups off the concrete product against the product template, then fill every reactant template with that same R-map, in one call. This derives what the per-cell reverse+fill path under-peels to None (an alkylzinc `Br[Zn]C1CCC1`, an aryl ring substituent). Rows come back aligned with `reactant_templates`. |

`FHR_REVERSE` is read once at engine import time (`engine/markush.py`, `_FHR_ON`) and is OFF by
default; nothing in the runtime (`bin/rxnminer`, `docker/`, the MCP server, the Pi extension) sets
it, so in production the low-level reverse and fill run the MarkushMapMulti / RDKit baseline.
The high-level `reverse_assemble` loads FHR lazily and independently of that flag, which is why it
is the preferred route for a scope grid. `tool_reverse_rgroup` and `tool_fill_rgroup` report which
path ran in their `fhr` field.

## The result contract (fail closed)

`reverse_assemble_reactants(..., return_details=True)` returns FHR's own aggregate `ok` plus one row
per reactant template: `{template, smiles, success, partial, missing_labels, messages}`.
`tool_reverse_assemble` then re-validates every row with `_reverse_assemble_row_failures`, which
rejects `empty_smiles`, `smiles_parse_failed`, `unconnected_dummy_atoms` (an isotope-labelled `*` is
still atomic number zero, not a finished molecule) and any row whose `success` is not `True`; a row
count that differs from the template count is `reactant_count_mismatch`. The tool answer is
`{ok, n, reactants, failed_reactants, reason, diagnostics}`; `ok` is `True` only when FHR said ok
AND no row failed. Callers must never rebuild success from the presence of a plausible SMILES.

Acceptance gate for a derived reactant set, all of which must hold:

1. inputs and outputs parse; a concrete result carries no `*` or dummy atom;
2. every row is `success`, none `partial`, `missing_labels` empty;
3. forward materialisation recreates the intended product connectivity; verify stereo separately
   when the drawing specifies it (`verify_smiles`);
4. each variable partition is chemically non-degenerate and agrees with printed labels, template
   attachment sites and the crop; a named alkyl or aryl variable that collapses to hydrogen or a
   trivial fragment while another reactant absorbs almost the whole product is wrong even when the
   round trip closes;
5. product elements without a recorded reactant or structured-condition source are counted as `atom_sources_unmatched` (`engine/v2.py`); the count is informational and never blocks the verdict, because an arrow-printed reagent stays condition text by contract.

If any check fails, keep the template or unresolved outcome explicit (the runtime skill's
`unresolved` class with the `*` template) or fall back to image-grounded mechanism reasoning. Never
promote a partial result to concrete chemistry.

## Usage

Through the MCP boundary (what the agent does) or the CLI (what a developer does):

```bash
python3 scripts/chem_tool.py call reverse_rgroup   --args-json '{"template": "<template E-SMILES>", "concrete": "<concrete SMILES>"}'
python3 scripts/chem_tool.py call fill_rgroup      --args-json '{"template": "<template E-SMILES>", "r_map": {"R": "*c1ccccc1"}}'
python3 scripts/chem_tool.py call reverse_assemble --args-json '{"target_product": "<concrete product>", "product_template": "<product template E-SMILES>", "reactant_templates": ["<reactant template E-SMILES>", "..."]}'
```

Or in Python for a quick check (`PYTHONPATH=.`):

```python
from engine.markush import reverse_r, forward_fill, reverse_assemble_reactants, canon
r = reverse_r(template, product)                      # {"R": "*..."} or {}
assert canon(forward_fill(template, r)) == canon(product)
rows = reverse_assemble_reactants(product, product_template, reactant_templates, return_details=True)
```

Keep every example generic. Do not put a benchmark figure's molecules into a test, a skill or a
docstring (`tools/skill_lint.py` rejects concrete SMILES in `LESSONS.md`; the same discipline applies
here).

## Tests and where to add more

- `tests/test_reverse_assemble_status.py`: aggregate diagnostics are preserved; a partial row with an
  isotope dummy is rejected even when another row succeeds; only complete, parseable, dummy-free rows
  pass.
- `tests/test_v2_metadata.py`: `markush_enumeration` and `inherit_template` flow into the V2 output;
  products need a recorded reactant source.
- Add regression fixtures by topology class (ring substituent, organometallic partner, multi-R
  template, stereo-bearing template), never by figure id. Run
  `PYTHONPATH=. python3 -m pytest tests/test_reverse_assemble_status.py -q`.

## Known limits

- `reverse_r` needs the template scaffold to be a substructure of the concrete molecule; a
  cell whose ring or topology differs from the template is a job for mechanism reasoning, not for
  this engine.
- The vendored `molparser_utils` library (`third_party/molparser_utils_pkg`) also does Markush
  substitution by string surgery; it is not the R-group engine. Materialising a template by string
  substitution can look plausible and be chemically wrong. See `../esmiles-2.0/references/molparser-utils.md`.

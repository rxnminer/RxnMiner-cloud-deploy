# Attribution

## third_party/molecular_assembly, third_party/molecular_assembly_v2
R-group **decomposition / assembly / reverse-assemble** library authored by **fhr** (colleague),
from the internal `synfact_try` project. This is the code that:
- extracts R-groups from a drawn concrete against a Markush template (R-group "reverse"),
- fills a Markush template with R-groups to materialize a concrete molecule (R-group "带入" / fill),
- and, at the high level, `reverse_assemble(target_product, product_template, [reactant_templates])`
  derives a reaction's undrawn reactants in one call (see `src/chemistry/reverse_assembly.py`).

Included here **with permission, for internal/private use only** (this repository is private).
Not for public redistribution without fhr's consent. Source of record (read-only):
`/instrument/micro_img/users/fhr/projects/synfact_try/molecular_assembly`.
`molecular_assembly_v2` is the newer copy with better aryl ring-substituent handling.

## engine/
`engine/markush.py` and `engine/v2.py` are OURS. `markush.py` is the thin wrapper that shows exactly
HOW we call fhr: `reverse_r` (reverse), `forward_fill` (fill), and `reverse_assemble_reactants`
(the high-level derivation, prefers molecular_assembly_v2). Read it to see the R-group flow end to end.

## OCSR
Structure reading is done by MolParser (a remote OCSR service), invoked behind the `detect` tool in
`tools/chem_mcp.py`. The client + endpoint are not included here.

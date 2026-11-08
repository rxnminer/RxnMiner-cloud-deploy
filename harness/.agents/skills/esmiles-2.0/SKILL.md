---
name: esmiles-2.0
description: Use when ingesting, preserving, interpreting, validating, scoring or storing MolParser Extended-SMILES 2.0 values (E-SMILES) and the derived plain smiles field in RxnMiner output.
---

# MolParser Extended-SMILES 2.0 in RxnMiner

## Read first

1. `../molparser-extended-smiles/` is the normative source, vendored verbatim from the MolParser
   team (`git.dp.tech/molparser/molparserutils`, see its `VENDORED.md`): a 314-line spec, 27 worked
   figures under `assets/images/`, the unsupported-case list and `scripts/validate_esmiles.py`.
   Never edit it; when it and our digest disagree, upstream wins and the digest is what to fix.
2. `../../../skills/reaction-extract/references/extended-smiles-2.0.md` is our condensed digest of
   the same document and is what the extraction agent reads at run time.
3. [references/molparser-utils.md](references/molparser-utils.md) before calling the vendored
   `molparser_utils` library (`third_party/molparser_utils/`).

## Wire contract

- An E-SMILES is `SMILES<sep>EXTENSION`, ordered protocol data, not ordinary CXSMILES. A plain
  concrete molecule ends with an EMPTY `<sep>` (`CC=O<sep>`); that empty extension is part of the
  wire form.
- Extension positions (`<a>0:R</a>` and friends) refer to the original non-canonical MolParser
  SMILES traversal. Canonicalising, reordering or regenerating the body silently breaks them.
- Supported tokens are `<a>/<d>/<r>/<c>/<g>/<v>/<s>` and the repeat constructs, exactly as the
  pinned reference defines them. Preserve and report unknown syntax; never guess a translation.

## How RxnMiner stores it (decided 2026-09-11)

Every molecule record the assembler emits (`engine/v2.py`, `_finalize_molecule_fields`) reads

```json
{"identifier": "p4",
 "smiles":   "O=C1CC(c2ccccc2)N(c2ccccc2)N1C(=O)c1ccccc1",
 "E-SMILES": "O=C1CC(c2ccccc2)N(c2ccccc2)N1C(=O)c1ccccc1<sep>",
 "_source":  {"ocsr_esmi": "O=C1CC(c2ccccc2)N(c2ccccc2)N1C(=O)c1ccccc1<sep>", "...": "..."}}
```

- `E-SMILES` is byte-verbatim, trailing empty `<sep>` included. The assembler never rewrites it; an
  explicit image-grounded `ocsr_override` is the only path that replaces it, and then the raw read
  stays in `_source.ocsr_esmi`.
- `smiles` is derived by the engine only (never written by the model): plain RDKit canonical
  isomeric SMILES of the concrete structure, abbreviation tags expanded through
  `tools/esmiles_audit.py`. Markush templates, open labels, unresolved and RDKit-invalid values carry
  no `smiles`, so a plain form is never faked.
- Consumers that want a molecule read `smiles`; `E-SMILES` is for provenance, rendering and the
  E-SMILES tools. The benchmark strict scorer prefers `smiles` and, when only `E-SMILES` exists,
  ignores a trailing empty `<sep>` (ChemRxn_Benchmark PR #30); values with real tags stay outside the
  score universe.
- Canonicalisation is for validation and equality only (`engine/uniparser_to_v2.canon`), or for
  chemistry the agent built itself; it must not overwrite a MolParser read.

## Checks

- Unit tests that pin the contract: `tests/test_v2_metadata.py` (verbatim `E-SMILES`, derived
  `smiles`, key order, tagged conditions, templates without `smiles`).
- Semantic audit of one value: `python3 scripts/chem_tool.py call verify_smiles '{"smiles": "...", "require_concrete": true}'`
  (reports unsupported labels, open Markush labels, expansion, remaining dummies).
- Syntax-only check of the wire form: `python3 .agents/skills/molparser-extended-smiles/scripts/validate_esmiles.py "<value>"`
  (it does not verify that indexes resolve; see the vendored `VENDORED.md`).

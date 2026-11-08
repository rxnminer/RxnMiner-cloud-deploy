---
name: molparser-extended-smiles
description: "Use for MolParser Extended-SMILES 2.0 E-SMILES tasks: generating, validating, explaining, and annotating RDKit-compatible molecular strings with Markush substituents, attachment points, ring attachments, abstract rings, repeats, polymers, complex repeat groups, virtual arcs, and unsupported-case triage."
---

# MolParser Extended-SMILES 2.0

Use this skill when the user needs to read, write, validate, explain, or annotate MolParser Extended-SMILES 2.0 strings.

## Load Order

- For exact syntax, examples, unsupported cases, and validation rules, read `references/extended-smiles-2.0-spec.md`.
- For visual examples, read `references/figure-index.md`. All 27 source figures are in `assets/images/`.
- For source provenance and internet supplements, read `references/external-sources.md`.
- For the converted source document, read `references/original-docx-extract.md` only when you need the original wording or layout.
- To run a lightweight syntax sanity check, use `scripts/validate_esmiles.py`.

## Core Workflow

1. Identify the base molecule graph and produce an RDKit-compatible SMILES string.
   - For ordinary non-Markush molecules, prefer the source convention:
     `Chem.MolToSmiles(mol, rootedAtAtom=0, canonical=False, isomericSmiles=True)`.
   - Preserve stereochemistry and dummy atoms when they are meaningful.
2. Append `<sep>` after the base SMILES. Keep `<sep>` even when there is no extension.
3. Add extension records after `<sep>` using the MolParser XML-like tokens:
   - `<a>...</a>` for atom-indexed substituents and Markush groups.
   - `<d>...</d>` for connection points.
   - `<r>...</r>` for ring-attached groups.
   - `<c>...</c>` for simple abstract rings.
   - `<g>...</g>` for complex repeated fragments.
   - `<v>...</v>` for virtual arcs or special abstract rings.
   - `|Sg:n|` for whole repeat units and polymer-style repeats.
4. Treat all atom indexes as zero-based indexes in the base SMILES context. Ring indexes and virtual-arc indexes are counted independently.
5. When generating an answer, output the final E-SMILES as plain text unless the user asks for explanation.
6. When validating or reviewing, check base SMILES compatibility, extension token syntax, index references, repeat counts, unsupported structure categories, and whether every visual ambiguity has been represented or explicitly marked unsupported.

## Guardrails

- The local document is the normative MolParser Extended-SMILES 2.0 source. Internet sources are background only unless the user asks to revise the format.
- Do not invent new extension tokens for unsupported cases. If coordination bonds, electron-transfer arrows, dashed uncertain structures, wavy/uncertain bonds, or uncertain chirality are present, report the gap and ask whether to preserve it as metadata outside E-SMILES.
- Do not silently canonicalize or reorder extension records when atom indexes depend on a specific base SMILES traversal.
- Do not parse the extension as strict XML. Tokens are XML-like but include inline labels such as `<id>[DNA]` and `<dum>`.
- Keep substructure extension syntax local: indexes inside `<s>SMILES<sep>...</s>` are scoped to that substructure, not the outer molecule.


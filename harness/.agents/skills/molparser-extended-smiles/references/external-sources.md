# External Sources and Supplement Notes

These notes summarize internet sources used as background while building this skill. They do not override the local Extended-SMILES 2.0 DOCX.

## MolParser Paper

- Source: [MolParser: End-to-end Visual Recognition of Molecule Structures in the Wild, ICCV 2025 paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Fang_MolParser_End-to-end_Visual_Recognition_of_Molecule_Structures_in_the_Wild_ICCV_2025_paper.pdf)
- Relevant note: the paper describes Extended SMILES as an RDKit-compatible and LLM-friendly extension for Markush structures, connection points, abstract rings, uncertain ring attachments, duplicated structures, and polymer structures.
- Relevant note: the paper gives the top-level shape as `SMILES<sep>EXTENSION` and describes XML-like special tokens in the extension.
- How this skill uses it: confirms the motivation and compatibility goals; the local DOCX remains the detailed syntax source.

## RDKit

- Source: [RDKit namespace reference for MolToSmiles and MolToCXSmiles](https://www.rdkit.org/docs/cppapi/namespaceRDKit.html)
- Source: [RDKit Book](https://www.rdkit.org/docs/RDKit_Book.html)
- Relevant note: RDKit SMILES writing is canonical by default unless parameters such as `rootedAtAtom` and `canonical=False` are used.
- Relevant note: RDKit supports CXSMILES fields for atom labels, SGroups, polymer metadata, coordinate bonds, hydrogen bonds, zero bonds, enhanced stereo, and related annotations.
- How this skill uses it: reinforces why the base SMILES traversal must be fixed before assigning atom indexes, and why E-SMILES extension records should not be reordered without regenerating indexes.

## OpenSMILES

- Source: [OpenSMILES specification](https://opensmiles.org/opensmiles.html)
- Relevant note: OpenSMILES is a community open specification for core SMILES grammar and conventions.
- How this skill uses it: background only for core SMILES syntax. Extended-SMILES 2.0 adds MolParser-specific records after `<sep>`.

## BigSMILES

- Source: [BigSMILES data format documentation](https://olsenlabmit.github.io/BigSMILES/docs/DataFormat.html)
- Source: [BigSMILES ACS Central Science article](https://pubs.acs.org/doi/10.1021/acscentsci.9b00476)
- Relevant note: BigSMILES is a SMILES-derived line notation for polymers and macromolecular repeat connectivity; complete polymer characterization may require metadata such as degree of polymerization or dispersity.
- How this skill uses it: background for polymer-repeat notation. MolParser Extended-SMILES 2.0 uses its own `|Sg:n|` and `<g>...</g>` conventions from the local DOCX.

## Supplement Policy

- Treat online sources as compatibility and background context.
- Do not import external syntax into Extended-SMILES 2.0 unless the user explicitly asks to revise the format.
- When external formats can represent something that the local DOCX marks unsupported, report that as a possible future extension rather than silently changing the E-SMILES output.


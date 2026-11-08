# Third-party components

`third_party/` carries three internal libraries the chemistry tools depend on. They were vendored
from `https://github.com/bbkevin1016/ChemRxn_Agent` at commit `a02b9c201e246f5ea6d63634bba5d6ec149c5e79` (subtree `figure_skills`).

| package | files in manifest | role |
|---|---:|---|
| `molecular_assembly` | 39 | R-group reverse assembly engine (Markush template + concrete product -> reactants) |
| `molecular_assembly_v2` | 43 | second-generation assembly engine used by `reverse_assemble` |
| `molparser_utils_pkg` | 13 | MolParser E-SMILES client, translator and comparison utilities |

All three are marked internal-use-only by their authors. This repository is private; per-component
redistribution rights must be confirmed before any public release. Each package directory keeps its
own PROVENANCE or README. The SHA-256 manifest of every vendored file is in `third_party/MANIFEST.json`
(`python3 tools/verify_third_party.py` checks it).

## Vendored documentation (not code)

`.agents/skills/molparser-extended-smiles/` is a verbatim copy of the MolParser team's
Extended-SMILES 2.0 skill (spec, 27 figures, syntax checker), vendored from
`git.dp.tech/molparser/molparserutils` (see its `VENDORED.md` for commit and refresh). Internal
company material: it must not be published or included in a public release without the MolParser
team's agreement. It is excluded from the docker image.


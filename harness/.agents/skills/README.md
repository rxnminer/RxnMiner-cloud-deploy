# Repository developer skills

On-demand background knowledge for people and coding agents (Claude Code, Codex, Pi) who develop
this repository. Every `.agents/skills/<name>/SKILL.md` is discoverable by those tools;
`.claude/skills/domain/*` and `.codex/skills/domain/*` are thin wrappers that point here, so the
knowledge lives in one place.

These are NOT the extraction agent's runtime skills. What the extraction agent loads at run time is
`skills/reaction-extract/` (and `skills/reaction-verify/`) and nothing else; `.agents/`, `.claude/`
and `.codex/` are excluded from the docker image by `.dockerignore`. Never put figure-specific
answers, ground truth, credentials or run data into any skill.

| skill | use it when |
|---|---|
| `esmiles-2.0/` | reading, validating, storing or scoring MolParser Extended-SMILES; how `E-SMILES` and the derived `smiles` field are handled in the V2 output |
| `molparser-extended-smiles/` | the normative format definition, vendored verbatim from the MolParser team (spec, 27 worked figures, unsupported cases, syntax checker); do not edit |
| `fhr-rgroup/` | how `reverse_rgroup`, `fill_rgroup` and `reverse_assemble` work (template scaffold matching, fragment fill, product-anchored reverse assembly through the vendored FHR engine), the fail-closed result contract and the acceptance gate for derived reactants |
| `repo-development/` | the issue -> branch -> gates -> PR -> review loop of this repository, with the templates and the commands |

Add a skill only when it has a specific trigger and stable references; keep `SKILL.md` short and put
details under `references/`.

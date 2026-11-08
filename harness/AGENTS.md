# AGENTS.md: baseline for every coding agent in this repository (Codex reads it; Claude Code imports it via CLAUDE.md)

RxnMiner is the multimodal extraction agent of the ChemRxn-Bench paper: one chemistry figure in,
strict V2 JSON out, through a Pi session that reads `skills/reaction-extract/` and drives the nine
chemistry tools in `tools/chem_mcp.py`. `README.md` says how to run it; this file says how to work on it.

Pick the mode that matches the request:

- **Running or troubleshooting the agent** (install, build, extract a figure, read a session): follow
  `README.md`. Credentials come from the environment only; the first live model or MolParser call
  costs money, say so before batches.
- **Changing the repository** (code, skills, prompts, docs, tests): follow `CONTRIBUTING.md` and the
  `repo-development` skill. One problem, one issue, one pull request that closes it.

## Where things are

| what | where |
|---|---|
| runtime skill the agent loads | `skills/reaction-extract/` (SKILL.md, LESSONS.md, references/) |
| the nine tools | `tools/chem_mcp.py`; MCP server `scripts/run_chem_mcp.py`; CLI `scripts/chem_tool.py` |
| assembler and Markush engine | `engine/` (`v2.py` builds the V2 output: `identifier, smiles, E-SMILES, ..., _source` per molecule) |
| prompts the model receives | `prompts/` (changing them changes the paper prompt; say so in the PR) |
| runner, pins, image | `bin/rxnminer`, `runtime/`, `docker/` |
| vendored libraries | `third_party/` (`THIRD_PARTY.md`; redistribution rights not yet cleared) |
| developer background knowledge | `.agents/skills/` (index in its README); `.claude/skills/domain/*`, `.codex/skills/domain/*` are wrappers |
| issue and PR templates | `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` |
| dp server paths, images, credentials, scripts | the maintainer handoff `HANDOFF_PI_AGENT_CURRENT.md` and, outside this repo, `docs/HANDOFF_RXNMINER_CODEX_2026-09-11.md` in the chemreaction workbench |

## Rules that do not bend

- Skills contain general rules only: no figure-specific molecules, ids or answers
  (`tools/skill_lint.py`). Ground truth is read by the scorer after the fact, never by the agent.
- `E-SMILES` is the MolParser wire form and stays byte-verbatim (empty trailing `<sep>` included);
  the plain molecule is the derived `smiles` field. See `.agents/skills/esmiles-2.0/SKILL.md`.
- Pins stay: rdkit 2022.9.5 (canonical strings are scored), Node 22.19.0, pi 0.82.1,
  `forceAdaptiveThinking=false`, pi timeouts at pi defaults.
- Numbers in issues, pull requests and reports are copied from script output, never retyped; every
  claim comes with the command that reproduces it.
- No emojis in committed files. Commit prefixes `[feat] [bug] [docs] [test]`.

## Skills

Discover `.agents/skills/*/SKILL.md` (`esmiles-2.0`, `molparser-extended-smiles`, `fhr-rgroup`,
`repo-development`). They are excluded from the docker image and must never be added to the
extraction agent's skill list.

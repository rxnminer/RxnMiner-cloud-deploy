# RxnMiner

RxnMiner is a multimodal agent that turns one chemistry figure (a reaction scheme, a
substrate-scope table, an optimization table, a multistep sequence) into structured V2 JSON:
every concrete reaction with reactants and products as SMILES including stereochemistry,
plus conditions and yields. It is the agent evaluated in the ChemRxn-Bench paper.

The agent is a [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) session that
reads a Skill and drives eight deterministic chemistry tools over MCP. The model does the
reading and the chemical reasoning; the tools do OCSR (through MolParser), R-group reverse
assembly, SMILES verification, strict V2 assembly and visual review. This repository holds
everything that defines the agent. Only the model credentials, the MolParser endpoint and the
figure come from you.

## How one figure is processed

```
figure.png
   |  read SKILL.md and LESSONS.md              (gated: no chemistry tool before both are read)
   v
detect          MolParser OCSR -> overview PNG, comparison grid, one audit crop per molecule
   |  the model inspects every crop against the OCSR reading
   v
verify_smiles   RDKit parse + rendering for every concrete reactant and product
reverse_assemble / reverse_rgroup / fill_rgroup   derive undrawn reactants from the Markush template
   v
assemble        strict V2 JSON at /app/answer.json  (schema-validated, provenance per molecule;
                every concrete molecule carries `smiles` = plain canonical SMILES next to the verbatim `E-SMILES`)
   v
render_reactions   HTML + PNG review of the assembled answer; the model checks it before finishing
```

The nine tools and what they do:

| tool | role |
|---|---|
| `detect` | run MolParser on the figure, write overview / grid / per-molecule audit crops |
| `ocsr_detect` | raw MolParser detections without the visual workflow |
| `verify_smiles` | RDKit validity, canonical form, CIP labels, rendered image |
| `expand_abbreviation` | look up standard printed substituent abbreviations without guessing |
| `reverse_rgroup` | map a concrete product onto the Markush template to recover R-group values |
| `fill_rgroup` | substitute R-group values into a template |
| `reverse_assemble` | derive the concrete reactants of a scope entry from template + product |
| `assemble` | build and validate the final V2 object from the model's plan |
| `render_reactions` | render the assembled V2 for visual review |

## Layout

```
skills/reaction-extract/    SKILL.md (workflow), LESSONS.md (general rules), references/
skills/reaction-verify/     review skill
prompts/                    task_instruction.md, execution_contract.txt, network_policy_offline.txt
pi-extension/index.ts       Pi native extension: registers the tools, gates perception on the Skill
tools/                      chem_mcp.py (the 9 tools), ocsr_client.py, render_v2.py, skill_lint.py, ...
engine/                     v2.py (V2 assembler), markush.py, uniparser_to_v2.py, markush_substitute.py
scripts/                    run_chem_mcp.py (MCP stdio server), chem_tool.py (CLI client), smoke_test.py
third_party/                molecular_assembly, molecular_assembly_v2, molparser_utils (see THIRD_PARTY.md)
runtime/                    pi.version (Node 22.19.0, Pi 0.82.1), models.example.json, install.sh
bin/rxnminer                the runner: check | prompt | extract
docker/                     Dockerfile (reference image), build.sh, run.sh
examples/suzuki-demo/       a synthetic figure with its expected answer, for smoke tests
tests/                      unit tests (pytest)
requirements.txt            pinned Python set of the reference image (rdkit 2022.9.5)
```

## Quick start with Docker (the reference environment)

```bash
git clone git@github.com:bbkevin1016/RxnMiner.git && cd RxnMiner
bash docker/build.sh                       # builds rxnminer:local (proxy/mirror knobs in the script)

export ANTHROPIC_BASE_URL=https://<anthropic-messages endpoint>
export ANTHROPIC_API_KEY=<key>
export MOLPARSER_URL=http://<molparser host>/extract-mol
bash docker/run.sh examples/suzuki-demo/figure.png out/suzuki-demo
```

`out/suzuki-demo/answer.json` is the extraction. Next to it: `plan.json` (the model's plan the
assembler consumed), `review.html` and `review.png`, the detect crops, `prompt.txt` (exactly what
the model received), `pi.log`, `run.json` (provider, model, timings, artifact hashes) and the full
Pi session under `pi-agent-dir/sessions/` (every tool call and every image the model looked at).
`examples/suzuki-demo/README.md` shows how to compare the answer with the expected one.

## Quick start on the host

```bash
bash runtime/install.sh                    # pinned Node + Pi under ./node_modules, pinned Python deps
python3 bin/rxnminer check                 # runtime, deps, MolParser, payload
python3 bin/rxnminer extract figure.png --out out/figure1 --workdir /app
```

`--workdir /app` reproduces the paper lane byte for byte (the prompt names `/app/figure.png` and
`/app/answer.json`). Any other directory works; the runner rewrites the paths in the prompt.

## What a run costs

A substrate-scope figure with 10 to 25 molecules takes 10 to 40 minutes and 40 to 70 tool calls
with Claude Opus 5; roughly 1 to 2 USD per figure at list prices. The model reads every audit crop,
so most of the prompt is images.

## Reproducing the paper lane

The paper numbers were produced with, per figure:

- model `Claude-Opus-5` through an Anthropic-messages gateway; profile `anthropic` in
  `runtime/models.example.json` (thinking enabled, prompt caching on, adaptive thinking off);
- prompt `prompts/task_instruction.md` + `HARBOR EXECUTION CONTRACT (mandatory):` +
  `prompts/execution_contract.txt`; closed-book runs add `prompts/network_policy_offline.txt`
  with the model host filled in;
- Pi invoked exactly as `bin/rxnminer extract` does: `--print --mode text --no-context-files
  --no-skills --skill skills/reaction-extract --no-extensions -e pi-extension/index.ts --approve`,
  working directory `/app`, environment `CHEMRXN_SKILLS=reaction-extract`.

`python3 bin/rxnminer prompt --closed-book <host>` prints that prompt verbatim; it has been checked
byte for byte against a recorded benchmark session. Network enforcement for closed-book runs (an
allow-list proxy around the container) belongs to the benchmark harness, not to this repository;
the policy paragraph only tells the model.

Two settings matter for getting the same behavior:

1. Keep `forceAdaptiveThinking: false`. With adaptive thinking some gateways route the request to
   a backend that returns no thinking blocks and no prompt cache, and the model then loops on shell
   commands instead of reading the Skill.
2. Keep rdkit at 2022.9.5. Canonical SMILES differ across rdkit versions and the benchmark scorer
   compares canonical strings.

## Changing the agent

| you want to change | edit | then |
|---|---|---|
| a general extraction rule (stereo, identifiers, table rows, ...) | `skills/reaction-extract/LESSONS.md` | `python3 tools/skill_lint.py skills/reaction-extract/SKILL.md skills/reaction-extract/LESSONS.md` |
| the read-first workflow itself | `skills/reaction-extract/SKILL.md` | same lint; keep the phrases `tests/test_pi_direct_extraction_boundary.py` asserts |
| what a tool does or returns (crop size, rendering, checks) | `tools/chem_mcp.py` | `PYTHONPATH=. python3 scripts/smoke_test.py` |
| the perception gate or how tool results reach the model | `pi-extension/index.ts` | run one figure |
| the execution contract (what the model is told to do) | `prompts/execution_contract.txt` | `tests/test_rxnminer_runner.py`; note this changes the paper prompt |
| the V2 assembler or Markush engine | `engine/` | unit tests + one figure |
| model, endpoint, context/max tokens | `runtime/models.example.json` | `bin/rxnminer check` |

Skill documents must never contain figure-specific answers. The lint rejects concrete SMILES and
figure identifiers; keep every rule general.

## Configuration

| variable | meaning |
|---|---|
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | anthropic profile endpoint and key (`RXNMINER_BASE_URL` / `RXNMINER_API_KEY` override) |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | openai-compat profile (Azure, vLLM, a local model) |
| `MOLPARSER_URL` | MolParser OCSR endpoint used by `detect` / `ocsr_detect` |
| `OCSR_CACHE` | directory of frozen MolParser responses for offline replay |
| `RXNMINER_PI` | path to a pi binary other than `./node_modules/.bin/pi` |
| `PI_HTTP_IDLE_TIMEOUT_MS` | Pi's HTTP first-byte / in-stream silence timeout (default 300000, Pi's own; keep it at minutes) |
| `PI_RETRY_MAX_RETRIES`, `PI_RETRY_BASE_DELAY_MS`, `PI_RETRY_MAX_RETRY_DELAY_MS` | Pi's provider-error retry policy (defaults 3 / 2000 / 60000, Pi's own) |

The runner writes these into `<out>/pi-agent-dir/settings.json`; without overrides a run uses exactly
the values the benchmark sidecar runs with. `extract --timeout` (default 3600 s) caps the whole run.

MolParser is a separate OCSR service (an image-to-E-SMILES model behind an HTTP endpoint). It is
not part of this repository; without it, or without an `OCSR_CACHE` recorded from it, `detect`
cannot run. `bin/rxnminer extract --provider openai-compat --model <id>` runs the same agent on any
OpenAI-compatible endpoint.

## Tests

```bash
PYTHONPATH=. python3 -m pytest tests -q          # unit tests
PYTHONPATH=. python3 scripts/smoke_test.py       # offline end-to-end MCP smoke (9 tools, V2 assembly)
python3 tools/verify_third_party.py              # third_party manifest
```

## Licensing and provenance

`third_party/` carries three internal libraries (see `THIRD_PARTY.md`); their redistribution
rights must be confirmed before this repository is made public, and no license has been chosen
yet for the rest. Everything else is original work of the ChemRxn-Bench team. No ground truth or
benchmark figures are included; `examples/suzuki-demo` is synthetic.

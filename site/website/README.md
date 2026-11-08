# RxnMiner website

An English-only Astro site with the project overview, one visual workspace demo, and
ChemRxn-Bench comparisons. The visual palette follows the paper: blue `#7097C5` and
lavender `#B4AAD3`.

```bash
npm ci
npm run check
npm run build
npm run preview
```

The single visual demo is bundled under `public/media` and verified against
`demo-media.json` by `python scripts/audit_release.py` from the repository root. For project GitHub Pages, build with
`SITE_BASE=/RxnMiner`. From the repository root, run
`python3 scripts/verify_site.py` after that build to check local links and assets.

The benchmark covers 603 figures across 24 lanes.
Recompute the displayed aggregates with `python3 scripts/verify_benchmark.py` from
the repository root. Historical recognition results are clearly labeled.

The `/try/` page is backed by `website/demo-api/server.mjs`. In sample mode it renders the
recorded workspace without credentials. Live mode requires the local Pi runtime and
`CHEMRXN_PI_INTERNAL_TOKEN`; visitor model and UniParser keys are sent for one run only and
are kept in memory. The default server allowlist is Qwen3.8-Flash-Next and can be extended
with `RXNMINER_DEMO_MODELS_JSON`.

The default model identifier is `Qwen3.8-Flash-Next-FP8`, with the server-side
OpenAI-compatible endpoint `http://192.168.198.191:8015/v1`. Override these with
`Q38_MODEL` and `Q38_BASE_URL` in both the configuration and API processes.
Run `node website/demo-api/configure-model.mjs` and set the runtime's
`CHEMRXN_PI_MODELS_PATH` to the printed path before starting it. This generates
only endpoint/model configuration in ignored `.local/demo/models.json`, with no keys.
The runtime host must have network access to the private model endpoint.
The model catalog uses a 262,144-token context window and a 32,768-token output
limit. These settings avoid the generic custom-model defaults truncating a large
figure extraction before its final render. They do not guarantee extraction quality.

### Official RxnMiner harness (current live deployment)

Use a checkout of `bbkevin1016/RxnMiner-dev` (verified at `a0f7848`) and its pinned
Node 22.19.0, Pi 0.82.1, Python 3.11 and RDKit 2022.9.5 environment.
Configure the endpoint capacity using
`node website/demo-api/configure-harness.mjs /absolute/path/to/RxnMiner-dev`.
Install the UniParser SDK pinned in `RxnMiner/figure_skills/requirements.txt` in
that Python environment as well.

Set `RXNMINER_DEMO_HARNESS_ROOT` to that checkout, `RXNMINER_DEMO_PYTHON` to
its Python executable, and optionally `RXNMINER_DEMO_DATA_ROOT` to a private job
directory. Start `node website/demo-api/server.mjs`. The harness setting selects
the CLI backend instead of the legacy embedded Pi runtime.

Each request invokes the repository's **unmodified `bin/rxnminer extract`** with
its native extension, Skill/LESSONS read gate, execution contract, automatic
compaction and length recovery. The only checkout configuration adjustment is
the OpenAI-compatible profile's capacity (262,144 context / 32,000 output).
The wrapper provides a per-run loopback MolParser-compatible transport backed by
UniParser; raw E-SMILES and molecule source boxes pass through unchanged.
Keys are supplied through the child environment, not command-line arguments or
model configuration files. The model subprocess has the normal capabilities of
the official harness; deploy each public tenant in a separate sandbox before
exposing this service publicly. Current verification uses a private SSH tunnel.

Job outputs and transcripts remain in the private data directory for debugging.
Only the input image, complete answer JSON and review PNG are served by the API.
The API requires a successful runner exit and `answer_complete` before displaying
success; intermediate candidate files are never returned as completed results.

`RXNMINER_DEMO_MAX_CONCURRENT` bounds active harness processes (the intranet
deployment uses 4). `RXNMINER_DEMO_MAX_ACTIVE_PER_IP` and
`RXNMINER_DEMO_MAX_RUNS_PER_IP` are separate abuse limits; set them higher on a
trusted network where several colleagues share one NAT address, while keeping
the global worker bound as the resource limit.

### Per-run usage and estimated cost

Configure `RXNMINER_BILLING_CURRENCY` (ISO code, default USD) and nonnegative
`RXNMINER_PRICE_INPUT_PER_MILLION`, `RXNMINER_PRICE_OUTPUT_PER_MILLION`,
`RXNMINER_PRICE_CACHE_READ_PER_MILLION`, `RXNMINER_PRICE_CACHE_WRITE_PER_MILLION`,
and `RXNMINER_PRICE_UNIPARSER_PER_IMAGE`. Missing rates mean unknown, not free.
Rates are snapshotted in each new job's metadata; historical jobs without a
snapshot do not acquire today's prices retroactively.

Model usage uses Pi's normalized input/output/cache fields and recorded compaction
usage. Reasoning tokens are included in output and are not charged twice.
UniParser is metered at the live transport boundary, not from detect tool calls
(which can hit cache). Its estimate uses successful submitted images. Missing
historical metering and missing model usage are explicitly disclosed.
These are estimates, not provider invoices or platform deductions. Unreported
retries and failed requests may have additional provider charges.

Each allowlisted model must also exist in the Pi runtime model catalog and support
image input. Offline entries remain selectable; only Run extraction is disabled.
The recorded sample works without credentials and offers the same reaction viewer
and full JSON download. Molecular diagrams use the bundled RDKit renderer;
E-SMILES extensions are preserved in the disclosure and JSON, while diagrams show
the SMILES backbone. No external structure-rendering service receives these strings.

Run `node --test website/demo-api/server.test.mjs` from the repository root for
API sample, model availability, and failed-start cleanup checks.

```bash
npm --prefix website run demo:api
PUBLIC_DEMO_API_URL=http://127.0.0.1:4322/api/demo npm --prefix website run dev
```

Put the live API behind HTTPS before accepting remote credentials. The extraction prompt
requires MolParser E-SMILES 2.0 strings to remain byte-preserved, including `<sep>` and
extension tags; the pinned reference is
`RxnMiner/figure_skills/skills/reaction-extract/references/extended-smiles-2.0.md`.

See [deployment](../docs/website.md) for the workflow and hosting requirements.

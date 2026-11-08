---
name: reaction-extract
description: >
  Extract every reaction from ONE chemistry figure (a scheme, a substrate-scope table, an
  optimization table, a multistep sequence) into structured V2 JSON. Read-first: OCSR
  (MolParser) reads the drawn structures for you and you USE those reads; the fhr R-group
  engine derives the parts that are only drawn as a generic template; you read the printed
  numbers and conditions off the image; the engine assembles the strict V2 so you never
  hand-hold the schema. Use when the user gives a reaction figure and wants it extracted.
---

# Reaction extraction (read-first)

This canonical Agent Skill is shared by Claude Code, Codex, and Pi. The harness adapter
changes, but the Skill, `chemrxn-extract` chemistry server, FHR engine, V2 contract, and evidence rules do
not. The active harness records its actual agent, model, Skill revision, and tool provenance outside this
document; never label a Claude/Codex run as Pi-direct.

Before doing anything else, read `LESSONS.md` in this skill directory completely
and apply its general extraction rules throughout the task. When `detect` returns any
`esmi` containing `<sep>` or extension tags, read
`references/extended-smiles-2.0.md` before interpreting its labels or using reverse/fill.

You are extracting **one figure** into our V2 JSON. The core idea: **do not re-draw structures
that are already drawn.** OCSR is the default transcription, but the compare grid can expose a
specific conflict with explicit image evidence; correct that conflict instead of blindly copying it.
Your job is to *bind* (which structure is which, its number, its role, its conditions)
and to *derive* only the parts that are not drawn — then let the engine format the V2.

## Failed trials keep their product

A scope table draws the intended product for every entry, including the ones that did not work.
When a cell reads `n.r.`, `ND`, `trace` or `0%`, extract the row like any other - reactants,
the drawn product, conditions - then set `failed: true` and record the outcome verbatim in
`metrics` as `{"role": "yield", "text": "0%"}`. Dropping the product would discard a structure
the figure states and leave no way to tell it apart from a row whose product was never drawn.

Two things that are not failures: a low yield is a reaction that worked, and a control row that
gives nothing by design belongs to the optimization table, not here.

## Extractor ownership (non-negotiable)

**You, the current Claude Code, Codex, or Pi session, are the extractor.** Read this Skill and its
delegated references, inspect the image/evidence yourself, make the chemical decisions, call the canonical
chemistry tools, and author the pre-GT plan in this same run. Do not hand extraction to a one-shot VLM,
Gemini/baseline endpoint, nested agent, workflow/subagent, or hidden helper model. A deterministic script
may store a large plan, perform a mechanical graph transform, or validate an exact roundtrip, but it must
not become an unrecorded second chemical decision-maker. Keep every chemical decision and tool outcome
attributable to this recorded agent session.

This does not forbid visual reasoning: MolParser reads drawn structures, while you must read printed text,
roles, colors, conditions, identifiers, and crop evidence from the figure. It forbids outsourcing that
reasoning to another model and then presenting the result as direct extraction by the current harness.

## Output contract (non-negotiable)

The deliverable is the **assembled V2** (`assemble(plan)` or, for a large saved plan, `assemble(plan_path=...)` → `v2_path`). It is not done until:

- **Every example has BOTH reactants AND products.** A reaction is `reactants → products`; an
  example with `reactants: []` is INCOMPLETE and unacceptable. Deriving the reactants (below) is
  the core task, not optional polish — most figures draw the *products* of a scope table and
  leave the per-cell *reactants* for you to reconstruct.
- Every numbered cell / arrow / table row is covered, each with its printed yield.
- **An optimization table is row-level reaction data:** emit one `selected_examples` item per
  printed entry, even when all rows share the same reactants/products. Repeat the shared molecule
  sets and bind that row's catalyst/base/solvent/temperature and metrics to that example. Do not
  represent the rows only inside `optimization_runs`: that supplementary field does not replace
  row-level reactions for counting, scoring, or review.
- You do the reading/deriving; the native `assemble` tool does the V2 formatting. Never hand-emit V2 or import/call the Python engine through `bash`; save a large plan as JSON and pass `plan_path`.
- In the assembled V2 every concrete molecule and structured condition carries `smiles` (plain RDKit canonical isomeric SMILES, derived by the engine) next to `E-SMILES` (the MolParser wire form, byte-verbatim, tags and the trailing `<sep>` included). You never write `smiles` into the V2 yourself: put the structure you read into the plan's `smiles`/`molparser_esmi` and let `assemble` derive it. Templates and open Markush labels keep `E-SMILES` only.
- For an evaluated run, seal the raw prediction before GT access and record the extraction method
  (`claude-code-direct`, `codex-direct`, or `pi-direct`), Skill/repository revision, current model boundary,
  and canonical tools used. Report the sealed agent score
  separately from every post-seal Ketcher/manual correction. A reviewed uplift is not agent accuracy.

## Tools (MCP server `chem-extract`)

| tool | what it does | when |
|---|---|---|
| `detect(image_path)` | cache-first OCSR + visualization: reuses saved MolParser detections, or calls live MolParser for a new image and saves the raw result; writes an **annotated overview PNG**, **OCSR compare grid PNG**, and one enlarged raw **concrete audit crop** per concrete bbox | **first** — OPEN overview + compare grid; open a concrete crop only on T1, a grid conflict, or printed substituent/charge/ring-size text |
| `reverse_rgroup(template, concrete)` | read the R-substituents off one drawn cell given the generic template | a markush scope cell |
| `fill_rgroup(template, r_map)` | materialize a concrete molecule from a template + R-map (batch: pass a JSON list) | build undrawn reactants/products of a scope grid |
| `reverse_assemble(target_product, product_template, reactant_templates)` | derive ALL of one cell's concrete reactants in one call (peels the product's R-groups, fills every reactant template) — derives organometallics (alkylzinc etc.) the per-cell reverse+fill under-peels to None | **at most once per product cell**; never after VALID assemble; never a second template family |
| `verify_smiles(smiles, require_concrete?)` | RDKit validity + canonical forms + tetrahedral CIP R/S + double-bond E/Z + indexed SVG; for tagged Extended-SMILES also reports unsupported labels/tags, expansion, and unresolved dummies | **T1 only** (wedge, printed R/S/E/Z, grid conflict, or candidate already has `@`/`/` stereo); T0 is skip, not optional verify; `require_concrete:true` for tagged catalysts |
| `assemble(plan)` or `assemble(plan_path=...)` | turn your intermediate plan into strict V2 (preserves accepted MolParser `esmi` verbatim, canonicalises agent-built chemistry, recovers printed numbers); use `plan_path` for large tables | **last chemistry tool** — VALID then only `render_reactions` |
| `render_reactions(v2_path, image_path)` | render the V2 to a self-contained HTML and candidate PNG; the tool result attaches the PNG | the only tool allowed after VALID assemble; once |

## Hard stops (procedure errors if broken)

These override later prose. They do not skip stereo when stereo is present.

1. **Images.** After `detect`, OPEN only `overview_png` and `compare_grid_png`. OPEN a concrete
   audit crop only if that molecule is T1, the grid conflicts, or the panel prints a
   substituent / charge / ring-size label. Do not open every matching scaffold.
2. **Verify.** Call `verify_smiles` only on T1 (wedge/hash, printed R/S/E/Z, grid conflict, or
   the candidate already contains `@` / `@@` / stereo `/` `\`). If the crop has no CIP marks,
   the grid agrees, **and** the SMILES has none of those characters, do **not** call
   `verify_smiles`. Tagged catalysts still use `require_concrete:true`.
3. **Reverse.** At most **one** `reverse_assemble` per product cell that needs undrawn reactants.
   If that call returns ok, do not call it again for the same cell. Do not start a second template
   family. Do not call `reverse_assemble` after `assemble` has returned VALID.
4. **Stop.** When `assemble` returns VALID, the next tool is `render_reactions` once, then you
   are done. After VALID, do not `bash`, do not grep `engine/v2.py` or `reaction_class`, do not
   run `chem_tool.py --help`, do not `verify_smiles`, do not `reverse_assemble`, do not `detect`.
5. **Fields.** A successful fill of a **reactant template** (`*Br`, ArX, RZnX, other
   atom-transfer templates) stays in `reactants`. Printed arrow text for catalysts, solvents,
   bases, salts, and reagent formulae that are not a filled reactant template stays condition
   `text`. Do not invent a reactant SMILES from ordinary condition text.

Call native tools only. `assemble` output is the scored V2.

1. **`detect(image)`.** OPEN `overview_png` and `compare_grid_png`. Create an independent source inventory
   before binding detections to reactions: every visible molecular region, arrow, and table cell must be
   accounted for as emitted, explicitly excluded, masked, or unresolved. Use live or cached
   MolParser as the tool reports (`ocsr.source`); never claim a cache hit when the source says
   `live_molparser`. Carry **only `esmi`** forward, byte-verbatim. Compare each `drawn (figure)`
   panel with `OCSR esmi (verbatim)`. Printed n-/i-/t- alkyl, Et/Me, ring size, charge, or a mapped
   stereobond is a mandatory conflict check. Put `molparser_esmi` and
   `ocsr_audit:{decision:"accepted"|"override", evidence:"..."}` on every concrete molecule.
   `assemble` fails closed without that audit.

2. **T0 vs T1 (the verify gate). Stereo is never optional.**
   Treat each molecule separately. A table that "looks simple" is still T1 for any cell that has stereo.
   - **T1 — must `verify_smiles`:** any wedge/hash/dash, printed R/S/E/Z, a compare-grid conflict,
     **or** the candidate SMILES already contains `@`/`@@` or stereo `/` `\`. OPEN that bbox's audit
     crop. Inspect the automatically attached clean and atom-indexed PNG. Map crop wedges to the tool
     drawing; never flip `@` or `/` by intuition. Specified alkenes need `rdkit_ez`. Tagged
     catalysts/conditions still use `verify_smiles(..., require_concrete:true)`.
     A double bond whose geometry is drawn (cis/trans visible between distinct substituents) is T1
     even when the MolParser `esmi` carries no geometry: verify it and write the geometry you read.
     OCSR not carrying a stereo mark is never a reason to record `unspecified`.
     For tetrahedral stereo, copy every assigned `stereocenters` row's `atom_index` and `cip` from
     `verify_smiles` into `stereo_audit.cip`, and put its `verified_smiles` in `stereo_audit.smiles`
     so the indices survive canonical atom reordering. If any tetrahedral centre is assigned, the
     decision is `specified`; when the alkene and tetrahedral decisions differ, keep `decision` for
     E/Z and add `tetrahedral_decision` for the centres. `assemble` rejects a missing or
     inconsistent audit; CIP consistency alone does not prove the crop was read correctly.
   - **T0 — skip verify only here:** no CIP marks in the crop, compare-grid agrees, **and** the
     candidate has no `@`/`@@` and no stereo slashes. `ocsr_audit=accepted`. Still record
     `stereo_audit` as `unspecified`/`ambiguous` plus crop evidence for every potential alkene and
     every potential tetrahedral centre (RDKit lists them even when unassigned) so assemble does not
     fail closed. Do not open every identical matching scaffold.

   **A printed abbreviation is resolved, not guessed.** This is about NAMED groups (Bn, Boc, Ts, TBS,
   PMB, PIP): expand them with `expand_abbreviation`, or with a definition printed in the figure or
   its footnotes, and record which one decided it. It is NOT about Markush variables (R, R1, Ar, X):
   those are defined by the scope cells and you still derive them with reverse_assemble or
   reverse_rgroup. Never leave a reactant generic because an abbreviation lookup returned nothing. Two labels can differ by
   one letter and mean very different groups, and a wrong expansion rewrites every cell that carries
   it. If the tool has no entry and the figure defines nothing, keep the label and mark the molecule
   unresolved.

3. **Read off the IMAGE (not from OCSR):**
   - `identifier` = the **printed compound number** beside the structure (e.g. `39`), **not** the
     `bbox_index`. If no number is printed but the title/caption explicitly names that molecule,
     use the printed chemical name; only then fall back to `p<bbox_index>`.
   - `metrics` = the printed yield / ee / dr (keep the `%`).
   - `conditions` = the arrow gives the standard set; **per-cell superscript letters (a,b,c…)
     map to footnote variations** — capture each cell's letters and read the footnote mapping.
     Never emit a condition as a bare number. Printed arrow text stays as condition `text`.
   - `amount` = a reactant's drawn stoichiometry (`1.2 equiv`) if shown.
   - `description` = what distinguishes this cell (its R-values / scope variable / table entry).
   - stereochemistry = transcribe every visible R/S/E/Z label and wedge/dash relationship, then validate
     it against `verify_smiles` CIP/E-Z output before assembly.

4. **Derive each cell's reactants (REQUIRED — the hard, essential part).** A scope table draws the
   generic reaction once (the top scheme: reactant templates + arrow) and then draws only each
   *product*. Reconstruct every cell's reactants. **Two routes — pick by the scope type:**

   **(a) Mechanism reasoning (DEFAULT — use for multi-component or topology-varying scopes).**
   Read the top scheme to understand the transformation (which reactant contributes which fragment,
   at which position). Then for each product, DECOMPOSE it by mechanism: work out which piece of
   the product came from which reactant template, and write each reactant's CONCRETE SMILES —
   including its regiochemistry (which carbon carries which group). This is real retrosynthesis, and
   the model does it well where pure graph-matching fails (e.g. an organozinc `R-[Zn]Br`, or a
   product whose ring/topology differs cell-to-cell). Sanity-check: mentally re-run the forward
   reaction on your three reactants — it must reproduce the drawn product. `verify_smiles` each
   reactant.

   **(b) Deterministic reverse-assemble (use for an R-substitution / scope grid).** Efficiency cap:
   one `reverse_assemble` per product cell that needs undrawn reactants (the same template pair for
   every cell of that grid). If the first call for a cell is ok, do not retry that cell. Do not
   start extra unrelated families. Before each call,
   independently inspect the source crop for the generic product and reactant templates. Keep only
   stereo markers explicitly drawn or printed in those templates; an OCSR stereo marker that the crop
   does not specify must be treated as unspecified so it is not amplified across every scope cell. For a cell,
   call `reverse_assemble(concrete_product, product_template, [reactant_templates])` — it peels the
   product's R-groups against the product template and fills EVERY reactant template in one call,
   **returning that cell's concrete reactants (aligned with the templates)**. Put every successful
   fill into that example's `reactants` — including a coupling partner whose generic form is a
   reactant template (`*Br`, ArX, RZnX, and other atom-transfer partners). This is the correct fhr
   entry and derives organometallics (e.g. an alkylzinc `Br[Zn]C1CCC1`) that the older per-cell
   `reverse_rgroup`+`fill_rgroup` path under-peels to None. Copy any fixed reactant from its
   detection `esmi`. (`reverse_rgroup`/`fill_rgroup` remain for reading/building a single R-position
   when you want finer control.) If a reactant comes back `partial`/None (e.g. an under-tagged aryl
   ring substituent), fall back to mechanism reasoning (a) for that reactant. Even when it reports an
   exact product roundtrip, reject a chemically degenerate partition where a named variable collapses
   to hydrogen/a trivial fragment or one reactant absorbs essentially the whole product without image
   support. Exact closure is necessary, not sufficient: each variable fragment must be nontrivial when
   the drawing says so and grounded by the template/crop.

   Classify every derived reactant as `drawn`, `uniquely_derivable`, or `unresolved`. Mechanistic
   plausibility, product closure, or FHR roundtrip alone cannot upgrade a reactant to
   `uniquely_derivable`; the source must constrain it to one structure. Never leave `reactants: []`.
   If a reactant is genuinely underivable, emit its template smi (with `*`) and an unresolved note
   instead of guessing a concrete partner. Mechanism reasoning may produce a concrete reactant only
   when the source plus transformation uniquely determine it. The derived reactant must also match the
   substitution pattern of the drawn generic reactant template, including double-bond position and
   substitution degree. A chemically plausible isomer that violates the template pattern is unresolved,
   not a valid fallback.

5. **Build the intermediate plan** — one entry per numbered cell **or optimization-table row**,
   WITH reactants populated. For an optimization table, the printed Entry number is the
   `instance_id`; reuse the shared drawn reactants/products in every row and put conversion,
   product ratio, yield, and that row's conditions on the same example. Preserve every printed
   metric even if one metric is absent in another annotation source. Then build:
   `{selected_examples:[{reactants:[{smiles,identifier,bbox_index,bbox,amount}], products:[{smiles,
   identifier,bbox_index,bbox,bbox_inherit?,molparser_esmi?,ocsr_audit:{decision,evidence},ocsr_override?:{reason,evidence},stereo_audit?:{decision,evidence,rdkit_ez?,smiles?,cip?:[{atom_index,cip}],tetrahedral_decision?}}], conditions:[[{role,text,smiles?,bbox_index?,bbox?}]], identifier,
   description, markush_enumeration:{R1:"*frag",...}}], reaction_templates:[...]}`. For every drawn
   molecule (including a structurally drawn condition), copy BOTH `bbox_index` and the four-coordinate
   `bbox` from `detect`; do not make downstream viewers re-query OCSR to recover localization.

   `reverse_assemble` fills of a **reactant template** stay in `reactants`. Arrow-printed catalysts,
   solvents, bases, salts, and reagent formulae that were not produced by filling a reactant template
   stay in `conditions` as printed `text` with no invented `smiles`. Do not move a filled
   reactant-template partner (`*Br`, ArX, RZnX) into `conditions` merely because the same material is
   also written above the arrow. Do not turn ordinary condition text into an extra reactant. Add a
   condition `smiles` and its drawn `bbox` only when the source explicitly draws that condition or an
   explicit code maps to a drawn molecule.

   Before deciding topology, write an arrow ledger: one line per visible reaction arrow with its input
   structure(s), output structure(s), and whether that output is reused downstream. If any later arrow
   consumes a structure produced by an earlier arrow—even when the repeated structure is still generic
   and the later panel merely varies a metal/reagent—this is a chained synthesis. Set
   `is_multistep:true`, add a `synthesis_overview`, give the linked templates/examples `_multistep`
   metadata, and emit one `reaction_graph` edge per arrow using the same molecule identifiers as the
   examples. An explicitly drawn/named intermediate plus a new condition arrow is a separate reaction
   step: use that intermediate as the next step's reactant rather than coupling the original precursor
   directly to the final product. Multiple independent alternative arrows may remain single-step, but
   the arrow ledger must explicitly say that no product is reused.
   For yields/ee/dr,
   set metric `of` only when the number is printed for one specific product; leave a combined row yield
   unlinked in a multi-product reaction.

6. **Assemble once, then stop.** `assemble(plan)` or `assemble(plan_path=...)`. If VERDICT is INVALID,
   fix the named gate and assemble again. If VALID, `render_reactions` once, glance at the PNG, and
   **stop**. Seal this extraction as the immutable candidate before any optional verification stage.
   After VALID, any `bash` / grep / extra `verify_smiles` / extra `reverse_assemble` is a
   procedure error. Do not fish for missing keys.

## Rules

- **The drawing is the authority; OCSR is the default transcription, not ground truth.** Do not re-type
  a whole structure from scratch, but do correct a localized conflict supported by explicit image
  evidence through `ocsr_override`, retaining the raw OCSR read for audit.
- **identifier = printed number, never the bbox index.**
- **Cover every numbered cell / arrow / table row** — one example each, with its yield.
- **Reactants that are not drawn** (implied coupling partners, the standard partner of a scope
  panel) you derive by reverse/fill or by reasoning — do not leave them empty, but do not invent
  a structure the chemistry does not support. A `reverse_assemble` fill of a reactant template
  (`*Br`, ArX, RZnX) belongs in `reactants` even when that partner is also named in the arrow text.
  Printed condition formulae (Grignard as `RMgX`, salts, solvents, catalysts, arrow-only diboron
  that is not a filled reactant template) stay condition `text`. Add `smiles` on a condition only
  for an explicitly drawn structure or a clearly mapped drawn code.
- **You produce understanding; the engine produces V2.** Don't fight the schema — put what you
  read into the plan and let `assemble` format it.

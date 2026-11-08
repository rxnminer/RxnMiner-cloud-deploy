# LESSONS — accumulated GENERAL extraction rules (read together with SKILL.md)

These are *rules of process*, distilled from scored errors on the TRAIN split, never figure-specific
answers. Each entry is a general instruction that improved held-out VAL when added. Do not put any
concrete SMILES or figure id here (the loop runs `tools/skill_lint.py` and rejects it). Keep entries
short and imperative.

## Compact run order (hard stops)
- After `assemble` prints VALID, the next tool is `render_reactions` once, then stop. After VALID,
  do not `bash`, do not grep the engine, do not invent `reaction_class`, do not call
  `verify_smiles` or `reverse_assemble`.
- Stereo is never optional: wedge/hash, printed R/S/E/Z, grid conflict, or a candidate that already
  has `@`/`@@` or stereo slashes → T1, `verify_smiles`, open the attached PNGs. Never flip by intuition.
- T0 (no CIP in crop **and** no `@`/`/` in the SMILES, grid agrees): skip `verify_smiles`. Calling
  it on T0 is a procedure error. Do not open every identical matching scaffold.
- At most one `reverse_assemble` per product cell; do not retry an ok cell; do not start a second
  template family; do not reverse after VALID.
- A filled **reactant template** (`*Br`, ArX, RZnX) stays in `reactants`. Printed condition
  formulae, salts, solvents, and catalysts stay condition `text`. Do not invent a reactant from
  ordinary arrow text.
- Do not upsample crops with PIL or bash `.resize`.

## Run ownership and evaluation hygiene
- **The current Pi is the extractor.** It must read the Skill, inspect image evidence, make every chemical
  decision, and call the canonical tools in one attributable run. Never substitute an external one-shot
  VLM, nested agent, workflow/subagent, or analyst-authored answer and report it as Pi-direct extraction.
  Deterministic helper code may store data or validate mechanical graph closure, but may not hide a second
  chemical decision-maker.
- Seal the raw prediction before GT access. Report the sealed agent score separately from every post-seal
  Ketcher/manual correction; reviewed uplift measures human correction, not agent accuracy.

## Format & fields
- **identifier = the printed compound number/letter beside the structure** (e.g. a numeral, or a
  numeral+letter). If a cell has no printed number, fall back to `p<bbox_index>` — NEVER invent a
  semantic placeholder like `selected-example-N`, `entry-N`, or `scope-N`. (Placeholder identifiers
  were ~40% of one agent's outputs and are always wrong against GT.)
- If a drawn reactant has no compound number but the figure title/caption explicitly prints its
  chemical name, use that printed name as the identifier; use `p<bbox>` only when neither a number
  nor an explicit name is available.
- **Do not over-materialize the templates.** When you enumerate a scope grid into concrete cells,
  still emit the generic `reaction_templates` (markush) block — keep its wildcards. The general-form
  score reads `reaction_templates`; dropping/flattening it into only concrete examples loses that
  credit even when the concrete molecules are correct.
- Every example must be `reactants -> products` complete; never emit an example with an empty
  reactant list or empty product list.
- **Optimization tables require one concrete example per printed row.** Reuse the shared molecule
  sets, but attach each row's conditions and metrics to its own `selected_examples` item;
  `optimization_runs` may supplement these rows but must not replace them.

## Reading structures
- **Concrete (markush:false) detections: use OCSR by default, but reconcile explicit image conflicts.**
  Re-typing a whole drawn structure is net-negative. However, when the compare grid/crop explicitly
  labels a substituent, ring size, charge, or mapped stereobond that conflicts with OCSR, correct only
  that localized feature, verify the corrected SMILES, retain verbatim `molparser_esmi`, and record a non-empty
  `ocsr_override:{reason,evidence}`. Open the compare grid for every concrete read. Open an individual
  audit crop on T1, a grid conflict, or printed substituent/charge/ring-size text — not every identical
  matching scaffold. Record `ocsr_audit:{decision,evidence}`; verify_smiles renderings do not replace
  these raw source crops. Assembly fails closed when a raw concrete read lacks this audit. Never mutate the raw
  MolParser cache.
- **Double-check bulky/similar alkyl groups against the crop.** Look-alike substituents (e.g. a
  tert-butyl vs an iso-amyl vs an iso-butyl group) are a recurring shared misread; printed n-/i-/t-
  labels are authoritative evidence and must be reconciled before propagating a repeated scope group.
- For a long unbranched chain, count every visible zig-zag vertex in the enlarged crop and compare it with
  the OCSR rendering. A high OCSR confidence score does not validate chain length or excuse a one-carbon
  insertion/deletion.
- **Tagged E-SMILES preservation is not concrete validation.** For a catalyst, counterion, ligand, or
  other concrete tagged structure, run `verify_smiles` with `require_concrete:true`. A parse of only the
  wildcard body does not prove the extension labels were expanded or charge-balanced. If labels/tags are
  unsupported or dummies remain, retain the raw OCSR string only as provenance and either make a localized
  image-grounded concrete override or fail closed; never publish the unresolved body as concrete chemistry.
- **A drawn coordination closure is chemical connectivity, not optional decoration.** If a crop explicitly
  shows an O→B, N→metal, or other dotted/dative closure but OCSR omits it, `ocsr_audit.decision:"accepted"`
  is forbidden: create an image-grounded override, verify a charge-balanced representation, and preserve
  the closure in every applicable concrete cell. For an N-oxide/borane adduct, a neutral open borane plus
  disconnected O− is incomplete; use a valid charge-separated B−–O–N+ representation when supported, or
  fail closed and report the unsupported coordination instead of silently dropping the bond. If otherwise
  analogous scope products inconsistently contain or omit the closure, treat that as an OCSR conflict and
  reconcile every row against its own enlarged crop.

## Deriving undrawn reactants
- **Prefer the reactant that is actually drawn.** If a reactant is drawn (a fixed coupling partner,
  a shown precursor), use its detection; only derive by reverse-assemble / mechanism reasoning the
  reactants that are NOT drawn. GT usually lists the drawn precursor, so a mechanistically-split
  intermediate can score as a mismatch even when it is chemically equivalent.
- Deterministic reverse-assemble and model mechanism-reasoning give ~equal reactant accuracy; use
  reverse-assemble first for a clean R-substitution scope, fall back to reasoning when it returns
  partial/none. Inspect the generic template's source crop before reverse-assemble and do not amplify an
  OCSR stereo marker that the drawing does not specify. Exact product roundtrip is necessary but not
  sufficient: reject a degenerate partition where a named variable collapses to hydrogen/a trivial
  fragment or another reactant absorbs essentially the whole product without image support.
- **Put a successful reactant-template fill in `reactants`.** Classify `drawn` /
  `uniquely_derivable` / `unresolved`. Never leave `reactants: []`. Do not relocate `*Br` / ArX /
  RZnX into `conditions`. Do not create an extra reactant from printed Grignard formulae, salts,
  solvents, catalysts, or other ordinary condition text.
- Mechanism-derived reactants must match the drawn generic reactant template's substitution pattern,
  including double-bond position and substitution degree. A chemically plausible constitutional isomer
  that violates the template pattern is unresolved, not a valid fallback.
- An explicit intermediate followed by a new condition arrow is a separate reaction step. Emit it and use
  that intermediate as the next step's reactant; do not skip directly from the original precursor to the
  final product merely because the final product can be reconstructed. Count every visible arrow before
  planning: when a later panel reuses a prior generic product, set `is_multistep:true` and connect the
  steps in `reaction_graph`; multiple templates do not excuse an empty graph.

## Stereochemistry: verify before declaring a perception ceiling
- **An explicit R/S/E/Z label or wedge/dash is actionable evidence.** Run `verify_smiles`, inspect the
  atom-indexed rendering, and compare RDKit CIP/E-Z to the figure. Correct only a mapped, unambiguous
  mismatch and verify again; never blindly flip SMILES stereo characters.
- Element accounting never moves a material between fields. A reagent printed on the arrow stays
  condition `text` even when it contributes atoms to the product (a salt, an acid chloride, a
  boron reagent); a filled reactant template stays in `reactants`. `assemble` reports
  `atom_sources_unmatched` for information only and does not fail closed on it; do not add a
  reactant or invent a condition SMILES to make that number zero.
- Every potentially stereogenic double bond, including C=C, C=N, S=N, N=N, and P=N, requires a
  mapped `stereo_audit`, whether or not an explicit stereodescriptor is printed. Compare the two
  substituent pairs in the enlarged crop, verify the candidate with
  RDKit E/Z when supported, and record `specified` plus `rdkit_ez`; otherwise explicitly record
  `unspecified` or `ambiguous`. For double bonds, a clear relative arrangement of the substituents
  in the source may justify E/Z notation even without a wedge/dash or printed stereodescriptor.
  Never inherit OCSR `@`/`@@` or slash notation when the crop does not specify
  it; preserve the raw OCSR only in provenance and use an image-grounded override for the unspecified
  candidate.
- Treat strict stereo as a perception ceiling only when the drawing is genuinely unreadable, ambiguous,
  or does not specify it. A printed descriptor can itself conflict with a drawn stereobond: for an
  image-extraction task, preserve the mapped drawing in the structure, retain the printed descriptor as
  text, and flag the conflict rather than silently changing either. Report nostereo and strict-isomeric
  scores separately; a nostereo match is not a fully correct structure.

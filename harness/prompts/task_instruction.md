# Extract every concrete reaction from a chemistry figure

The reaction figure is at `/app/figure.png`. Read it and extract every concrete reaction.

# Task: Extract every reaction from a chemistry figure into our V2 schema

You are given ONE reaction figure - a journal graphical abstract, a substrate-scope grid, a
condition-optimization table, or a multi-step synthesis scheme. Extract every reaction into the
**V2 JSON schema below**. This is the exact schema our ground truth is annotated in and our
extraction agent already emits, so your output and the reference use ONE format.

Return a single JSON object. The complete V2 object is expected for downstream use (viewer,
annotation). The frozen scorer currently consumes only the fields listed under **How you are
scored**; the other V2 fields are retained but do not yet change the score. Array ORDER and
equivalent (canonicalizable) SMILES SPELLING do not matter, but JSON NESTING and the scorer-read
FIELD NAMES do.

--------------------------------------------------------------------------------
## The V2 schema (what you must output)

```json
{
  "reaction_class": "<named reaction / transformation, e.g. 'Suzuki coupling'; '' if unknown>",
  "is_multistep": false,
  "selected_examples":  [ <Reaction>, ... ],
  "reaction_graph":     [ <Edge>, ... ]
}
```

A **molecule** (every reactant / product) is:

```json
{"identifier": "3a", "SMILES": "<SMILES>", "bbox": [x0, y0, x1, y1]}
```
- `identifier`: the compound label. Use the PRINTED label verbatim (`4`, `3a`). For a molecule with
  no printed label, use a reactant-slot id (`r0`, `r1`, `p0`). **A slot id (`r0`/`r1`) MAY repeat
  across the instances of one general equation** - it names the position, not a globally-unique compound
  (this matches the GT). Distinct PRODUCTS carry distinct printed labels.
- `SMILES`: the molecule as ordinary SMILES. Every emitted molecule must be **fully concrete and
  placeholder-free** (`.` joins multi-component species). Include stereochemistry (`@ / @@`, `/ \`)
  whenever the drawing shows it - chirality is scored.
- `bbox` (pixel box `[x0,y0,x1,y1]`, top-left origin, tight around the DRAWN structure) is
  **conditionally required**: give it for a molecule drawn in full in the figure; OMIT the key for a
  molecule you inferred that is not drawn (never invent a box). A structure drawn ONCE and reused
  across rows/instances carries its `bbox` on its REFERENCE occurrence only (the first instance); the repeats omit the key.

A **condition entry** (inside `conditions`) is a DIFFERENT shape - not a molecule:

```json
{"role": "catalyst", "text": "cat. A (10 mol%)", "SMILES": "<optional structure of the reagent>"}
```
- `role` in: `catalyst | reagent | ligand | base | acid | additive | solvent | oxidant |
  reductant | light | temperature | time | atmosphere` (fallback `reagent`).
- `text`: the reagent IDENTITY plus amount (e.g. `"Pd(OAc)2 (5 mol%)"`, `"K2CO3 (2 equiv)"`,
  `"DMF"`, `"80 C"`). An amount alone (`"(10 mol%)"`) has no identity and scores poorly.
- `SMILES`: optional; give the reagent structure when known (it is then matched by SMILES).
- Condition entries normally have NO `identifier` / `bbox`.

A **Reaction** (one entry in `selected_examples`) = one CONCRETE reaction:

```json
{
  "instance_id": "4",
  "reactants": [ <molecule>, ... ],
  "products":  [ <molecule>, ... ],
  "conditions": [ [ <condition entry>, <condition entry> ] ],
  "metrics": [ {"role":"yield","text":"94%","of":"4"}, {"role":"er","text":"95.5:4.5","of":"4"} ],
  "description": "Ar = Ph",
  "failed": false
}
```
- `conditions` is a **list of lists**. The OUTER list is one entry per SEQUENTIAL one-pot operation
  on the arrow (usually one); reagents shown together for one operation share one INNER list. No
  conditions -> `[]` (not `[[]]`).
- `metrics`: `role` in `yield | ee | dr | er`, verbatim `text`, `of` = the product identifier (for a
  failed trial, `of` should name the expected product label).
- **Repeat the full concrete `reactants`, `products`, `conditions`, and `metrics` in EVERY example**,
  including every optimization-table row that reuses the same molecules.
- `failed`: `true` for an explicitly unsuccessful trial (`n.r.`, `ND`, `trace`, `0%`) - keep its
  reactants and output the expected product SMILES in `products`. Otherwise omit or set `false`.

An **Edge** (one entry in `reaction_graph`, multi-step only) links steps by molecule identifier:
`{"from_mols": ["9"], "to_mols": ["10"]}`. Identifiers used in edges must be unique across the
figure so the edge resolves. Single-step figures: `reaction_graph` is `[]`.

--------------------------------------------------------------------------------
## Core rule: infer the reactants that are not drawn

Many figures draw ONE general (markush) reaction with `R / Ar / R1` placeholders, plus a grid of
concrete instances that show only the product (or only list "R = Me, Ph, 4-Cl-C6H4 ..."). The
concrete reactant of each instance is usually NOT drawn - INFER it from the general scaffold and
that instance's substituents, and put the fully concrete molecule in `selected_examples`. A
reaction is only correct if ALL its molecules are present, so a missing reactant makes it wrong.
This inference is the core skill tested.

## What is a "concrete reaction"

A concrete reaction is one fully instantiated transformation or trial; its molecules contain NO
unresolved `R / Ar / X / *`. Emit exactly one `selected_examples` entry for:
- each substrate-scope / example entry;
- each optimization-table row - even when reactant and product repeat and only conditions change
  (the row identity IS the experiment; NOT a duplicate). Repeat its full molecule lists anyway; the
  headline set-F1 collapses identical molecules, but `completeness` and `conditions` distinguish rows.
- each separately drawn synthetic arrow;
- each explicitly failed trial (`failed: true`).

Use the general variable equation only to infer the concrete reactions; do not output it as a reaction.

## Do NOT emit (not reactions)
- electron-pushing / resonance arrows, transition states, catalytic-cycle intermediates;
- retrosynthetic disconnections (open double-line arrow);
- legends, abbreviation keys, or isolated compound depictions with no arrow;
- arrows for purification / work-up / assay-flow / formulation rather than a chemical change;
- a duplicated copy of an entry that also appears in a summary / inset.

Emit a mechanistic intermediate only if the figure presents it as an isolated, reported product.

## Reactant vs. condition (presentation rule, used consistently in the GT)
A `reactant`/`product` is a molecule drawn as a structure on the substrate/product side of the
arrow. Material written only ABOVE or BELOW the arrow goes in `conditions` (with a `role`), even
when it transfers atoms - unless it is itself drawn as a structural substrate.

--------------------------------------------------------------------------------
## How you are scored

One frozen scorer (`score_v2`) turns your JSON into `r` in [0,1] = a validity gate x an 8-axis
weighted mean. The scorer READS these fields; get them right:

| axis | weight | reads | what it checks |
|---|---|---|---|
| structures   | 0.30 | `SMILES` in reactants/products | reactant+product molecule set-F1 (strict-stereo `f1_iso`, nostereo `f1_ns`) |
| conditions   | 0.16 | `conditions[][].role/text/SMILES` | role-aware reagent F1 (name/abbrev or SMILES; amount ignored) |
| completeness | 0.12 | count of `selected_examples`, each side non-empty | all N reactions present, each with >=1 reactant & >=1 product/failed |
| topology     | 0.12 | `is_multistep`, `reaction_graph` | multistep flag + edge-F1 |
| metrics      | 0.10 | `metrics[].role/text/of` | yield/ee/dr/er value F1 (tolerance +-2) |
| stereo       | 0.10 | (derived from `SMILES`) | penalizes lost/flipped stereochemistry |
| identifiers  | 0.06 | `identifier`, `reaction_class` | compound-label recall + reaction_class |
| failed       | 0.04 | `failed` + product SMILES | failed-trial set F1 |

- **Headline reported per system = molecule set-F1 `f1_iso` / `f1_ns`** (canonical-SMILES SET). It
  measures molecule recovery; it does NOT by itself prove correct reactant-product pairing, and it
  collapses identical repeated rows (that is why you still repeat + fill conditions/metrics).
- **Validity gate**: if any `selected_examples` molecule is unparseable or still contains `*`, or
  you emit ZERO concrete examples, `r` is multiplied by 0.10. All emitted molecules must be concrete and placeholder-free. So valid concrete chemistry is what matters; a wrong field NAME
  or extra nesting can make the scorer miss otherwise-correct chemistry, but broken/placeholder
  SMILES is what actually gates.
- An axis whose GT field is absent is dropped and the remaining weights renormalized.
- **Retained but NOT yet scored** (emit them anyway for the viewer / future annotation, but they do
  not change today's `r`): `bbox`, `description`, `instance_id`, `_source`.

--------------------------------------------------------------------------------
## Output shapes (field-by-field skeletons -- NO example chemistry)

These skeletons show only the JSON NESTING and FIELD NAMES for the four figure kinds. Every
`<...>` is an instruction for what to put there; replace each with the actual value you read or
infer from the figure. They contain no molecules to copy -- fill every SMILES slot yourself from
the figure. `[x0,y0,x1,y1]` is a pixel box; keep it only for a molecule DRAWN in full (omit the key
for an inferred molecule).

### A. Substrate-scope grid: one general variable equation + concrete instances
Use the drawn general equation only to infer each concrete instance. Do not output the unresolved
general equation. Each drawn instance is one `selected_examples` entry; infer any non-drawn reactant
from the scaffold plus that instance's substituents and write it fully concrete (no `*`). Repeat the
shared conditions in every example.

```jsonc
{
  "reaction_class": "<named transformation, or '' if unknown>",
  "is_multistep": false,
  "selected_examples": [
    {"instance_id":"<printed product label>","description":"<R = ...>",
     "reactants":[{"identifier":"r0","SMILES":"<concrete reactant 1 for THIS instance, inferred, no *>"},
                  {"identifier":"r1","SMILES":"<concrete reactant 2, no *>"}],
     "products":[{"identifier":"<label>","SMILES":"<concrete drawn product, no *, stereo if shown>","bbox":[x0,y0,x1,y1]}],
     "conditions":[[{"role":"catalyst","text":"<same conditions, repeated here>"},{"role":"solvent","text":"<solvent>"}]],
     "metrics":[{"role":"yield","text":"<yield as printed>","of":"<product label>"},
                {"role":"er","text":"<er/ee/dr if printed>","of":"<product label>"}]}
    // ... one more selected_examples entry per drawn instance ...
  ],
  "reaction_graph": []
}
```

### B. Condition-optimization table (same substrates, conditions vary, incl. a failed row)
One `selected_examples` entry PER ROW; repeat the
full molecule lists every row (the row identity is the experiment); a failed row sets `failed:true`
with the expected product SMILES in `products`.

```jsonc
{"reaction_class":"<...>","is_multistep":false,
 "selected_examples":[
   {"instance_id":"row1","failed":false,
    "reactants":[{"identifier":"1","SMILES":"<substrate 1, drawn>","bbox":[x0,y0,x1,y1]},
                 {"identifier":"2","SMILES":"<substrate 2, drawn>","bbox":[x0,y0,x1,y1]}],
    "products":[{"identifier":"3","SMILES":"<product, drawn>","bbox":[x0,y0,x1,y1]}],
    "conditions":[[{"role":"catalyst","text":"<row-1 catalyst + amount>"},{"role":"base","text":"<row-1 base>"}]],
    "metrics":[{"role":"yield","text":"<row-1 yield>","of":"3"}]},
   {"instance_id":"row2","failed":true,
    "reactants":[{"identifier":"1","SMILES":"<same substrate 1>"},{"identifier":"2","SMILES":"<same substrate 2>"}],
    "products":[{"identifier":"3","SMILES":"<expected product SMILES>"}],
    "conditions":[[{"role":"base","text":"<the changed / omitted condition for this row>"}]],
    "metrics":[{"role":"yield","text":"0%","of":"3"}]}
   // ... one entry per table row ...
 ],
 "reaction_graph":[]}
```

### C. Multi-step linear synthesis (topology via reaction_graph)
`is_multistep:true`; one entry per drawn arrow; a step whose reactant is a prior product reuses that
product's IDENTIFIER; two sequential one-pot operations on one arrow = two INNER condition lists;
link steps with `reaction_graph` edges.

```jsonc
{"reaction_class":"","is_multistep":true,
 "selected_examples":[
   {"instance_id":"s1",
    "reactants":[{"identifier":"8a","SMILES":"<start material A>","bbox":[x0,y0,x1,y1]},
                 {"identifier":"8b","SMILES":"<start material B>","bbox":[x0,y0,x1,y1]}],
    "products":[{"identifier":"9","SMILES":"<step-1 product>","bbox":[x0,y0,x1,y1]}],
    "conditions":[[{"role":"reagent","text":"<step-1 reagents>"},{"role":"solvent","text":"<solvent>"}]],
    "metrics":[{"role":"yield","text":"<step-1 yield>","of":"9"}]},
   {"instance_id":"s2",
    "reactants":[{"identifier":"9","SMILES":"<the SAME step-1 product, reused by id>"}],
    "products":[{"identifier":"10","SMILES":"<step-2 product>","bbox":[x0,y0,x1,y1]}],
    "conditions":[[{"role":"reagent","text":"<operation-1 reagents>"}],
                  [{"role":"reagent","text":"<operation-2 reagents>"},{"role":"temperature","text":"<temp>"}]]}
 ],
 "reaction_graph":[{"from_mols":["9"],"to_mols":["10"]}]}
```

### D. Non-reaction figure (catalytic cycle, retrosynthesis, legend) -> emit nothing

```jsonc
{"reaction_class":"","is_multistep":false,"selected_examples":[],"reaction_graph":[]}
```
(The scored benchmark is curated to real reaction figures, so a genuinely empty answer is only
correct on out-of-scope inputs - those are not part of the scored GT set. On a real reaction figure,
emitting zero examples triggers the 0.10 validity gate.)

--------------------------------------------------------------------------------
## Notes
- The ground truth is annotated in this same V2 schema; a molecule's internal provenance
  (`_source`: OCSR md5 / detection index) is produced by our tools, NOT expected from you, and not
  scored. Give `identifier`, `SMILES`, and (when drawn) `bbox`.
- Difficulty and figure type are tagged per figure, so accuracy is sliced by presentation
  (scope grid / optimization table / multi-step / single) and by L1-L3 difficulty.

## Output
Write the complete V2 JSON object described above to `/app/answer.json`.

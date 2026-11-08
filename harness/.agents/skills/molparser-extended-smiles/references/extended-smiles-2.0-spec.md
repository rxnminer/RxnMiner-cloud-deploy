# MolParser Extended-SMILES 2.0 Reference

This reference is distilled from the source document `MolParser_ Extended-SMILES 2.0格式定义.docx`, with small background notes from MolParser, RDKit, OpenSMILES, CXSMILES, and BigSMILES sources. The source document remains the normative rule set.

## Purpose

Extended-SMILES 2.0 represents molecules as a standard RDKit-compatible SMILES string plus a structured extension for objects that ordinary SMILES cannot naturally express, especially Markush groups, connection points, abstract rings, uncertain ring attachment positions, repeated fragments, polymers, and virtual arcs.

The format is intended to be:

- compatible with RDKit for the base SMILES part;
- parseable by deterministic tools;
- friendly to LLM generation and correction;
- expressive enough for patent and scientific-document Markush structures.

## Top-Level Format

```text
SMILES<sep>EXTENSION
```

- `SMILES`: RDKit-compatible base SMILES.
- `<sep>`: required separator between base SMILES and extension.
- `EXTENSION`: optional sequence of MolParser XML-like records.

For an ordinary molecule with no extension records, still include the separator:

```text
Cc1cc(Oc2ccc(COc3cc4n(c(=O)n3)CC35CC(CN43)C5)cc2F)ccn1<sep>
```

For non-Markush molecules, the source convention is:

```python
Chem.MolToSmiles(mol, rootedAtAtom=0, canonical=False, isomericSmiles=True)
```

Use this convention when reproducing source annotations. If using canonical SMILES instead, atom indexes may change and all extension indexes must be regenerated.

## Token Inventory

| Token | Shape | Meaning |
|---|---|---|
| `<a>` | `<a>[ATOM_INDEX]:[GROUP_NAME]</a>` | Atom-indexed substituent, R group, Markush group, alias, or special group. |
| `<d>` | `<d>[ATOM_INDEX]:[ATTACH_POINT_LABEL]</d>` | Connection point or dummy attachment point. |
| `<r>` | `<r>[RING_INDEX]:[GROUP_NAME]</r>` | Ring-attached substituent when the exact atom position on the ring is variable or abstract. |
| `<c>` | `<c>[ATOM_INDEX]:[CIRCLE_NAME]</c>` | Simple abstract ring represented by an atom placeholder. |
| `<g>` | `<g>[INNER_PORT:OUTER_PORT]:...:|Sg:[n]|</g>` | Complex repeated fragment, described by one or more internal-to-external ports and a repeat count. |
| `<v>` | `<v>[VIRTUALARC_INDEX]:[VIRTUALARC_NAME]:[FROM_ATOM:TO_ATOM]</v>` | Virtual arc or special abstract ring connecting two endpoint atoms. |
| `|Sg:n|` | `|Sg:[n]|` | Whole-structure repeat or polymer-style repeat marker. |
| `<s>` | `<s>SMILES<sep>EXTENSION</s>` | Nested E-SMILES substructure used inside group values. |

These tokens are XML-like, not strict XML. Inline labels such as `<id>[DNA]`, `<dum>`, `<red>`, or `<RNA>` may appear as group names or labels without closing tags.

## Index Rules

- Atom indexes are zero-based in the exact base SMILES graph used for the annotation.
- Ring indexes are counted independently from atom indexes.
- Virtual arc indexes are counted independently from atom and ring indexes.
- Port pairs in `<g>` use `[INNER_PORT:OUTER_PORT]`, where the inner atom belongs to the repeated fragment and the outer atom is outside that fragment.
- For `[FROM_ATOM:TO_ATOM]` in `<v>`, direction is not meaningful; `[0:2]` and `[2:0]` refer to the same endpoints.
- Substructure indexes inside `<s>...</s>` are local to the nested substructure.

## Substituents and Markush Groups

Use `<a>` when a group is attached to a known atom index:

```text
*c1ccccc1<sep>
<a>0:R[1]</a>
```

Rules:

- The left side before `:` is the atom index.
- The right side is the group name.
- Common names include `R`, `X`, `Y`, `Z`, `Ph`, `Me`, `OMe`, and `CF3`.
- Markush subscripts or superscripts are encoded with square brackets, such as `R[1]`, `R[3]`, `Z[1]`.
- Special groups can use an inline identifier, for example `<a>12:<id>[DNA]</a>`.

Special group labels can be task-specific. The source document mentions labels such as color tags and biological-material tags including DNA, RNA, protein, ball, and rectangle. Preserve the user or dataset's exact tag vocabulary if it is already established.

## Connection Points

Use `<d>` for connection points and dummy attachment locations:

```text
*C(O)=O<sep>
<d>0:<dum></d>
```

Rules:

- The atom index usually points to a dummy `*` atom in the base SMILES.
- `<dum>` is the standard dummy label in the source examples.
- Keep the dummy atom in the base SMILES so the graph has a concrete port location.

## Ring-Attached Groups

Use `<r>` when a substituent is attached somewhere on a ring and the precise atom position is variable, abstract, or encoded by ring identity rather than atom identity:

```text
*C(O)c1cc(C(=O)N(*)*)cc(-c2*ccc*2)c1<sep>
<a>0:CF3</a>
<a>9:R[3]</a>
<a>10:R[2]</a>
<a>14:X</a>
<a>18:Y</a>
<r>1:R[1]?1-3</r>
```

Rules:

- The number after `<r>` is a ring index, not an atom index.
- Multiple groups on the same ring use multiple `<r>` records:

```text
c1ccccc1<sep>
<r>0:R[1]</r>
<r>0:R[2]</r>
```

- A ring-attached group can be a simple alias:

```text
<r>0:L[1]R[1]</r>
<r>0:L[2]COR[2]</r>
<r>0:R[3]</r>
```

- A ring-attached group can be a nested substructure:

```text
<r>0:<s>**<sep><a>0:L[1]</a><a>1:R[1]</a></s></r>
<r>0:<s>*C(*)=O<sep><a>0:L[2]</a><a>2:R[2]</a></s></r>
```

## Repeat Modifiers

Use `?n` when a group repeats an abstract number of times:

```text
c1ccccc1*<sep>
<a>7:R[1]?n</a>
```

Use `?m-n` for a repeat range:

```text
<r>1:R[1]?1-3</r>
```

Rules:

- Attach `?n`, `?m-n`, or `?20` directly to the repeated group name.
- Use this compact syntax for simple repeated groups.
- Use `<g>` when the repeated object is a complex fragment with explicit ports.

## Whole Repeat Units and Polymers

Use `|Sg:n|` when the whole base structure is a repeating unit:

```text
c1(*)c(C)cc(N2C(=O)C3C(C(C)=CC(C4C(=O)N(*)C(=O)C4)C3)C2=O)c(C)c1<sep>
<d>1:<dum></d>
<d>19:<dum></d>
|Sg:n|
```

Rules:

- First annotate the base repeat unit and its two connection points.
- The source convention says the repeat ends are connection points represented by dummy `*` atoms.
- Then add `|Sg:n|`, replacing `n` with a concrete number, symbol, or range when available.
- This differs from `?n`: `|Sg:n|` applies to the complete repeat unit, while `?n` modifies a group name.

## Simple Abstract Rings

Use `<c>` when a placeholder atom represents an abstract ring:

```text
*C(NC(*)(*)C(*)(*)*)C(=O)N(*)*<sep>
<a>0:R[1]</a>
<a>4:R[3]</a>
<a>5:R[2]</a>
<a>7:R[5]</a>
<a>8:R[4]</a>
<c>9:B</c>
<a>13:R[7]</a>
<a>14:R[6]</a>
```

Rules:

- `<c>9:B</c>` means atom index `9` is an abstract ring named `B`.
- If an abstract ring has variable ring-attached substituents, target that abstract ring from `<r>`:

```text
*C1=C(*)C2C(=NC=C(*=2)*)N1<sep>
<a>0:R[1]</a>
<a>3:R[2]</a>
<a>9:Z[1]</a>
<c>10:Ar</c>
<r><c>10:R[3]</r>
<r><c>10:R[4]</r>
<r><c>10:R[5]</r>
```

Here `<r><c>10:R[3]</r>` means group `R[3]` is attached somewhere on abstract ring atom `10`.

## Complex Repeated Fragments

Use `<g>` when a repeat is not just a group suffix but a fragment whose internal/external ports must be recorded.

Workflow:

1. Ignore the repeat brackets and count. Encode the visible molecule as a normal E-SMILES structure.
2. Add one `<g>` record for each repeated fragment.
3. In each `<g>`, list all `[INNER_PORT:OUTER_PORT]` pairs, followed by `|Sg:n|`.

Example:

```text
C=CCC(C(C)*)*<sep>
<a>6:R[2]</a>
<a>7:R[1]</a>
<g>[3:2]:[4:5]:|Sg:20|</g>
```

Meaning:

- `[3:2]` says inner atom `3` connects to outer atom `2`.
- `[4:5]` says inner atom `4` connects to outer atom `5`.
- `|Sg:20|` says the repeated fragment appears 20 times.
- Groups inside the repeat, such as `R[1]` and `R[2]`, are not duplicated in the string; they can be inferred from the repeated region and ports.

## Virtual Arcs and Special Abstract Rings

Use `<v>` when a special abstract ring or virtual arc connects two atoms but is not represented as ordinary bonds in the base SMILES.

Workflow:

1. Ignore the virtual arc and encode the visible base molecule.
2. Add a `<v>` record with the virtual arc index, name, and endpoints.

Example:

```text
C=CCC(C(C)*)*<sep>
<a>6:R[2]</a>
<a>7:R[1]</a>
<v>0:A:[0:2]</v>
```

Rules:

- `0` is the virtual arc index.
- `A` is the virtual arc name.
- `[0:2]` are the two connected endpoint atom indexes.
- Endpoint order is interchangeable.

For substituents on a virtual arc, use `<r>` targeting `<v>`:

```text
C=CCC(C(C)*)*<sep>
<a>6:R[2]</a>
<a>7:R[1]</a>
<v>0:A:[0:2]</v>
<r><v>0:R[3]</r>
```

## Unsupported or Not-Yet-Supported Cases

The source document marks these as currently unsupported in E-SMILES:

- coordination bonds;
- electron-transfer diagrams;
- uncertain structures shown by dashed or similar uncertain drawing conventions;
- uncertain bonds and wavy bonds;
- uncertain chirality.

When these appear:

1. Do not invent a new token.
2. Preserve the base molecule as far as possible.
3. Report the unsupported feature explicitly.
4. If the surrounding workflow requires lossless capture, store the unsupported feature as external metadata rather than as E-SMILES.

See `references/figure-index.md` for the unsupported-case figures.

## Validation Checklist

Use this checklist before returning a generated or corrected E-SMILES string:

- The string contains exactly one top-level `<sep>`.
- The base SMILES is RDKit-compatible if the molecule is ordinary.
- Atom indexes in `<a>`, `<d>`, `<c>`, `<g>`, and `<v>` match the chosen base SMILES traversal.
- `<r>` uses ring indexes, not atom indexes, unless it explicitly targets `<c>` or `<v>`.
- Markush labels with indices use square brackets, such as `R[1]`.
- Repeats use the right construct: `?n` or `?m-n` for simple group repeats, `|Sg:n|` for whole repeat units, and `<g>` for complex repeats.
- Nested `<s>` records contain their own `SMILES<sep>EXTENSION`.
- Unsupported structures are not forced into invented syntax.
- If the user gave a drawing, all visible special features are either encoded or listed as unsupported.

## Output Style

For generation tasks, prefer a single-line final string:

```text
SMILES<sep><a>...</a><r>...</r>
```

For explanation or review tasks, show the string first, then a concise breakdown of each extension record.


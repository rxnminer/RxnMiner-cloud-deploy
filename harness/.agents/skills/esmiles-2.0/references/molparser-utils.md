# Using the molparser_utils library

The library that parses and manipulates Extended-SMILES. Vendored at
`third_party/molparser_utils/` (see `THIRD_PARTY.md`). On dp_server2 the same package may also be
pip-installed and the installed copy can win, so confirm which copy you are running.

Confirm which copy you are running before trusting a result:

```bash
python3 -c "import molparser_utils; print(molparser_utils.__file__)"
```

## Public surface

`from molparser_utils import Translator, draw`

`Translator` is the whole API worth knowing. Verified against the vendored
commit on 2026-08-11:

| Method | Signature | Use |
|---|---|---|
| `parse_caption` | `(caption, return_mol=False, error_msg=False)` | Split an E-SMILES into base, extension, trailing |
| `markush_substitute` | `(caption, substitution_map, error_msg=False)` | Substitute named groups and get a concrete molecule |
| `reconstruct_mol` | `(mol, groups=None, write_to=None, add_atom_indices=False, drawer_type='SVG')` | Render, optionally with atom indices |
| `get_group_texts` | `(content)` | Break an R-group label into its text parts |

Also present: `consolidate`, `refactor`, and a family of `tokenize_*` and
`parse_*` helpers for working inside the extension grammar.

## Two calls that cover most work

Splitting a reading into its parts:

```python
>>> from molparser_utils import Translator
>>> Translator().parse_caption("*c1ccccc1<sep><a>0:R[1]</a>")
('*c1ccccc1', '<a>0:R[1]</a>', '')
```

Materializing a Markush template. Note that `substitution_map` is **required**,
so this cannot be used to "expand whatever it can" without deciding the groups:

```python
>>> Translator().markush_substitute("*c1ccccc1<sep><a>0:R[1]</a>", {"R[1]": "C"})
TranslatedMolecule(smi='Cc1ccccc1', groups='', caption='Cc1ccccc1',
                   markush=False, sru=False)
```

The result carries `smi`, `groups` (what remained unsubstituted), `caption`,
`markush`, and `sru`. A non-empty `groups` or `markush=True` on a result you
expected to be concrete means the substitution did not complete; treat that as a
failure to report, not a value to pass downstream.

## Where this sits relative to our own tooling

This library reads and rewrites E-SMILES strings. It is not the R-group engine:
deriving substituents from a drawn instance, filling a template from a grounded
map, and reverse-assembling undrawn reactants all belong to the R-group engine
(`third_party/molecular_assembly*`), reached through `scripts/chem_tool.py call reverse_rgroup |
fill_rgroup | reverse_assemble`.

Use `molparser_utils` for abbreviation expansion and E-SMILES surgery; use the
FHR path for chemistry derivation. Mixing them up produces the classic failure
where a template is materialized by string substitution and looks plausible
while being chemically wrong.

## Version caveat

The vendored copy is `master`. The Extended-SMILES 2.0 rewrite is on the unmerged
`v2` branch, so a construct the specification defines may not parse here. When a
valid 2.0 string fails, check the spec in `../molparser-extended-smiles/` before
concluding the string is malformed.

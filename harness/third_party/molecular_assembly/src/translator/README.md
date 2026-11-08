# translator (vendored)

Local copy of [projects_on_git/Translator](/instrument/micro_img/users/fhr/projects_on_git/Translator).

- `translator.py` — caption parse / `refactor()` abbreviation expansion
- `_utils.py` — slim utils (abbrev table, `merge_group`); no Node/SVG deps
- `abbrevs.csv` — abbreviation → SMILES mapping

Used by `../abbrev_expand.py` before Step0 `load_esmiles`. Do not import from `projects_on_git` at runtime.

Update by re-copying from upstream when the Translator project changes.

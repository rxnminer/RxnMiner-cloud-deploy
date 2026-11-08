---
name: esmiles-2.0
description: Ingest, preserve, interpret, validate or score MolParser Extended-SMILES 2.0 and the derived smiles field.
---

# Extended-SMILES 2.0

Load and follow the common repository skill completely:

```text
.agents/skills/esmiles-2.0/SKILL.md
```

Never canonicalize or rewrite an accepted MolParser E-SMILES (its empty trailing `<sep>` included);
the plain molecule lives in the derived `smiles` field.

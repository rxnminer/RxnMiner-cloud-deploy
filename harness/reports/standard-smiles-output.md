# standard-smiles-output

branch `feat/jinbo/standard-smiles-output` (base main `3199a4d`). Adds the agreed dual-field output:
every concrete molecule and structured condition in the assembled V2 reads
`{identifier, smiles, E-SMILES, ..., _source}`. `E-SMILES` is NOT rewritten (a first version of this
branch dropped the trailing empty `<sep>`; that was wrong, `SMILES<sep>EXTENSION` with an empty
extension is the MolParser wire form and stays byte-verbatim).

## What changed and why

- `engine/v2.py`: a final pass `_finalize_molecule_fields` runs after the OCSR-preference and
  copy-recovery passes. Every molecule and structured condition gets `smiles` = plain RDKit
  canonical isomeric SMILES derived from the final E-SMILES through the E-SMILES audit
  (abbreviation tags expanded); Markush templates, open labels, unresolved and RDKit-invalid values
  get no `smiles`. Record key order is `identifier, smiles, E-SMILES, ..., _source`.
- `tools/chem_mcp.py`: the `assemble` inventory reports `smiles`.
- docs: engine docstring, SKILL.md output contract (the model never writes `smiles` itself), README,
  `references/extended-smiles-2.0.md` (the byte-verbatim rule now also names the derived field).

## Zero-cost verification (dp, LangGraph python: pytest 9.0.2, rdkit 2022.09.5)

- pytest: 68 passed (63 before + 5 new): dual field and key order (E-SMILES verbatim, `<sep>` kept);
  template stays verbatim with no fake smiles; tagged concrete condition expands
  (`*C(=O)O<sep><a>0:Ph</a>` -> `O=C(O)c1ccccc1`); plain-body condition; assemble inventory.
- `scripts/smoke_test.py`: OK (8 tools, V2 assembly valid); `skill_lint`: OK; `verify_third_party`: 202 entries, 0 problems.

## Real figure (closed-book, Claude-Opus-5, quick path on `rxnminer:clean-test` with this branch's payload)

`chem-gt1__gt1__162_1_jpg`: pi_rc 0, 333.4 s, 37 tool calls, 8/8 reactions, strict iso 1.000
(tags stripped) and f1_iso 1.000. The final answer in `reports/standard-smiles-output/answer_after_branch.json`
was re-assembled at zero cost from that run's `plan.json` with the final engine
(`tool_assemble(plan_path=...)`): 9/9 molecules carry `smiles`, `E-SMILES` byte-verbatim
(2 of 9 end with the empty `<sep>` MolParser emitted), key order `identifier, smiles, E-SMILES`.

With the CURRENT upstream strict scorer the raw score of this answer is still 0.333: it reads
`E-SMILES` first and drops any value containing `<`. That is fixed on the benchmark side by making
the scorer prefer `smiles` (ChemRxn_Benchmark issue/PR "scorer prefers smiles"), not by rewriting
`E-SMILES` here.

## Cost

1 figure, about 1 to 2 USD (the re-assembly and all tests cost nothing).

## Reviewer reproduction

    cd $J/code/RxnMiner-wt-smiles && PYTHONPATH=. /root/miniconda3/envs/LangGraph/bin/python -m pytest tests -q
    cd $J/code/RxnMiner-wt-smiles && PYTHONPATH=. /root/miniconda3/envs/LangGraph/bin/python -c "from tools.chem_mcp import tool_assemble; r=tool_assemble(plan_path='out/quick-3199a4d/chem-gt1__gt1__162_1_jpg/plan.json', out_path='/tmp/re.json'); print(r['report'].splitlines()[0])"
    bash $J/tools/rxnminer_quick_main.sh chem-gt1__gt1__162_1_jpg $J/code/RxnMiner-wt-smiles rxnminer:clean-test

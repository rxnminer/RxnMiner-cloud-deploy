---
name: repo-development
description: Use when claiming an issue, creating a branch or worktree, running the gates, opening or reviewing a pull request, or merging in the RxnMiner repository.
---

# Repository development (RxnMiner)

The contract is `CONTRIBUTING.md`: one problem, one issue, one pull request that closes it; the
meeting walks through pull requests. This skill is the operational checklist.

## Before work

1. Read `CONTRIBUTING.md` and the issue templates (`.github/ISSUE_TEMPLATE/problem.md`,
   `new_tool.md`); every section of an issue has a worked example in an HTML comment.
2. Search open issues first (`gh issue list -R bbkevin1016/RxnMiner`). Open one issue per problem
   with the reproduction environment (section 0): host, `$J`, code path + commit, image, figure,
   credential file name (never the value), artifacts, zero-cost commands with the expected output
   line, full commands with cost.
3. Branch from `origin/main`: `feat|bug|docs/<you>/<topic>`. On dp use a worktree
   (`git -C $J/code/RxnMiner-push-20260910 worktree add $J/code/RxnMiner-wt-<topic> -b <branch> origin/main`);
   never edit the reviewer's copy `RxnMiner-push-20260910` directly.

## During work

- Commit prefixes `[feat] [bug] [docs] [test]`; no emojis in committed files; runtime data, sessions,
  answers, GT and credentials never enter git.
- Skills stay general (`tools/skill_lint.py` rejects concrete SMILES and figure ids); GT never enters
  the agent; `E-SMILES` is byte-verbatim (see `../esmiles-2.0/SKILL.md`); rdkit / Node / pi pins and
  `forceAdaptiveThinking=false` do not change.
- Gates before a pull request (dp: `PY=/root/miniconda3/envs/LangGraph/bin/python`):

      PYTHONPATH=. $PY -m pytest tests -q
      PYTHONPATH=. $PY scripts/smoke_test.py
      python3 tools/skill_lint.py skills/reaction-extract/SKILL.md skills/reaction-extract/LESSONS.md
      python3 tools/verify_third_party.py

  plus one real figure: `bash $J/tools/rxnminer_quick_main.sh <task> <worktree> rxnminer:clean-test`
  (quick path, about 1 to 2 USD) and `bash $J/tools/rxnminer_run_one.sh score <out_dir> <task>`.
  Re-assembling an existing `plan.json` with `tool_assemble(plan_path=...)` verifies assembler
  changes at zero cost.

## Pull request

- First line `Closes #<issue>`; fill the template: reproduction environment, change tree with line
  numbers, key code, verification table, the same record before and after, renders side by side,
  score table with the script's own output line, cost, not done, three-line reproduction.
- Images and full outputs go to `reports/<topic>/` in the branch, linked by commit sha.
- Say explicitly when `prompts/` or `skills/` changed (paper prompt) or the output schema changed
  (merge is tagged).

## Review and merge

The reviewer pulls the branch, reruns the gates and one figure, checks every claim against the code
or a real session, merges with a linear history and tags schema or runtime changes. A review agent
gets the brief: run sections 0 and 8 of the pull request, refill the score table, report mismatches.

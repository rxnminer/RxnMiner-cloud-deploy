# Vendored from molparserutils. Do not edit in place.

This directory is a verbatim copy of the MolParser team's own Extended-SMILES
skill. They maintain it; we consume it.

```text
source  git@git.dp.tech:molparser/molparserutils
path    skills/molparser-extended-smiles-skill
commit  65de27b8e459ee40d7f26d5337135141edff0747   (master)
skill last touched upstream  2026-05-19
vendored 2026-08-11
```

It is vendored rather than referenced because `molparserutils` is installed only
where someone has set it up; an agent working from a laptop, a fresh worktree, or
a container otherwise cannot open the spec at all. It is 2.1 MB, almost entirely
the 27 example figures, which are the part a vision model actually needs.

## Rules

**Do not edit anything under this directory.** A local fix here is invisible to
the MolParser team and will be silently reverted by the next refresh. If the spec
is wrong or incomplete, raise it with them and refresh afterwards.

Project-specific rules about how we *store* E-SMILES in V2, what is immutable,
and how Ketcher round-trips live in `../esmiles-2.0/SKILL.md` and
`../chemrxn-esmiles-ketcher/SKILL.md`. That separation is the point: upstream owns
the format, we own our handling of it.

## What the validator does and does not check

`scripts/validate_esmiles.py` is a syntax check, and its own help says so. Measured
on 2026-08-11:

```text
c1ccccc1<sep><r>0:R[1]</r>    ok
CCO                           error, expected a top-level <sep>
c1ccccc1<sep><a>99:R</a>      ok
```

The last one is the limit worth knowing: benzene has six atoms and atom index 99
does not exist, and the checker passes it. **A clean validator run is not evidence
that indexes resolve.** Verify index references against the base SMILES traversal
yourself, which the spec's own validation checklist also asks for.

## Refresh

```bash
ssh dp_server2 'cd /uniparser2/users/hujinbo/project/molparserutils && git pull'
ssh dp_server2 'cd /uniparser2/users/hujinbo/project/molparserutils/skills \
  && tar cf - molparser-extended-smiles-skill' > /tmp/upstream_skill.tar
# then replace this directory wholesale and update the commit recorded above
```

Check `git log master..origin/v2` while you are there. The 2.0 parser rewrite is
on an unmerged `v2` branch, so `master` does not yet parse everything this spec
defines, and the spec is ahead of the code.

## Licensing

`molparserutils` ships no LICENSE file. This is internal company material
vendored into a private repository, on the same footing as the vendored FHR
assembly code. It must not be published, and it must not be included in any
public benchmark or code release without the MolParser team's explicit
agreement.

# -*- coding: utf-8 -*-
"""Standard chemistry abbreviations printed in reaction figures, as attachment-point SMILES.

Why this exists: figures label substituents with abbreviations that OCSR returns as a bare label, and
guessing the expansion silently rewrites the chemistry of every cell that carries it. This table is
ordinary reference knowledge, the kind printed on the inside cover of a textbook. It holds no
figure-specific information and no benchmark answers.

Every entry is written with one `*` attachment point, the way a substituent is attached. Where a label
is genuinely used for more than one group the entry carries every reading and a note; the caller must
then choose with evidence from the figure, or record the molecule as unresolved.
"""

import re

# label -> list of (SMILES with one attachment point, note)
TABLE: dict[str, list[tuple[str, str]]] = {
    # carbon skeletons
    "me": [("*C", "methyl")],
    "et": [("*CC", "ethyl")],
    "pr": [("*CCC", "n-propyl")],
    "npr": [("*CCC", "n-propyl")],
    "ipr": [("*C(C)C", "isopropyl")],
    "bu": [("*CCCC", "n-butyl")],
    "nbu": [("*CCCC", "n-butyl")],
    "ibu": [("*CC(C)C", "isobutyl")],
    "sbu": [("*C(C)CC", "sec-butyl")],
    "tbu": [("*C(C)(C)C", "tert-butyl")],
    "cy": [("*C1CCCCC1", "cyclohexyl")],
    "cp": [("*C1CCCC1", "cyclopentyl")],
    "vinyl": [("*C=C", "vinyl")],
    "allyl": [("*CC=C", "allyl")],
    "ph": [("*c1ccccc1", "phenyl")],
    "bn": [("*Cc1ccccc1", "benzyl")],
    "tol": [("*c1ccc(C)cc1", "p-tolyl; o- and m-tolyl are written with the position")],
    "ptol": [("*c1ccc(C)cc1", "p-tolyl")],
    "pmp": [("*c1ccc(OC)cc1", "4-methoxyphenyl")],
    "pmb": [("*Cc1ccc(OC)cc1", "4-methoxybenzyl")],
    "mes": [("*c1c(C)cc(C)cc1C", "mesityl, 2,4,6-trimethylphenyl")],
    "dipp": [("*c1c(C(C)C)cccc1C(C)C", "2,6-diisopropylphenyl")],
    "trip": [("*c1c(C(C)C)cc(C(C)C)cc1C(C)C", "2,4,6-triisopropylphenyl")],
    "tripp": [("*c1c(C(C)C)cc(C(C)C)cc1C(C)C", "2,4,6-triisopropylphenyl")],
    "naph": [("*c1cccc2ccccc12", "1-naphthyl"), ("*c1ccc2ccccc2c1", "2-naphthyl")],
    "ada": [("*C12CC3CC(CC(C3)C1)C2", "1-adamantyl")],

    # acyl and carbonyl groups
    "ac": [("*C(C)=O", "acetyl")],
    "bz": [("*C(=O)c1ccccc1", "benzoyl")],
    "piv": [("*C(=O)C(C)(C)C", "pivaloyl")],
    "cbz": [("*C(=O)OCc1ccccc1", "benzyloxycarbonyl")],
    "boc": [("*C(=O)OC(C)(C)C", "tert-butoxycarbonyl")],
    "fmoc": [("*C(=O)OCC1c2ccccc2-c2ccccc21", "9-fluorenylmethoxycarbonyl")],
    "alloc": [("*C(=O)OCC=C", "allyloxycarbonyl")],
    "troc": [("*C(=O)OCC(Cl)(Cl)Cl", "2,2,2-trichloroethoxycarbonyl")],

    # sulfonyl groups
    "ts": [("*S(=O)(=O)c1ccc(C)cc1", "tosyl, p-toluenesulfonyl")],
    "ms": [("*S(=O)(=O)C", "mesyl, methanesulfonyl")],
    "tf": [("*S(=O)(=O)C(F)(F)F", "triflyl, trifluoromethanesulfonyl")],
    "ns": [("*S(=O)(=O)c1ccc([N+](=O)[O-])cc1", "nosyl, 4-nitrobenzenesulfonyl"),
           ("*S(=O)(=O)c1ccccc1[N+](=O)[O-]", "2-nitrobenzenesulfonyl")],
    "bs": [("*S(=O)(=O)c1ccccc1", "benzenesulfonyl")],

    # silicon groups
    "tms": [("*[Si](C)(C)C", "trimethylsilyl")],
    "tes": [("*[Si](CC)(CC)CC", "triethylsilyl")],
    "tbs": [("*[Si](C)(C)C(C)(C)C", "tert-butyldimethylsilyl")],
    "tbdms": [("*[Si](C)(C)C(C)(C)C", "tert-butyldimethylsilyl")],
    "tbdps": [("*[Si](c1ccccc1)(c1ccccc1)C(C)(C)C", "tert-butyldiphenylsilyl")],
    "tips": [("*[Si](C(C)C)(C(C)C)C(C)C", "triisopropylsilyl")],

    # oxygen and nitrogen groups
    "mom": [("*COC", "methoxymethyl")],
    "thp": [("*C1CCCCO1", "tetrahydropyran-2-yl")],
    "sem": [("*CO CC[Si](C)(C)C".replace(" ", ""), "2-(trimethylsilyl)ethoxymethyl")],
    "morph": [("*N1CCOCC1", "morpholin-1-yl")],
    "pyr": [("*c1ccccn1", "pyridin-2-yl")],

    # directing groups and auxiliaries that carry more than one reading
    "pip": [("*C(C)(C)c1ccccn1",
             "2-(pyridin-2-yl)propan-2-yl, the PIP amide auxiliary of directed C-H functionalisation"),
            ("*N1CCCCC1", "piperidin-1-yl; the same three letters are used for this in other papers")],
    "aq": [("*c1cccc2cccnc12", "quinolin-8-yl, the 8-aminoquinoline auxiliary")],
    "bpin": [("*B1OC(C)(C)C(C)(C)O1", "pinacol boronate")],
    "bdan": [("*B1Nc2ccccc2N1", "1,8-diaminonaphthalene boronamide (naphthalene ring drawn as written)")],
}


def normalise(label: str) -> str:
    """Fold the spellings that mean the same label: case, dashes, spaces, and a leading position."""
    text = (label or "").strip().lower()
    for token in ("-", "‐", "‑", " ", "."):
        text = text.replace(token, "")
    for prefix in ("n", "o", "m", "p") if len(text) > 2 else ():
        if text.startswith(prefix) and text[1:] in TABLE:
            return text[1:]
    return text


# characters that rendered chemistry text is routinely read as one another
_CONFUSABLE = (("l", "i"), ("1", "i"), ("1", "l"), ("0", "o"), ("5", "s"), ("rn", "m"), ("8", "b"), ("6", "b"))


def _variants(key: str):
    """The key itself, then the readings that differ by one OCR confusion."""
    yield key, False
    seen = {key}
    for a, b in _CONFUSABLE:
        for source, target in ((a, b), (b, a)):
            if source in key:
                candidate = key.replace(source, target)
                if candidate not in seen:
                    seen.add(candidate)
                    yield candidate, True



# a Markush variable is defined by the scope cells, never by an abbreviation table
MARKUSH_VARIABLE = re.compile(r"^(r|ar|x|y|z|e?wg|edg|fg|nu|lg|m|n)\d*$")


def is_markush_variable(label: str) -> bool:
    return bool(MARKUSH_VARIABLE.match(normalise(label)))

def expand(label: str) -> list[dict]:
    """Every reading of one printed abbreviation. Empty when the label is not standard."""
    for key, corrected in _variants(normalise(label)):
        readings = TABLE.get(key)
        if not readings:
            continue
        out = []
        for smiles, note in readings:
            if corrected:
                note = note + ("; matched after an OCR confusion, the label reads %s - check the crop "
                               "before you use it" % key)
            out.append({"label": label, "smiles": smiles, "note": note})
        return out
    return []

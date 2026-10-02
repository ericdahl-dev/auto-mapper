"""Guards American spelling across the repo: product text, docs and code identifiers.

    python scripts/american_spelling.py      # lists problems, exits 1 if any

Words are checked one by one, including inside identifiers (colour_edges, AudioAnalyser,
scanCancelled). Web API names that are British by definition are allowed. A line can opt out
with the marker "spelling: ok" (e.g. when quoting an external name).
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# British -> American. Each key is a stem; common endings are added below.
OUR = ["colour", "neighbour", "behaviour", "favour", "honour", "labour", "flavour", "humour", "rumour",
       "harbour", "vapour", "armour", "endeavour", "odour", "parlour", "savour"]
RE = {"centre": "center", "metre": "meter", "litre": "liter", "fibre": "fiber", "theatre": "theater",
      "calibre": "caliber", "sombre": "somber", "spectre": "specter", "lustre": "luster"}
ISE = ["organis", "recognis", "realis", "normalis", "minimis", "maximis", "optimis", "visualis", "prioritis",
       "initialis", "serialis", "deserialis", "summaris", "synchronis", "customis", "categoris", "finalis",
       "stabilis", "rasteris", "centralis", "utilis", "apologis", "emphasis", "standardis", "specialis",
       "authoris", "capitalis", "digitis", "localis", "memoris", "quantis", "randomis", "sanitis", "tokenis",
       "vectoris", "characteris", "parameteris", "generalis", "materialis", "criticis", "colouris", "equalis",
       "normalis", "polaris", "regularis", "binaris", "linearis", "discretis", "parallelis", "visualis"]
YSE = {"analys": "analyz", "paralys": "paralyz", "catalys": "catalyz"}
DOUBLE_L = {"cancell": "cancel", "label": "label", "model": "model", "travel": "travel", "level": "level",
            "signal": "signal", "channel": "channel", "total": "total", "fuel": "fuel", "marshal": "marshal",
            "tunnel": "tunnel", "funnel": "funnel", "dial": "dial", "pedal": "pedal", "rival": "rival"}
OTHER = {"grey": "gray", "greys": "grays", "whilst": "while", "amongst": "among", "learnt": "learned",
         "spelt": "spelled", "programme": "program", "programmes": "programs", "catalogue": "catalog",
         "catalogues": "catalogs", "licence": "license", "defence": "defense", "offence": "offense",
         "judgement": "judgment", "acknowledgement": "acknowledgment", "acknowledgements": "acknowledgments",
         "ageing": "aging", "artefact": "artifact", "artefacts": "artifacts", "aluminium": "aluminum",
         "sceptical": "skeptical", "tyre": "tire", "tyres": "tires", "cheque": "check", "storey": "story",
         "mould": "mold", "plough": "plow", "manoeuvre": "maneuver", "aeroplane": "airplane", "cosy": "cozy",
         "enrol": "enroll", "fulfil": "fulfill", "practise": "practice", "counsellor": "counselor",
         "jewellery": "jewelry", "speciality": "specialty", "towards": "towards"}

BRITISH: dict[str, str] = {}
for w in OUR:
    am = w.replace("our", "or")
    for end in ["", "s", "ed", "ing", "ful", "less", "able", "ite", "ites", "ise", "ised", "ize", "ized", "ation"]:
        BRITISH[w + end] = am + end
for w, am in RE.items():
    for end in ["", "s", "d"]:
        BRITISH[w + end] = am[:-2] + "er" + ("s" if end == "s" else "ed" if end == "d" else "")
for stem in ISE:
    for end in ["e", "es", "ed", "ing", "ation", "ations", "er", "ers"]:
        BRITISH[stem + end] = stem[:-1] + "z" + end
del BRITISH["emphasise"], BRITISH["emphasises"]  # "emphasis(es)" are nouns in both: only the verb forms differ
BRITISH.pop("emphasiser", None)
for stem, am in YSE.items():
    for end in ["e", "es", "ed", "ing", "er", "ers"]:
        BRITISH[stem + end] = am + end
for stem, am in DOUBLE_L.items():
    base = stem if stem.endswith("ll") else stem + "l"
    for end in ["ed", "ing", "er", "ers"]:
        BRITISH[base + end] = am + end
BRITISH.update({k: v for k, v in OTHER.items() if k != v})
BRITISH.pop("emphasis", None)

ALLOWED = ["AnalyserNode", "createAnalyser", "echoCancellation"]  # Web APIs: the browser spells them so
MARKER = "spelling: ok"
WORD = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+")  # splits identifiers: colour_edges, scanCancelled, AudioAnalyser
# The checker and its tests necessarily contain the words they look for.
SKIP = {"scripts/american_spelling.py", "tests/test_spelling.py"}
TEXT = {".py", ".ts", ".js", ".html", ".css", ".md", ".txt", ".toml", ".yml", ".yaml", ".json", ".cfg", ""}


def find_british(text: str) -> list[tuple[int, str, str]]:
    """(line number, word as written, American spelling) for each British spelling."""
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if MARKER in line:
            continue
        for name in ALLOWED:
            line = line.replace(name, " ")
        for word in WORD.findall(line):
            fix = BRITISH.get(word.lower())
            if fix:
                hits.append((n, word, fix))
    return hits


def repo_problems() -> list[str]:
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    problems = []
    for name in files:
        path = ROOT / name
        if name in SKIP or path.suffix not in TEXT or name.endswith(("package-lock.json", "uv.lock")) or "fixtures/" in name:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        problems += [f"{name}:{n}: {word} -> {fix}" for n, word, fix in find_british(text)]
    return problems


if __name__ == "__main__":
    found = repo_problems()
    print("\n".join(found) or "American spelling: OK")
    sys.exit(1 if found else 0)

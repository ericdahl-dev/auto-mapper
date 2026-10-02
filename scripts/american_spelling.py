"""spelling: skip-file (the word lists below are British by design)

Guards American spelling across the repo: product text, docs and code identifiers.

    python scripts/american_spelling.py [repo]   # lists problems, exits 1 if any (default: this repo)

Words are checked one by one, including inside identifiers (colour_edges, AudioAnalyser,
scanCancelled). Web API names that are British by definition are allowed. A line can opt out
with the marker "spelling: ok" (e.g. when quoting an external name).

A repo can allow words (e.g. a third-party API's names) and skip paths in .american-spelling-allow:

    # comments
    Colour            <- an allowed word, matched case-insensitively, also inside identifiers
    path: vendor/     <- skip files under this path
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
FILE_MARKER = "spelling: skip-file"  # in a file's first 5 lines: skip the whole file
WORD = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+")  # splits identifiers: colour_edges, scanCancelled, AudioAnalyser
TEXT = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".html", ".erb", ".css", ".scss",
        ".md", ".txt", ".rst", ".toml", ".yml", ".yaml", ".json", ".cfg", ".ini", ".go", ".rb", ".rake",
        ".swift", ".c", ".h", ".cpp", ".hpp", ".cc", ".ino", ".rs", ".java", ".kt", ".sh", ".lua", ".sql", ""}
ALWAYS_SKIP = ("node_modules/", "vendor/bundle/", "dist/", "build/", ".min.")
ALLOW_FILE = ".american-spelling-allow"


def find_british(text: str, allowed: set[str] = frozenset()) -> list[tuple[int, str, str]]:
    """(line number, word as written, American spelling) for each British spelling.
    `allowed`: lowercase words to accept (a repo's allowlist)."""
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if MARKER in line:
            continue
        for name in ALLOWED:
            line = line.replace(name, " ")
        for word in WORD.findall(line):
            fix = BRITISH.get(word.lower())
            if fix and word.lower() not in allowed:
                hits.append((n, word, fix))
    return hits


def read_allowlist(root: Path) -> tuple[set[str], list[str]]:
    """(allowed lowercase words, skipped path prefixes) from the repo's allowlist file, if any."""
    words, paths = set(), []
    try:
        lines = (root / ALLOW_FILE).read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return words, paths
    for line in lines:
        line = line.split("#", 1)[0].strip()
        if line.startswith("path:"):
            paths.append(line[5:].strip())
        elif line:
            words.add(line.lower())
    return words, paths


def repo_problems(root: Path = ROOT) -> list[str]:
    root = Path(root)
    files = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True, check=True).stdout.split("\0")
    allowed, skip_paths = read_allowlist(root)
    problems = []
    for name in filter(None, files):
        path = root / name
        if (
            name == ALLOW_FILE
            or path.suffix.lower() not in TEXT
            or name.endswith(("package-lock.json", "uv.lock", "yarn.lock", "Gemfile.lock", "go.sum", "Cargo.lock"))
            or "fixtures/" in name
            or any(part in name for part in ALWAYS_SKIP)
            or any(name.startswith(p) for p in skip_paths)
        ):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        if FILE_MARKER in "\n".join(text.splitlines()[:5]):
            continue
        problems += [f"{name}:{n}: {word} -> {fix}" for n, word, fix in find_british(text, allowed)]
    return problems


if __name__ == "__main__":
    found = repo_problems(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT)
    print("\n".join(found) or "American spelling: OK")
    sys.exit(1 if found else 0)

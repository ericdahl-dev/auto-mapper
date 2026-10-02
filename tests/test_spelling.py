"""spelling: skip-file (this file must contain the words it tests for)

The repo uses American spelling (product text, docs and code). scripts/american_spelling.py guards it."""

from scripts.american_spelling import find_british, repo_problems


def words(text: str) -> list[str]:
    return [w for _, w, _ in find_british(text)]


def test_finds_british_words_with_their_american_spelling():
    hits = find_british("Pick a colour.\nThe centre is cancelled; we analysed it and normalised it.")
    assert [(line, word, fix) for line, word, fix in hits] == [
        (1, "colour", "color"),
        (2, "centre", "center"),
        (2, "cancelled", "canceled"),
        (2, "analysed", "analyzed"),
        (2, "normalised", "normalized"),
    ]


def test_finds_them_inside_identifiers():
    assert words("def colour_edges(): AudioAnalyser(); scanCancelled = 1") == ["colour", "Analyser", "Cancelled"]


def test_leaves_american_words_and_lookalikes_alone():
    assert words("color center canceled noise raise precise otherwise exercise cancellation towards") == []


def test_allows_web_api_names_that_are_british_by_definition():
    assert words("new AnalyserNode(); ctx.createAnalyser(); { echoCancellation: false }") == []


def test_a_line_can_opt_out_with_a_marker():
    assert words('label = "Colour"  # spelling: ok (quoting a camera control name)') == []


def test_the_repo_is_clean():
    assert repo_problems() == []


def _repo(tmp_path, files: dict[str, str]):
    import subprocess

    for name, text in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    return tmp_path


def test_checks_any_repo_given_its_path(tmp_path):
    root = _repo(tmp_path, {"README.md": "Pick a colour.\n", "src/app.go": "func centreOf() {}\n"})
    assert repo_problems(root) == ["README.md:1: colour -> color", "src/app.go:1: centre -> center"]


def test_a_repo_can_allow_words_and_skip_paths(tmp_path):
    root = _repo(tmp_path, {
        ".american-spelling-allow": "# a third-party API spells it so\nColour\npath: vendor/\n",
        "main.rb": "led.setColour(1)\nputs 'centre'\n",
        "vendor/lib.rb": "colour = 1\n",
    })
    assert repo_problems(root) == ["main.rb:2: centre -> center"]


def test_a_file_can_opt_out_entirely(tmp_path):
    root = _repo(tmp_path, {"words.py": "# spelling: skip-file\ncolour\n", "app.py": "colour\n"})
    assert repo_problems(root) == ["app.py:1: colour -> color"]

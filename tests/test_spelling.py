"""The repo uses American spelling (product text, docs and code). scripts/american_spelling.py guards it."""

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

import numpy as np

from engine.scan import bits_for, gray_code_stripe, pattern_sequence

# Shared with frontend/src/output/patterns.test.ts: width 8, 3 bits.
SHARED = {2: "00001111", 1: "00111100", 0: "01100110"}


def test_gray_code_stripe_matches_shared_vector():
    for bit, expected in SHARED.items():
        assert "".join(map(str, gray_code_stripe(8, bit))) == expected


def test_bits_cover_projector_resolution():
    assert bits_for(1920) == 11
    assert bits_for(1080) == 11
    assert bits_for(256) == 8


def test_sequence_is_references_then_each_bit_with_its_inverse():
    seq = pattern_sequence(8, 4)
    assert seq[:2] == [{"kind": "white"}, {"kind": "black"}]
    assert seq[2:4] == [
        {"kind": "gray", "axis": "x", "bit": 2, "inverse": False},
        {"kind": "gray", "axis": "x", "bit": 2, "inverse": True},
    ]
    assert len(seq) == 2 + 2 * (3 + 2)
    assert seq[-1] == {"kind": "gray", "axis": "y", "bit": 0, "inverse": True}

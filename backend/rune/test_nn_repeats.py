"""
Tests for repeated-block detection in extracted neural network models.

A twelve-layer transformer encoder arrives from the extractor as forty-eight
flat layers. Drawing all of them is unreadable and nobody describes the model
that way, so the chart collapses them into one `x12` group. These cover the
period-finding, the tie-breaking that decides *which* period a reader would call
the block, and the invariants the renderer depends on.
"""

from itertools import pairwise

from rune.nn_extractor import detect_repeats


def _layer(layer_id: str, layer_type: str, category: str = "other", **params) -> dict:
    return {
        "id": layer_id,
        "type": layer_type,
        "category": category,
        "params": params,
        "param_count": params.pop("_param_count", None),
    }


def _encoder_block(i: int) -> list[dict]:
    """One BERT-style encoder layer: attention, norm, expand, project."""
    return [
        _layer(f"attn_{i}", "MultiheadAttention", "attention", embed_dim=768, num_heads=12),
        _layer(f"norm_{i}", "LayerNorm", "normalization", normalized_shape=768),
        _layer(f"fc1_{i}", "Linear", "dense", in_features=768, out_features=3072),
        _layer(f"fc2_{i}", "Linear", "dense", in_features=3072, out_features=768),
    ]


def test_finds_a_repeated_multi_layer_block():
    layers = [_layer("emb", "Embedding", "embedding", num_embeddings=30522)]
    for i in range(12):
        layers.extend(_encoder_block(i))
    layers.append(_layer("pool", "Linear", "dense", in_features=768, out_features=768))

    (repeat,) = detect_repeats(layers)
    assert repeat["start"] == 1
    assert repeat["length"] == 4
    assert repeat["count"] == 12


def test_ignores_positional_ids_when_matching():
    """Layer ids are positional, so including one would make every layer unique."""
    layers = [_layer(f"conv_{i}", "Conv2d", "convolution", in_channels=64, out_channels=64) for i in range(6)]
    (repeat,) = detect_repeats(layers)
    assert repeat["count"] == 6


def test_differing_params_break_a_run():
    """ResNet stages look alike but change channel counts, so they are not repeats."""
    layers = [
        _layer("l1", "Conv2d", "convolution", in_channels=64, out_channels=64),
        _layer("l2", "Conv2d", "convolution", in_channels=64, out_channels=128),
        _layer("l3", "Conv2d", "convolution", in_channels=128, out_channels=256),
        _layer("l4", "Conv2d", "convolution", in_channels=256, out_channels=512),
    ]
    assert detect_repeats(layers) == []


def test_prefers_the_primitive_period():
    """Twelve identical layers are a x12 of period 1, not a x6 of period 2."""
    layers = [_layer(f"n{i}", "ReLU", "activation") for i in range(12)]
    (repeat,) = detect_repeats(layers)
    assert repeat["length"] == 1
    assert repeat["count"] == 12


def test_returns_multiple_non_overlapping_runs_in_positional_order():
    layers = [
        *[_layer(f"a{i}", "Conv2d", "convolution", out_channels=64) for i in range(3)],
        _layer("sep", "MaxPool2d", "pooling", kernel_size=2),
        *[_layer(f"b{i}", "Linear", "dense", out_features=512) for i in range(4)],
    ]
    first, second = detect_repeats(layers)
    assert (first["start"], first["count"], first["label"]) == (0, 3, "Conv2d")
    assert (second["start"], second["count"], second["label"]) == (4, 4, "Linear")


def test_repeats_never_overlap():
    layers = []
    for i in range(8):
        layers.extend(_encoder_block(i))
    spans = [(r["start"], r["start"] + r["length"] * r["count"]) for r in detect_repeats(layers)]
    for (_, a_stop), (b_start, _) in pairwise(spans):
        assert a_stop <= b_start, f"overlapping repeats: {spans}"


def test_labels_a_multi_layer_block_from_its_types():
    layers = []
    for i in range(5):
        layers.extend(_encoder_block(i))
    (repeat,) = detect_repeats(layers)
    assert repeat["label"] == "MultiheadAttention + LayerNorm + Linear block"


def test_param_count_is_per_repetition_not_per_run():
    block = [
        {"id": "a", "type": "Linear", "category": "dense", "params": {"n": 1}, "param_count": 1000},
        {"id": "b", "type": "ReLU", "category": "activation", "params": {}, "param_count": None},
    ]
    layers = []
    for _ in range(6):
        layers.extend({**layer} for layer in block)

    (repeat,) = detect_repeats(layers)
    assert repeat["count"] == 6
    assert repeat["param_count"] == 1000


def test_a_single_occurrence_is_not_a_repeat():
    assert detect_repeats(_encoder_block(0)) == []


def test_handles_unhashable_param_values():
    """Params come from AST literals and can hold lists, which are unhashable."""
    layers = [_layer(f"c{i}", "Conv2d", "convolution", kernel_size=[3, 3], stride=[1, 1]) for i in range(4)]
    (repeat,) = detect_repeats(layers)
    assert repeat["count"] == 4


def test_empty_and_tiny_inputs_are_safe():
    assert detect_repeats([]) == []
    assert detect_repeats([_layer("a", "Linear")]) == []

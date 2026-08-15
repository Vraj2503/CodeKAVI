"""
nn_extractor.py — Neural network architecture extractor.

Parses Python source code to extract neural network model definitions,
their layers, connections, and parameters. Used to generate
PlotNeuralNet-style visualizations.

Extraction strategies:
  1. AST-based: Parses nn.Module subclasses, Sequential models, Keras Functional API
  2. LLM-assisted: Fallback for complex/dynamic architectures (stub)
"""

import ast
import json
import logging
import math
import re
from typing import Any

from codekavi.utils import BoundedContentCache

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Layer category mapping
# ─────────────────────────────────────────────

_LAYER_CATEGORIES: dict[str, str] = {
    # Convolution
    "Conv1d": "convolution",
    "Conv2d": "convolution",
    "Conv3d": "convolution",
    "ConvTranspose1d": "convolution",
    "ConvTranspose2d": "convolution",
    "ConvTranspose3d": "convolution",
    "Conv1D": "convolution",
    "Conv2D": "convolution",
    "Conv3D": "convolution",
    # Pooling
    "MaxPool1d": "pooling",
    "MaxPool2d": "pooling",
    "MaxPool3d": "pooling",
    "AvgPool1d": "pooling",
    "AvgPool2d": "pooling",
    "AvgPool3d": "pooling",
    "AdaptiveAvgPool1d": "pooling",
    "AdaptiveAvgPool2d": "pooling",
    "AdaptiveMaxPool2d": "pooling",
    "MaxPooling1D": "pooling",
    "MaxPooling2D": "pooling",
    "MaxPooling3D": "pooling",
    "AveragePooling1D": "pooling",
    "AveragePooling2D": "pooling",
    "AveragePooling3D": "pooling",
    "GlobalAveragePooling1D": "pooling",
    "GlobalAveragePooling2D": "pooling",
    "GlobalMaxPooling1D": "pooling",
    "GlobalMaxPooling2D": "pooling",
    # Dense / Linear
    "Linear": "dense",
    "Dense": "dense",
    "LazyLinear": "dense",
    # Normalization
    "BatchNorm1d": "normalization",
    "BatchNorm2d": "normalization",
    "BatchNorm3d": "normalization",
    "LayerNorm": "normalization",
    "GroupNorm": "normalization",
    "InstanceNorm1d": "normalization",
    "InstanceNorm2d": "normalization",
    "BatchNormalization": "normalization",
    # Activation
    "ReLU": "activation",
    "LeakyReLU": "activation",
    "PReLU": "activation",
    "GELU": "activation",
    "ELU": "activation",
    "Sigmoid": "activation",
    "Tanh": "activation",
    "Softmax": "activation",
    "LogSoftmax": "activation",
    "SiLU": "activation",
    "Mish": "activation",
    "Hardswish": "activation",
    "Activation": "activation",
    # Dropout
    "Dropout": "dropout",
    "Dropout2d": "dropout",
    "Dropout3d": "dropout",
    "AlphaDropout": "dropout",
    "SpatialDropout1D": "dropout",
    "SpatialDropout2D": "dropout",
    # Recurrent
    "LSTM": "recurrent",
    "GRU": "recurrent",
    "RNN": "recurrent",
    "LSTMCell": "recurrent",
    "GRUCell": "recurrent",
    "SimpleRNN": "recurrent",
    "Bidirectional": "recurrent",
    # Attention / Transformer
    "MultiheadAttention": "attention",
    "TransformerEncoder": "attention",
    "TransformerDecoder": "attention",
    "TransformerEncoderLayer": "attention",
    "TransformerDecoderLayer": "attention",
    "Transformer": "attention",
    # Embedding
    "Embedding": "embedding",
    "EmbeddingBag": "embedding",
    # Reshape
    "Flatten": "other",
    "Unflatten": "other",
    "Reshape": "other",
    "Lambda": "other",
    # Keras-specific
    "Input": "other",
    "Concatenate": "other",
    "Add": "other",
}

# PyTorch nn module names for matching
_NN_MODULES = {"nn.Module", "torch.nn.Module"}
_KERAS_MODELS = {"keras.Model", "tf.keras.Model", "keras.models.Model"}

# Import roots that mark a file as an NN-extraction candidate. Matched against
# the first dotted segment of each import (so ``torch.nn.functional`` -> ``torch``).
_ML_FRAMEWORK_ROOTS = {
    "torch",
    "torchvision",
    "tensorflow",
    "tf",
    "keras",
    "jax",
    "flax",
    "transformers",
    "timm",
    "lightning",
    "pytorch_lightning",
    "fastai",
    "diffusers",
    "sentence_transformers",
}

# FileProfile roles that are NN candidates even if the import graph missed them.
_NN_CANDIDATE_ROLES = {"ml_model", "ml_training", "ml_pipeline"}

# Container constructors whose element calls should each be treated as a layer.
_LAYER_CONTAINERS = {"ModuleList", "Sequential", "ModuleDict"}

# Pre-trained model factory calls, matched on the alias-resolved dotted call
# name. Two matching modes, kept separate so they can't collide:
#   - _PRETRAINED_PREFIXES: exact dotted-prefix match (like _is_nn_layer_call)
#   - suffix match on ".from_pretrained" is handled specially in
#     _match_pretrained_call (receiver varies too much for a prefix table)
# `timm.create_model` / `torch.hub.load` are matched as exact call names
# inside _match_pretrained_call, not via this prefix table.
_PRETRAINED_PREFIXES: dict[str, str] = {
    "torchvision.models.": "pytorch",
    "keras.applications.": "keras",
    "tf.keras.applications.": "keras",
    "tensorflow.keras.applications.": "keras",
}
_PRETRAINED_FROM_PRETRAINED_SUFFIX = ".from_pretrained"

# Classes that share the `.from_pretrained` loader but are not models. Matched
# against the lowercased receiver class name, so `RobertaTokenizerFast`,
# `AutoProcessor` and `Wav2Vec2FeatureExtractor` are all rejected.
_NON_MODEL_PRETRAINED_SUFFIXES = (
    "tokenizer",
    "tokenizerfast",
    "processor",
    "featureextractor",
    "imageprocessor",
    "extractor",
    "config",
)


# ─────────────────────────────────────────────
# Import alias resolution (alias/local-base aware extraction)
# ─────────────────────────────────────────────


def _build_import_alias_map(tree: ast.Module) -> dict[str, str]:
    """Map each locally-bound import name to its fully-qualified dotted path.

    Examples:
        ``import torch.nn as N``        -> {"N": "torch.nn"}
        ``import torch``                -> {"torch": "torch"}
        ``from torch import nn``        -> {"nn": "torch.nn"}
        ``from torch.nn import Module`` -> {"Module": "torch.nn.Module"}
        ``from keras import layers``    -> {"layers": "keras.layers"}
    """
    alias_map: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.asname:
                    alias_map[a.asname] = a.name
                else:
                    # ``import torch.nn`` binds only the top-level ``torch`` name.
                    top = a.name.split(".")[0]
                    alias_map[top] = top
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for a in node.names:
                local = a.asname or a.name
                alias_map[local] = f"{module}.{a.name}" if module else a.name
    return alias_map


def _resolve_with_alias(dotted: str | None, alias_map: dict[str, str] | None) -> str | None:
    """Rewrite the first segment of a dotted name through the alias map."""
    if not dotted or not alias_map:
        return dotted
    first, _, rest = dotted.partition(".")
    if first in alias_map:
        base = alias_map[first]
        return f"{base}.{rest}" if rest else base
    return dotted


def _base_dotted_name(base: ast.expr) -> str | None:
    """Return the dotted name of a class base node (``nn.Module`` -> 'nn.Module')."""
    if isinstance(base, ast.Name):
        return base.id
    if isinstance(base, ast.Attribute):
        parts: list[str] = []
        cur: ast.AST = base
        while isinstance(cur, ast.Attribute):
            parts.append(cur.attr)
            cur = cur.value
        if isinstance(cur, ast.Name):
            parts.append(cur.id)
            return ".".join(reversed(parts))
    return None


def _known_base_framework(resolved: str | None) -> str | None:
    """Return the framework ('pytorch'/'keras') if ``resolved`` is a known NN base."""
    if not resolved:
        return None
    if resolved in _KERAS_MODELS or resolved.endswith("keras.Model") or resolved.endswith("keras.models.Model"):
        return "keras"
    if resolved in _NN_MODULES or resolved == "Module" or resolved.endswith("torch.nn.Module"):
        return "pytorch"
    return None


# ─────────────────────────────────────────────
# Block dimension computation
# ─────────────────────────────────────────────


def _compute_block_dims(
    layer_type: str,
    params: dict[str, Any],
    output_shape: list[int] | None,
    spatial_extent: float | None = None,
    channels: int | None = None,
    head: bool = False,
) -> dict:
    """Compute PlotNeuralNet-style 3D block dimensions.

    Three axes, but only two of them carry data:

    - height: the spatial footprint — absolute when the shape is known,
      otherwise the relative extent from `_propagate_spatial_shapes`
    - width: the channel/feature count (log-scaled), along the flow axis
    - depth: a constant lip. NOT a data channel.

    Depth used to mirror height, on the theory that a square face is the honest
    drawing of a square feature map. In practice it made every block a sheared
    parallelogram — at `Z_X = 0.52` an early conv threw 75px of horizontal shear,
    so the figure read as a row of ribbons rather than the reference's clean
    slabs. Both mockups keep the extrusion short and near-constant and let
    height carry the whole spatial story, which is also what makes the blocks
    pack tightly enough to read as one figure.
    """
    min_dim, max_dim = 26.0, 110.0
    min_width, max_width = 6.0, 46.0

    def _log_scale(val: Any, lo: float, hi: float) -> float:
        if not isinstance(val, int | float):
            return lo
        if val <= 0:
            return lo
        scaled = lo + (hi - lo) * (math.log2(val + 1) / math.log2(1024))
        return max(lo, min(hi, scaled))

    def _extent_scale(extent: float) -> float:
        """Map a relative extent onto the face size.

        log2 so that each halving is an equal visual step: 1.0 lands at the top
        of the range, `_EXTENT_FLOOR` (six halvings down) at the bottom. Linear
        would crush every layer past the second stride into the same size.
        """
        t = 1.0 + math.log2(max(extent, _EXTENT_FLOOR)) / 6.0
        return min_dim + (max_dim - min_dim) * max(0.0, min(1.0, t))

    # Sits below every scaled value, so "we know nothing about this layer" is
    # visibly the smallest thing in the figure without disappearing.
    height = 40.0
    depth = _DEPTH_LIP
    width = min_width

    if output_shape:
        if len(output_shape) >= 3:  # [C, H, W]
            height = _log_scale(output_shape[-2], min_dim, max_dim)
            # A declared spatial width is real, so it is allowed to move the
            # lip — but only within the lip's range. Letting it run to `max_dim`
            # would put a model that declares its input shape in a completely
            # different visual register from one that does not.
            depth = _log_scale(output_shape[-1], _DEPTH_LIP_MIN, _DEPTH_LIP_MAX)
            width = _log_scale(output_shape[0], min_width, max_width)
        elif len(output_shape) == 2:  # [C, L] (1D)
            height = _log_scale(output_shape[-1], min_dim, max_dim)
            width = _log_scale(output_shape[0], min_width, max_width)
        elif len(output_shape) == 1:  # [features]
            height = _log_scale(output_shape[0], min_dim, max_dim)

    # Relative silhouette: height alone. We know the map shrank, not by how much
    # in each axis, so there is no second spatial number to draw even if the
    # geometry had a slot for one.
    elif spatial_extent is not None:
        height = _extent_scale(spatial_extent)
        # Thickness follows the running channel count, so a BatchNorm or pool
        # sitting after a 512-channel conv stays as thick as the conv rather
        # than collapsing to a wafer.
        carrier = params.get("out_channels", channels)
        width = _log_scale(carrier, min_width, max_width) if carrier is not None else min_width

    # Fallback from params
    elif "out_channels" in params:
        width = _log_scale(params["out_channels"], min_width, max_width)
    else:
        # Any declared feature width, whatever the framework calls it. Without
        # `units`/`hidden_size`/`embedding_dim` here, a Keras model's every layer
        # fell through to the bare default and the isometric figure was a row
        # of identical slabs — the geometry is the whole point of the view.
        # A classifier head sitting after a collapsed feature map is a small bar,
        # not the tallest thing in the figure. Without the squeeze a 1000-way
        # `fc` out-towers the input conv and inverts the whole silhouette. A
        # pure MLP never sets `head`, so it still uses the full range.
        #
        # 0.12, not the old 0.4: the floor moved from 8 to 26, so the same
        # fraction now buys far more absolute height. At 0.4 a 1000-way `fc`
        # came out TALLER than the last conv block, which is the inversion the
        # squeeze exists to prevent.
        feature_hi = min_dim + (max_dim - min_dim) * 0.12 if head else max_dim
        for key in ("out_features", "units", "hidden_size", "embedding_dim"):
            if key in params:
                height = _log_scale(params[key], min_dim, feature_hi)
                # A dense layer is a vector, not a map. Drawn at the full lip it
                # reads as a slab like the convs; a thin one reads as the bar the
                # reference figure ends on.
                width = min_width
                break

    return {"height": round(height, 1), "depth": round(depth, 1), "width": round(width, 1)}


# ─────────────────────────────────────────────
# AST Helpers
# ─────────────────────────────────────────────


def _layer_signature(layer: dict) -> str:
    """Stable identity for a layer, used to spot repeated blocks.

    Two layers share a signature when they would render identically: same type,
    same category, same constructor params. ``id`` is deliberately excluded —
    ids are positional, so including one would make every layer unique and no
    repeat would ever be found.
    """
    params = layer.get("params") or {}
    try:
        params_key = json.dumps(params, sort_keys=True, default=str)
    except (TypeError, ValueError):
        params_key = repr(sorted(params.items(), key=lambda kv: kv[0]))
    return f"{layer.get('type')}|{layer.get('category')}|{params_key}"


def _repeat_label(block: list[dict]) -> str:
    """Human label for one repetition, derived from the layer types it holds."""
    types = list(dict.fromkeys(layer.get("type") or "?" for layer in block))
    if len(types) == 1:
        return types[0]
    head = " + ".join(types[:3])
    return f"{head} block" if len(types) <= 3 else f"{head} + … block"


def detect_repeats(layers: list[dict], min_count: int = 2) -> list[dict]:
    """Find contiguous repeated runs of layers, so the chart can collapse them.

    A twelve-layer transformer encoder is twelve identical ``(MultiheadAttention,
    LayerNorm, Linear, Linear)`` groups in a row, and drawing all forty-eight is
    both unreadable and untrue to how anyone describes the model. This collapses
    them into one ``x12`` group.

    Emitted **alongside** ``layers``, never in place of them, so the frontend can
    expand a collapsed stack without a second request.

    Returns non-overlapping repeats sorted by position, each shaped::

        {"start": 3, "length": 6, "count": 12, "label": ..., "param_count": ...}

    where ``length`` is the period (layers per repetition), ``count`` is how many
    repetitions, and ``param_count`` is the cost of a *single* repetition.
    """
    n = len(layers)
    if n < 2 * min_count:
        return []

    sigs = [_layer_signature(layer) for layer in layers]

    # Candidate runs. For a period p, layers i and i+p match iff sigs agree, so a
    # maximal run of consecutive matches at stride p is exactly a p-periodic
    # region. That keeps this O(n^2) rather than the O(n^3) of comparing every
    # (start, period, repetition) triple.
    candidates: list[tuple[int, int, int]] = []  # (covered, start, period)
    for period in range(1, n // min_count + 1):
        start = 0
        while start < n - period:
            if sigs[start] != sigs[start + period]:
                start += 1
                continue
            end = start
            while end < n - period and sigs[end] == sigs[end + period]:
                end += 1
            # Region [start, end + period) is p-periodic.
            count = (end + period - start) // period
            if count >= min_count:
                candidates.append((count * period, start, period))
            start = end + 1

    if not candidates:
        return []

    # Widest coverage wins. On a tie prefer the smaller period: twelve identical
    # single layers are a x12 of period 1, not a x6 of period 2, and the
    # primitive period is what a reader would call the block.
    candidates.sort(key=lambda c: (-c[0], c[2], c[1]))

    repeats: list[dict] = []
    taken: list[tuple[int, int]] = []
    for covered, start, period in candidates:
        stop = start + covered
        if any(start < t_stop and t_start < stop for t_start, t_stop in taken):
            continue
        taken.append((start, stop))
        block = layers[start : start + period]
        repeats.append(
            {
                "start": start,
                "length": period,
                "count": covered // period,
                "label": _repeat_label(block),
                "param_count": sum(layer.get("param_count") or 0 for layer in block) or None,
            }
        )

    repeats.sort(key=lambda r: r["start"])
    return repeats


def _ast_to_value(node: ast.AST) -> Any:
    """Convert an AST literal node to a Python value. Returns None for complex expressions."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Tuple | ast.List):
        vals = [_ast_to_value(e) for e in node.elts]
        return tuple(vals) if isinstance(node, ast.Tuple) else vals
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        v = _ast_to_value(node.operand)
        return -v if isinstance(v, int | float) else None
    if isinstance(node, ast.Name):
        # Common constants
        if node.id == "True":
            return True
        if node.id == "False":
            return False
        if node.id == "None":
            return None
        return node.id  # variable reference — return name as string
    if isinstance(node, ast.Attribute):
        return f"{_ast_to_value(node.value)}.{node.attr}" if isinstance(node.value, ast.Name) else None
    return None


def _get_call_name(node: ast.Call) -> str | None:
    """Extract the full dotted name from a Call node (e.g., 'nn.Conv2d')."""
    func = node.func
    if isinstance(func, ast.Attribute):
        parts = []
        current: ast.expr = func
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        return ".".join(reversed(parts))
    elif isinstance(func, ast.Name):
        return func.id
    return None


def _extract_call_params(node: ast.Call) -> dict[str, Any]:
    """Extract keyword arguments and positional args from a Call node."""
    params: dict[str, Any] = {}

    # Positional args — map to common PyTorch parameter names by position
    for i, arg in enumerate(node.args):
        val = _ast_to_value(arg)
        if val is not None:
            params[f"_pos_{i}"] = val

    # Keyword args
    for kw in node.keywords:
        if kw.arg:
            val = _ast_to_value(kw.value)
            if val is not None:
                params[kw.arg] = val

    return params


def _resolve_layer_type(call_name: str) -> str:
    """Extract the layer type name from a dotted call path."""
    # nn.Conv2d -> Conv2d, layers.Dense -> Dense
    parts = call_name.split(".")
    return parts[-1]


_LAYER_PREFIXES = (
    "nn.",
    "torch.nn.",
    "layers.",
    "keras.layers.",
    "tf.keras.layers.",
    "tensorflow.keras.layers.",
    "flax.linen.",
    "flax.nnx.",
)

# Wrapper layers whose "real" layer type is their first positional argument.
_WRAPPER_LAYERS = {"Bidirectional", "TimeDistributed"}


def _recognize_layer_type(call_node: ast.Call, alias_map: dict[str, str] | None = None) -> str | None:
    """Return a layer type name if ``call_node`` looks like a layer constructor, else ``None``.

    Resolves the leading segment through ``alias_map`` first, so aliased imports
    (``import torch.nn as N`` -> ``N.Conv2d``) still match. Falls back to a
    bare-import check (``from keras.layers import Dense`` -> ``Dense(...)``)
    since ``_LAYER_CATEGORIES`` names are distinctive enough to be safe without
    prefix confirmation.
    """
    call_name = _get_call_name(call_node)
    if not call_name:
        return None
    resolved = _resolve_with_alias(call_name, alias_map) or call_name
    if any(resolved.startswith(p) for p in _LAYER_PREFIXES):
        return _resolve_layer_type(resolved)
    leaf = _resolve_layer_type(call_name)
    if leaf in _LAYER_CATEGORIES:
        return leaf
    return None


def _make_layer_dict(
    call_node: ast.Call,
    layer_id: str,
    alias_map: dict[str, str] | None = None,
) -> dict | None:
    """Build a single NNLayer-shaped dict from a layer-constructor Call node, or ``None``.

    Unwraps ``Bidirectional``/``TimeDistributed`` wrappers into their inner layer
    (marking ``bidirectional=True`` for the former) so the underlying recurrent
    layer's type/params/category are reported rather than the wrapper's.
    """
    layer_type = _recognize_layer_type(call_node, alias_map)
    if layer_type is None:
        return None

    wrapper_type = None
    if layer_type in _WRAPPER_LAYERS and call_node.args and isinstance(call_node.args[0], ast.Call):
        inner_type = _recognize_layer_type(call_node.args[0], alias_map)
        if inner_type is not None:
            wrapper_type = layer_type
            layer_type = inner_type
            call_node = call_node.args[0]

    raw_params = _extract_call_params(call_node)
    params = _normalize_params(layer_type, raw_params)
    category = _LAYER_CATEGORIES.get(layer_type, "other")
    if wrapper_type == "Bidirectional":
        category = "recurrent"
        params["bidirectional"] = True

    return {
        "id": layer_id,
        "type": layer_type,
        "category": category,
        "params": params,
        "output_shape": None,
        "param_count": _estimate_param_count(layer_type, params),
        "activation": None,
        "block_dims": _compute_block_dims(layer_type, params, None),
    }


def _match_pretrained_call(call_node: ast.Call, alias_map: dict[str, str] | None) -> dict | None:
    """Detect a pretrained-model factory call (torchvision.models.*, timm,
    torch.hub.load, HuggingFace .from_pretrained, keras.applications.*).

    Returns ``{"arch": str, "framework": str, "weights": Any}`` or ``None``.
    """
    call_name = _get_call_name(call_node)
    if not call_name:
        return None
    resolved = _resolve_with_alias(call_name, alias_map) or call_name
    params = _extract_call_params(call_node)

    if resolved.endswith(_PRETRAINED_FROM_PRETRAINED_SUFFIX):
        receiver = resolved[: -len(_PRETRAINED_FROM_PRETRAINED_SUFFIX)].split(".")[-1]
        # `.from_pretrained` is the loader for tokenizers, processors and configs
        # too, and none of those is a neural network. Without this a repo using
        # `RobertaTokenizer.from_pretrained(...)` reports a text preprocessor as
        # a model, and the chart draws a box for something with no layers.
        if receiver.lower().endswith(_NON_MODEL_PRETRAINED_SUFFIXES):
            return None
        arch = None
        if call_node.args:
            first = _ast_to_value(call_node.args[0])
            if isinstance(first, str):
                arch = first
        if arch is None:
            arch = receiver
        return {"arch": arch, "framework": "pytorch", "weights": params.get("weights", arch)}

    if resolved == "timm.create_model" or resolved.endswith(".timm.create_model"):
        arch = _ast_to_value(call_node.args[0]) if call_node.args else None
        return {
            "arch": arch if isinstance(arch, str) else "timm_model",
            "framework": "pytorch",
            "weights": params.get("pretrained", params.get("weights")),
        }

    if resolved == "torch.hub.load" or resolved.endswith(".torch.hub.load"):
        arch = _ast_to_value(call_node.args[1]) if len(call_node.args) >= 2 else None
        if not isinstance(arch, str):
            arch = params.get("model", "hub_model")
        return {
            "arch": arch,
            "framework": "pytorch",
            "weights": params.get("pretrained", params.get("weights")),
        }

    for prefix, framework in _PRETRAINED_PREFIXES.items():
        if resolved.startswith(prefix):
            arch = resolved[len(prefix) :].split(".")[0] or resolved.split(".")[-1]
            return {
                "arch": arch,
                "framework": framework,
                "weights": params.get("weights", params.get("pretrained")),
            }

    return None


def _normalize_params(layer_type: str, params: dict) -> dict:
    """Normalize positional params to named params based on layer type."""
    normalized = {k: v for k, v in params.items() if not k.startswith("_pos_")}

    # PyTorch Conv2d: (in_channels, out_channels, kernel_size, ...)
    if layer_type in ("Conv1d", "Conv2d", "Conv3d", "ConvTranspose1d", "ConvTranspose2d", "ConvTranspose3d"):
        pos_map = ["in_channels", "out_channels", "kernel_size", "stride", "padding"]
    elif layer_type in ("Conv1D", "Conv2D", "Conv3D"):
        # Keras: Conv2D(filters, kernel_size, strides=...). Aliased to the torch
        # vocabulary below so one set of downstream rules covers both frameworks.
        pos_map = ["filters", "kernel_size", "strides"]
    elif layer_type in (
        "MaxPooling1D",
        "MaxPooling2D",
        "MaxPooling3D",
        "AveragePooling1D",
        "AveragePooling2D",
        "AveragePooling3D",
    ):
        pos_map = ["pool_size", "strides"]
    elif layer_type in ("Linear", "LazyLinear"):
        pos_map = ["in_features", "out_features", "bias"]
    elif layer_type in ("BatchNorm1d", "BatchNorm2d", "BatchNorm3d"):
        pos_map = ["num_features"]
    elif layer_type in ("MaxPool1d", "MaxPool2d", "MaxPool3d", "AvgPool1d", "AvgPool2d", "AvgPool3d"):
        pos_map = ["kernel_size", "stride", "padding"]
    elif layer_type in ("Dropout", "Dropout2d", "Dropout3d"):
        pos_map = ["p"]
    elif layer_type in ("Embedding", "EmbeddingBag"):
        pos_map = ["num_embeddings", "embedding_dim"]
    elif layer_type in ("LSTM", "GRU", "RNN"):
        pos_map = ["input_size", "hidden_size", "num_layers"]
    elif layer_type == "Dense":  # Keras
        pos_map = ["units"]
    elif layer_type == "LayerNorm":
        pos_map = ["normalized_shape"]
    elif layer_type == "GroupNorm":
        pos_map = ["num_groups", "num_channels"]
    elif layer_type == "MultiheadAttention":
        pos_map = ["embed_dim", "num_heads"]
    else:
        pos_map = []

    for i, name in enumerate(pos_map):
        key = f"_pos_{i}"
        if key in params and name not in normalized:
            normalized[name] = params[key]

    # Keras spellings aliased onto the torch vocabulary, so stride/channel rules
    # downstream do not need a branch per framework. The originals are kept for
    # display — the tooltip should show what the author actually wrote.
    for keras_name, torch_name in (("filters", "out_channels"), ("strides", "stride"), ("pool_size", "kernel_size")):
        if keras_name in normalized and torch_name not in normalized:
            normalized[torch_name] = normalized[keras_name]

    return normalized


"""Smallest relative feature-map extent the geometry distinguishes: six
halvings below the input, which covers ResNet's 224 -> 7 and then some."""
_EXTENT_FLOOR = 1.0 / 64.0

"""Depth of the oblique extrusion. Constant, and deliberately not a data
channel: it exists to make a block read as a solid rather than a rectangle.
`_DEPTH_LIP_MIN/MAX` bound the one case that may vary it, a declared spatial
width from a real `output_shape`."""
_DEPTH_LIP = 14.0
_DEPTH_LIP_MIN = 10.0
_DEPTH_LIP_MAX = 22.0


def _is_pos_int(value: Any) -> bool:
    """True for a usable size. Params come from AST literals, so a value can be
    a variable name (`'vocab_size'`) or a bool — neither is a dimension."""
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _kernel_volume(kernel_size: Any, ndim: int) -> int | None:
    """Weights per (in_channel, out_channel) pair for an ``ndim``-dimensional kernel.

    ``kernel_size`` is either a scalar applying to every axis, or a per-axis
    sequence. A scalar 3 on a Conv2d means 3x3 = 9; an explicit ``(3, 5)``
    means 15.
    """
    if isinstance(kernel_size, bool):
        return None
    if isinstance(kernel_size, int):
        return kernel_size**ndim
    if isinstance(kernel_size, list | tuple) and kernel_size:
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in kernel_size):
            return None
        if len(kernel_size) < ndim:  # under-specified, treat as a scalar
            return int(kernel_size[0]) ** ndim
        volume = 1
        for axis in kernel_size[:ndim]:
            volume *= axis
        return volume
    return None


def _estimate_param_count(layer_type: str, params: dict) -> int | None:
    """Rough parameter count estimation for common layer types."""
    try:
        if layer_type in (
            "Conv1d",
            "Conv2d",
            "Conv3d",
            "ConvTranspose1d",
            "ConvTranspose2d",
            "ConvTranspose3d",
        ):
            ic = params.get("in_channels", 0)
            oc = params.get("out_channels", 0)
            bias = 1 if params.get("bias", True) else 0
            volume = _kernel_volume(params.get("kernel_size", 3), int(layer_type[-2]))
            groups = params.get("groups", 1)
            if not isinstance(groups, int) or isinstance(groups, bool) or groups < 1:
                groups = 1
            if ic and oc and volume:
                # Depthwise convs (groups == in_channels) cost a fraction of the
                # dense equivalent, so ignoring groups overstates MobileNet- and
                # EfficientNet-style nets by orders of magnitude.
                return int(ic * oc * volume // groups + oc * bias)
        elif layer_type == "MultiheadAttention":
            # q/k/v/out projections: four embed_dim x embed_dim matrices plus
            # four bias vectors. Without this a transformer's largest component
            # counts as zero.
            embed_dim = params.get("embed_dim", 0)
            if embed_dim:
                bias = 1 if params.get("bias", True) else 0
                return int(4 * embed_dim * embed_dim + 4 * embed_dim * bias)
        elif layer_type == "GroupNorm":
            nc = params.get("num_channels", 0)
            if nc:
                return int(nc * 2)  # gamma + beta
        elif layer_type in ("Linear", "LazyLinear", "Dense"):
            # in_features is NOT defaulted to `units`. Keras `Dense(64)` declares
            # only its output width, and assuming the input matches invented a
            # number that was right solely when in == out — a Dense(6) after a
            # 64-wide layer was reported as 42 instead of 390. Unknown input
            # means no estimate; `_propagate_feature_widths` fills it in when the
            # preceding layer actually tells us.
            inf = params.get("in_features")
            outf = params.get("out_features", params.get("units"))
            if _is_pos_int(inf) and _is_pos_int(outf):
                bias = 1 if params.get("bias", True) else 0
                return int(inf * outf + outf * bias)
        elif layer_type in ("BatchNorm1d", "BatchNorm2d", "BatchNorm3d"):
            nf = params.get("num_features", 0)
            if nf:
                return int(nf * 2)  # gamma + beta
        elif layer_type in ("Embedding", "EmbeddingBag"):
            ne = params.get("num_embeddings", 0)
            ed = params.get("embedding_dim", 0)
            if ne and ed:
                return int(ne * ed)
        elif layer_type in ("LSTM", "GRU", "RNN"):
            inp = params.get("input_size", 0)
            hid = params.get("hidden_size", 0)
            nl = params.get("num_layers", 1)
            if inp and hid:
                gates = {"LSTM": 4, "GRU": 3}.get(layer_type, 1)
                total = int(nl * gates * (inp * hid + hid * hid + hid))
                return total * 2 if params.get("bidirectional") else total
        elif layer_type == "LayerNorm":
            ns = params.get("normalized_shape", 0)
            if isinstance(ns, list | tuple):
                ns = 1
                for v in params.get("normalized_shape", []):
                    ns *= v
            if ns:
                return int(ns * 2)
    except (TypeError, ValueError):
        pass
    return None


# ─────────────────────────────────────────────
# Module-based extraction (nn.Module subclass)
# ─────────────────────────────────────────────


_CONV_TYPES = (
    "Conv1d",
    "Conv2d",
    "Conv3d",
    "ConvTranspose1d",
    "ConvTranspose2d",
    "ConvTranspose3d",
    "Conv1D",
    "Conv2D",
    "Conv3D",
)

_POOL_TYPES = (
    "MaxPool1d",
    "MaxPool2d",
    "MaxPool3d",
    "AvgPool1d",
    "AvgPool2d",
    "AvgPool3d",
    "MaxPooling1D",
    "MaxPooling2D",
    "MaxPooling3D",
    "AveragePooling1D",
    "AveragePooling2D",
    "AveragePooling3D",
)

# Collapse the feature map to a single cell whatever came in.
_GLOBAL_POOL_TYPES = (
    "AdaptiveAvgPool1d",
    "AdaptiveAvgPool2d",
    "AdaptiveMaxPool2d",
    "GlobalAveragePooling1D",
    "GlobalAveragePooling2D",
    "GlobalMaxPooling1D",
    "GlobalMaxPooling2D",
)

# Past these there is no spatial extent left to draw.
_SPATIAL_TERMINATORS = ("Flatten", "Linear", "LazyLinear", "Dense")

# Layers that pass the feature width through untouched. Pooling included: it
# changes spatial extent, not channel count.
_WIDTH_PRESERVING = {
    "ReLU",
    "LeakyReLU",
    "GELU",
    "SiLU",
    "ELU",
    "Tanh",
    "Sigmoid",
    "Softmax",
    "Dropout",
    "Dropout1d",
    "Dropout2d",
    "Dropout3d",
    "BatchNorm1d",
    "BatchNorm2d",
    "BatchNorm3d",
    "LayerNorm",
    "GroupNorm",
    "MaxPool1d",
    "MaxPool2d",
    "MaxPool3d",
    "AvgPool1d",
    "AvgPool2d",
    "AvgPool3d",
    "AdaptiveAvgPool1d",
    "AdaptiveAvgPool2d",
    "AdaptiveMaxPool2d",
    "Activation",
    "Flatten",
    "Identity",
}


def _declared_output_width(layer: dict, framework: str) -> int | None:
    """The feature/channel width a layer emits, when it states one outright."""
    layer_type = layer["type"]
    params = layer["params"]

    if layer_type in _CONV_TYPES:
        candidate = params.get("out_channels")
    elif layer_type in ("Linear", "LazyLinear", "Dense"):
        candidate = params.get("out_features", params.get("units"))
    elif layer_type in ("Embedding", "EmbeddingBag"):
        candidate = params.get("embedding_dim")
    elif layer_type == "MultiheadAttention":
        candidate = params.get("embed_dim")
    elif layer_type in ("LSTM", "GRU", "RNN"):
        candidate = params.get("hidden_size")
        if not _is_pos_int(candidate) and framework != "pytorch":
            # Keras `LSTM(64)` means 64 units, but the positional map is
            # PyTorch's `(input_size, hidden_size, ...)`, so it landed in
            # input_size. Read it back as the hidden width.
            candidate = params.get("input_size")
        if _is_pos_int(candidate) and params.get("bidirectional"):
            return candidate * 2
    else:
        return None

    return candidate if _is_pos_int(candidate) else None


def _propagate_feature_widths(model: dict) -> None:
    """Fill in each layer's INPUT width from the layer before it, in place.

    A layer usually declares only what it emits: `Dense(64)` says nothing about
    what it consumes. Walking the chain recovers the missing half, which is what
    turns a parameter count from a guess into a number. Where the chain breaks
    (an `Embedding(vocab_size, ...)` whose arguments are variables) the width
    goes unknown and downstream layers correctly report no estimate rather than
    inventing one.

    Only sound for a linear chain, which is what `layers` is — a branching
    graph would need the connection list, and guessing there would reintroduce
    exactly the fabrication this removes.
    """
    framework = model.get("framework") or "pytorch"
    width: int | None = None

    for layer in model.get("layers") or []:
        layer_type = layer["type"]
        params = layer["params"]

        if width is not None:
            if layer_type in ("Linear", "Dense") and not _is_pos_int(params.get("in_features")):
                params["in_features"] = width
            elif layer_type in _CONV_TYPES and not _is_pos_int(params.get("in_channels")):
                params["in_channels"] = width
            elif (
                layer_type in ("LSTM", "GRU", "RNN")
                and framework != "pytorch"
                # Keras put units in input_size; move it and use the real input.
                and _is_pos_int(params.get("input_size"))
                and not _is_pos_int(params.get("hidden_size"))
            ):
                params["hidden_size"] = params["input_size"]
                params["input_size"] = width

        declared = _declared_output_width(layer, framework)
        if declared is not None:
            width = declared
        elif layer_type not in _WIDTH_PRESERVING:
            width = None  # unknown transform — stop claiming to know

        layer["param_count"] = _estimate_param_count(layer_type, params)
        layer["block_dims"] = _compute_block_dims(layer_type, params, layer.get("output_shape"))

    total = sum(layer.get("param_count") or 0 for layer in model.get("layers") or [])
    model["total_params"] = total if total > 0 else None


def _first_int(value: Any) -> int | None:
    """First usable integer from a scalar or a per-axis sequence."""
    if _is_pos_int(value):
        return int(value)
    if isinstance(value, list | tuple):
        for item in value:
            if _is_pos_int(item):
                return int(item)
    return None


def _spatial_stride(layer_type: str, params: dict) -> int:
    """How much this layer divides the feature map by.

    Pooling strides default to the pool window, which is why a bare
    ``MaxPool2d(2)`` halves the map. Convolution strides default to 1.
    """
    stride = _first_int(params.get("stride"))
    if stride:
        return stride
    if layer_type in _POOL_TYPES:
        return _first_int(params.get("kernel_size")) or 1
    return 1


def _propagate_spatial_shapes(model: dict) -> None:
    """Track how the feature map shrinks through the network, in place.

    This is what gives the figure its silhouette: a tall slab at the input
    collapsing to a small block at the head, which is the whole visual argument
    of a PlotNeuralNet-style diagram. Without it every block is the same size
    and the isometric view says nothing.

    Extent is **relative** — 1.0 at the input, halved by each stride-2 layer.
    Repo code almost never states its input resolution, and inventing one would
    put tensor shapes on a figure meant for papers that the source never
    claimed. `output_shape` is therefore left alone unless the model genuinely
    declares an input, which is the only case where absolute numbers are ours to
    print.
    """
    extent: float | None = 1.0
    channels: int | None = None
    had_spatial = False
    prev_dims: dict | None = None
    framework = model.get("framework") or "pytorch"

    for layer in model.get("layers") or []:
        layer_type = layer["type"]
        params = layer["params"]

        if layer_type in _SPATIAL_TERMINATORS:
            extent = None
        elif extent is not None:
            if layer_type in _CONV_TYPES or layer_type in _POOL_TYPES or layer_type in _GLOBAL_POOL_TYPES:
                had_spatial = True
            if layer_type in _GLOBAL_POOL_TYPES:
                # Collapses to a single cell regardless of what came in, so it
                # lands at the small end of the scale.
                extent = _EXTENT_FLOOR
            elif layer_type in _CONV_TYPES or layer_type in _POOL_TYPES:
                stride = _spatial_stride(layer_type, params)
                if stride > 1:
                    extent = extent / stride

        declared = _declared_output_width(layer, framework)
        if declared is not None:
            channels = declared
        elif layer_type not in _WIDTH_PRESERVING:
            # Same reset `_propagate_feature_widths` applies. Without it the
            # carrier survived an unknown op forever, so a block downstream of
            # something we cannot read still drew — and would now still label —
            # the last width we happened to recognise.
            channels = None

        layer["spatial_extent"] = round(extent, 6) if extent is not None else None
        # The running width is already load-bearing for the geometry; publishing
        # it is what lets the figure label its arrows. `_declared_output_width`
        # is the single gate on whether a width is known, so this stays read
        # rather than inferred: a layer downstream of an unresolvable
        # `Embedding(vocab_size, ...)` carries None and gets no label.
        layer["feature_width"] = channels
        dims = _compute_block_dims(
            layer_type,
            params,
            layer.get("output_shape"),
            spatial_extent=extent,
            channels=channels,
            head=had_spatial and extent is None,
        )

        # An activation or dropout declares no size of its own. Left at the
        # default it renders as a 36px dot wedged between 130px slabs, which
        # reads as a gap in the model rather than a step in it. It passes its
        # input through unchanged, so it should look like what it received.
        declares_size = any(
            key in params for key in ("out_channels", "out_features", "units", "hidden_size", "embedding_dim")
        )
        if prev_dims and extent is None and not declares_size and layer_type in _WIDTH_PRESERVING:
            dims["height"] = prev_dims["height"]
            dims["depth"] = prev_dims["depth"]

        layer["block_dims"] = dims
        prev_dims = dims


def _flatten_layer_elements(node: ast.expr) -> list[ast.Call]:
    """Flatten a Sequential/container-style argument into an ordered list of
    layer-constructor Call nodes.

    Handles a plain layer call, list/tuple literals, and
    ``OrderedDict(...)``/dict literals (taking each entry's ``(name, layer)``
    value) so ``nn.Sequential(OrderedDict(...))`` and
    ``keras.Sequential([...])`` are both recognized.
    """
    if isinstance(node, ast.Call):
        call_name = _get_call_name(node)
        last = call_name.split(".")[-1] if call_name else ""
        if last == "OrderedDict" and node.args:
            return _flatten_layer_elements(node.args[0])
        return [node]
    if isinstance(node, ast.List | ast.Tuple):
        result: list[ast.Call] = []
        for el in node.elts:
            if isinstance(el, ast.Tuple | ast.List) and len(el.elts) == 2 and isinstance(el.elts[1], ast.Call):
                result.append(el.elts[1])  # ("name", layer) pair from an OrderedDict-style list
            elif isinstance(el, ast.Call):
                result.append(el)
        return result
    if isinstance(node, ast.Dict):
        return [v for v in node.values if isinstance(v, ast.Call)]
    return []


def _sequential_connections(layers: list[dict], unverified: bool = False) -> list[dict]:
    """Build linear ``input -> layer0 -> ... -> layerN -> output`` connections."""
    conn_type = "sequential-unverified" if unverified else "sequential"
    connections: list[dict] = []
    for i in range(len(layers)):
        from_id = "input" if i == 0 else layers[i - 1]["id"]
        connections.append({"from_id": from_id, "to_id": layers[i]["id"], "type": conn_type})
    connections.append({"from_id": layers[-1]["id"], "to_id": "output", "type": conn_type})
    return connections


def _collect_layers_from_value(
    value: ast.expr,
    base_id: str,
    layers: list[dict],
    layer_order: list[str],
    alias_map: dict[str, str] | None,
) -> None:
    """Append layer(s) from an assignment/append value.

    Handles a direct layer call, and container constructors
    (``nn.ModuleList``/``nn.Sequential``/``nn.ModuleDict``) whose element calls
    are each treated as a layer so config/loop-built models aren't empty.
    """
    if not isinstance(value, ast.Call):
        return

    call_name = _get_call_name(value)
    last = call_name.split(".")[-1] if call_name else ""
    if last in _LAYER_CONTAINERS:
        # Flatten container elements (positional args, incl. list/tuple/dict literals).
        elements: list[ast.Call] = []
        for arg in value.args:
            elements.extend(_flatten_layer_elements(arg))
        for kw in value.keywords:
            if kw.arg == "layers":
                elements.extend(_flatten_layer_elements(kw.value))
        for idx, el in enumerate(elements):
            _collect_layers_from_value(el, f"{base_id}_{idx}", layers, layer_order, alias_map)
        return

    layer = _make_layer_dict(value, base_id, alias_map)
    if layer is None:
        match = _match_pretrained_call(value, alias_map)
        if match is not None:
            layer = _build_pretrained_layer(match, base_id)
    if layer is not None:
        layers.append(layer)
        layer_order.append(base_id)


def _extract_module_class(
    class_node: ast.ClassDef,
    file_path: str,
    framework: str = "pytorch",
    alias_map: dict[str, str] | None = None,
) -> dict | None:
    """Extract a neural network architecture from an nn.Module or Keras Model subclass."""
    layers: list[dict] = []
    layer_order: list[str] = []
    connections: list[dict] = []

    # 1. Parse __init__ — find self.xxx = nn.YYY(...) assignments
    init_method = None
    forward_method = None
    for item in class_node.body:
        if isinstance(item, ast.FunctionDef | ast.AsyncFunctionDef):
            if item.name == "__init__":
                init_method = item
            elif item.name == "forward":
                # PyTorch execution graph
                forward_method = item
            elif item.name == "call" and forward_method is None:
                # Keras subclassed models define call() instead of forward()
                forward_method = item

    if not init_method:
        return None

    # Walk __init__ for layer assignments. Covers `self.x = nn.Y(...)`,
    # container values (`nn.ModuleList([...])`, `nn.Sequential(...)`), and
    # dynamic `self.layers.append(nn.Y(...))` calls built in loops/from config.
    dynamic_idx = 0
    for node in ast.walk(init_method):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == "self"
                ):
                    _collect_layers_from_value(node.value, target.attr, layers, layer_order, alias_map)
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            func = node.value.func
            arg0 = node.value.args[0] if node.value.args else None
            if isinstance(func, ast.Attribute) and func.attr == "append" and isinstance(arg0, ast.Call):
                layer = _make_layer_dict(arg0, f"append_{dynamic_idx}", alias_map)
                if layer is not None:
                    layers.append(layer)
                    layer_order.append(layer["id"])
                    dynamic_idx += 1

    if not layers:
        return None

    # 2. Parse forward() (or Keras call()) to determine execution order &
    # detect skip connections.
    if forward_method:
        _extract_forward_connections(forward_method, layer_order, connections, layers)
    else:
        # M-02: no forward()/call() method to trace execution from — this is
        # unverified declaration order, not a confirmed execution graph, so
        # label it accordingly rather than asserting "sequential".
        for i in range(len(layer_order)):
            from_id = "input" if i == 0 else layer_order[i - 1]
            connections.append({"from_id": from_id, "to_id": layer_order[i], "type": "sequential-unverified"})
        if layer_order:
            connections.append({"from_id": layer_order[-1], "to_id": "output", "type": "sequential-unverified"})

    total_params = sum(layer.get("param_count", 0) or 0 for layer in layers)

    return {
        "name": class_node.name,
        "file": file_path,
        "line": class_node.lineno,
        "framework": framework,
        "type": "class",
        "total_params": total_params if total_params > 0 else None,
        "input_shape": None,
        "output_shape": None,
        "layers": layers,
        "connections": connections,
        "blocks": None,
    }


def _extract_forward_connections(
    forward_node: ast.FunctionDef | ast.AsyncFunctionDef,
    layer_order: list[str],
    connections: list[dict],
    layers: list[dict],
) -> None:
    """Analyze forward()/call() to extract layer execution order and skip connections."""
    # Simple approach: track variable assignments and the terminal return in
    # forward()/call(): x = self.conv1(x) → conv1 follows previous assignment.
    call_sequence: list[str] = []

    for node in ast.walk(forward_node):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            # Check if RHS is self.layer(x)
            if isinstance(target, ast.Name) and isinstance(node.value, ast.Call):
                call_name = _get_call_name(node.value)
                if call_name and call_name.startswith("self."):
                    layer_name = call_name.split("self.")[-1]
                    if layer_name in layer_order:
                        call_sequence.append(layer_name)
        elif isinstance(node, ast.Return) and isinstance(node.value, ast.Call):
            # M-02: `return self.layer(x)` is an extremely common terminal
            # statement (e.g. ResNet-style `return self.fc(x)`) and was
            # previously invisible here since only Assign was matched — the
            # last-applied layer silently vanished from the execution chain.
            call_name = _get_call_name(node.value)
            if call_name and call_name.startswith("self."):
                layer_name = call_name.split("self.")[-1]
                if layer_name in layer_order and (not call_sequence or call_sequence[-1] != layer_name):
                    call_sequence.append(layer_name)

    # Build connections from call sequence
    if call_sequence:
        # input -> first layer
        connections.append({"from_id": "input", "to_id": call_sequence[0], "type": "sequential"})
        for i in range(1, len(call_sequence)):
            connections.append(
                {
                    "from_id": call_sequence[i - 1],
                    "to_id": call_sequence[i],
                    "type": "sequential",
                }
            )
        # last layer -> output
        connections.append({"from_id": call_sequence[-1], "to_id": "output", "type": "sequential"})
    else:
        # M-02: forward()/call() didn't yield any recognizable self.layer(x)
        # calls (e.g. dynamic/loop-based execution) — fall back to
        # declaration order but label it unverified rather than asserting a
        # confirmed sequential architecture.
        for i in range(len(layer_order)):
            from_id = "input" if i == 0 else layer_order[i - 1]
            connections.append({"from_id": from_id, "to_id": layer_order[i], "type": "sequential-unverified"})
        if layer_order:
            connections.append({"from_id": layer_order[-1], "to_id": "output", "type": "sequential-unverified"})


# ─────────────────────────────────────────────
# Sequential model extraction
# ─────────────────────────────────────────────


def _extract_sequential(
    call_node: ast.Call,
    file_path: str,
    line: int,
    model_name: str = "SequentialModel",
    alias_map: dict[str, str] | None = None,
    framework: str = "pytorch",
) -> dict | None:
    """Extract layers from ``Sequential(...)`` definitions.

    Handles positional layer args, a single list/tuple literal
    (``keras.Sequential([...])``), and ``OrderedDict``/dict-of-layers
    (``nn.Sequential(OrderedDict(...))``) via ``_flatten_layer_elements``.
    """
    layer_calls: list[ast.Call] = []
    for arg in call_node.args:
        layer_calls.extend(_flatten_layer_elements(arg))
    for kw in call_node.keywords:
        if kw.arg == "layers":
            layer_calls.extend(_flatten_layer_elements(kw.value))

    layers: list[dict] = []
    for call in layer_calls:
        layer = _make_layer_dict(call, f"layer_{len(layers)}", alias_map)
        if layer is not None:
            layers.append(layer)

    if not layers:
        return None

    connections = _sequential_connections(layers)
    total_params = sum(layer.get("param_count", 0) or 0 for layer in layers)

    return {
        "name": model_name,
        "file": file_path,
        "line": line,
        "framework": framework,
        "type": "sequential",
        "total_params": total_params if total_params > 0 else None,
        "input_shape": None,
        "output_shape": None,
        "layers": layers,
        "connections": connections,
        "blocks": None,
    }


# ─────────────────────────────────────────────
# Imperative Sequential extraction (model.add(...) chains)
# ─────────────────────────────────────────────


def _extract_imperative_sequential(
    tree: ast.Module,
    file_path: str,
    alias_map: dict[str, str] | None,
) -> list[dict]:
    """Extract Keras imperative ``model = Sequential(); model.add(Layer(...))`` chains.

    Only tracks ``Sequential()`` assignments with *no* layer args, so this pass
    stays mutually exclusive with the list/positional-form Sequential handling
    in ``_extract_sequential`` (no double emission for the same model).
    """
    models: list[dict] = []

    tracked: dict[str, int] = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and len(node.targets) == 1):
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        call_name = _get_call_name(node.value)
        if not call_name:
            continue
        resolved = _resolve_with_alias(call_name, alias_map) or call_name
        if resolved.split(".")[-1] != "Sequential":
            continue
        if node.value.args or node.value.keywords:
            continue  # has layer args — handled by _extract_sequential instead
        tracked[target.id] = node.lineno

    if not tracked:
        return models

    add_calls: dict[str, list[tuple[int, ast.Call]]] = {name: [] for name in tracked}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)):
            continue
        call = node.value
        func = call.func
        if not (isinstance(func, ast.Attribute) and func.attr == "add" and isinstance(func.value, ast.Name)):
            continue
        var_name = func.value.id
        arg0 = call.args[0] if call.args else None
        if var_name not in tracked or not isinstance(arg0, ast.Call):
            continue
        add_calls[var_name].append((call.lineno, arg0))

    for var_name, calls in add_calls.items():
        calls.sort(key=lambda pair: pair[0])  # ast.walk is unordered
        layers: list[dict] = []
        for _, layer_call in calls:
            layer = _make_layer_dict(layer_call, f"layer_{len(layers)}", alias_map)
            if layer is not None:
                layers.append(layer)
        if not layers:
            continue

        total_params = sum(layer.get("param_count", 0) or 0 for layer in layers)
        models.append(
            {
                "name": var_name,
                "file": file_path,
                "line": tracked[var_name],
                "framework": "keras",
                "type": "sequential",
                "total_params": total_params if total_params > 0 else None,
                "input_shape": None,
                "output_shape": None,
                "layers": layers,
                "connections": _sequential_connections(layers),
                "blocks": None,
            }
        )

    return models


# ─────────────────────────────────────────────
# Keras functional API extraction
# ─────────────────────────────────────────────


def _extract_functional(
    tree: ast.Module,
    file_path: str,
    alias_map: dict[str, str] | None,
) -> list[dict]:
    """Extract Keras functional-API models:

    ``x = Dense(64)(inputs); outputs = Dense(6)(x); model = Model(inputs, outputs)``
    """
    models: list[dict] = []

    # var name -> ("input", None, []) | ("layer", layer_call_node, [input_var_names])
    var_kind: dict[str, tuple[str, ast.Call | None, list[str]]] = {}
    var_lineno: dict[str, int] = {}

    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)):
            continue
        target_name = node.targets[0].id
        value = node.value
        if not isinstance(value, ast.Call):
            continue

        if isinstance(value.func, ast.Call):
            # Functional application: <layer-constructor call>(<tensor(s)>)
            layer_type = _recognize_layer_type(value.func, alias_map)
            if layer_type is None:
                continue
            input_vars: list[str] = []
            for arg in value.args:
                if isinstance(arg, ast.Name):
                    input_vars.append(arg.id)
                elif isinstance(arg, ast.List | ast.Tuple):
                    input_vars.extend(el.id for el in arg.elts if isinstance(el, ast.Name))
            var_kind[target_name] = ("layer", value.func, input_vars)
            var_lineno[target_name] = node.lineno
            continue

        call_name = _get_call_name(value)
        resolved = (_resolve_with_alias(call_name, alias_map) or call_name) if call_name else None
        leaf = resolved.split(".")[-1] if resolved else None
        if leaf == "Input":
            var_kind[target_name] = ("input", None, [])
            var_lineno[target_name] = node.lineno

    if not var_kind:
        return models

    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)):
            continue
        call = node.value
        call_name = _get_call_name(call)
        if not call_name:
            continue
        resolved = _resolve_with_alias(call_name, alias_map) or call_name
        if resolved.split(".")[-1] != "Model":
            continue

        kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}
        inputs_node = kwargs.get("inputs") or (call.args[0] if len(call.args) >= 1 else None)
        outputs_node = kwargs.get("outputs") or (call.args[1] if len(call.args) >= 2 else None)
        if not (isinstance(inputs_node, ast.Name) and isinstance(outputs_node, ast.Name)):
            continue
        input_var, output_var = inputs_node.id, outputs_node.id
        if input_var not in var_kind or output_var not in var_kind:
            continue

        model_name = "FunctionalModel"
        if node.targets and isinstance(node.targets[0], ast.Name):
            model_name = node.targets[0].id

        model = _build_functional_model(var_kind, var_lineno, output_var, file_path, node.lineno, model_name, alias_map)
        if model is not None:
            models.append(model)

    return models


def _build_functional_model(
    var_kind: dict[str, tuple[str, ast.Call | None, list[str]]],
    var_lineno: dict[str, int],
    output_var: str,
    file_path: str,
    line: int,
    model_name: str,
    alias_map: dict[str, str] | None,
) -> dict | None:
    """Trace the functional-API dataflow graph backward from ``output_var``."""
    layer_ids: dict[str, str] = {}
    id_to_var: dict[str, str] = {}
    layers: list[dict] = []
    connections: list[dict] = []
    visiting: set[str] = set()

    def visit(var_name: str) -> str | None:
        if var_name in layer_ids:
            return layer_ids[var_name]
        kind = var_kind.get(var_name)
        if kind is None:
            return None
        tag, layer_call, input_vars = kind
        if tag == "input":
            layer_ids[var_name] = "input"
            return "input"

        if var_name in visiting:
            return None  # cycle guard
        visiting.add(var_name)

        layer = _make_layer_dict(layer_call, f"layer_{len(layers)}", alias_map) if layer_call else None
        if layer is None:
            return None
        layers.append(layer)
        layer_ids[var_name] = layer["id"]
        id_to_var[layer["id"]] = var_name

        for iv in input_vars:
            src_id = visit(iv)
            if src_id is not None:
                connections.append({"from_id": src_id, "to_id": layer["id"], "type": "sequential"})

        return layer["id"]

    final_id = visit(output_var)
    if final_id is None or not layers:
        return None

    connections.append({"from_id": final_id, "to_id": "output", "type": "sequential"})
    layers.sort(key=lambda layer: var_lineno.get(id_to_var.get(layer["id"], ""), 0))

    total_params = sum(layer.get("param_count", 0) or 0 for layer in layers)
    return {
        "name": model_name,
        "file": file_path,
        "line": line,
        "framework": "keras",
        "type": "functional",
        "total_params": total_params if total_params > 0 else None,
        "input_shape": None,
        "output_shape": None,
        "layers": layers,
        "connections": connections,
        "blocks": None,
    }


# ─────────────────────────────────────────────
# Pre-trained / transfer-learning model detection
# ─────────────────────────────────────────────


def _build_pretrained_layer(match: dict, layer_id: str) -> dict:
    """Build a single NNLayer-shaped dict for a pretrained backbone (same
    shape as ``_build_layer``'s return), for use inside a class's layer list."""
    return {
        "id": layer_id,
        "type": match["arch"],
        "category": "pretrained",
        "params": {"weights": match.get("weights")},
        "output_shape": None,
        "param_count": None,
        "activation": None,
        "block_dims": _compute_block_dims(match["arch"], {}, None),
    }


def _build_pretrained_model(match: dict, file_path: str, line: int, model_name: str) -> dict:
    """Build an NNModel-shaped dict for a standalone pretrained-backbone call."""
    layer = _build_pretrained_layer(match, "backbone")
    connections = [
        {"from_id": "input", "to_id": "backbone", "type": "sequential"},
        {"from_id": "backbone", "to_id": "output", "type": "sequential"},
    ]
    return {
        "name": model_name,
        "file": file_path,
        "line": line,
        "framework": match["framework"],
        "type": "pretrained",
        "total_params": None,
        "input_shape": None,
        "output_shape": None,
        "layers": [layer],
        "connections": connections,
        "blocks": None,
    }


# ─────────────────────────────────────────────
# Heuristic catch-all (best-effort "any model" safety net)
# ─────────────────────────────────────────────

_MAX_HEURISTIC_LAYERS = 50


def _is_ml_file(alias_map: dict[str, str] | None) -> bool:
    """Whether the file's imports reference a known ML framework root."""
    if not alias_map:
        return False
    return any(origin.split(".")[0] in _ML_FRAMEWORK_ROOTS for origin in alias_map.values())


def _iter_heuristic_scopes(tree: ast.Module) -> list[tuple[str, list[ast.stmt], int, int]]:
    """Yield ``(name, body_statements, start_line, end_line)`` for module scope
    and each top-level function — the scopes the heuristic pass scans."""
    scopes: list[tuple[str, list[ast.stmt], int, int]] = []

    module_stmts = [s for s in tree.body if not isinstance(s, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef)]
    if module_stmts:
        start = min(s.lineno for s in module_stmts)
        end = max(getattr(s, "end_lineno", s.lineno) for s in module_stmts)
        scopes.append(("module", module_stmts, start, end))

    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            end = getattr(node, "end_lineno", node.lineno)
            scopes.append((node.name, node.body, node.lineno, end))

    return scopes


def _extract_heuristic_models(
    tree: ast.Module,
    file_path: str,
    alias_map: dict[str, str] | None,
    claimed_lines: set[int],
) -> list[dict]:
    """Best-effort fallback: emit one model per ML-file scope that has >= 2
    recognized layer-constructor calls but matched none of the structured
    passes. Labeled ``type="heuristic"`` / ``sequential-unverified`` since the
    execution order is declaration order, not a traced graph."""
    models: list[dict] = []

    for name, stmts, start, end in _iter_heuristic_scopes(tree):
        if any(start <= claimed <= end for claimed in claimed_lines):
            continue  # scope already covered by a structured model

        calls: list[ast.Call] = []
        for stmt in stmts:
            calls.extend(n for n in ast.walk(stmt) if isinstance(n, ast.Call))
        calls.sort(key=lambda c: c.lineno)

        layers: list[dict] = []
        for call in calls:
            if _recognize_layer_type(call, alias_map) is None:
                continue
            layer = _make_layer_dict(call, f"layer_{len(layers)}", alias_map)
            if layer is not None:
                layers.append(layer)
            if len(layers) >= _MAX_HEURISTIC_LAYERS:
                break

        if len(layers) < 2:
            continue

        stem = file_path.rsplit("/", 1)[-1]
        stem = stem.rsplit(".", 1)[0] if "." in stem else stem
        total_params = sum(layer.get("param_count", 0) or 0 for layer in layers)
        models.append(
            {
                "name": name if name != "module" else stem,
                "file": file_path,
                "line": start,
                "framework": "unknown",
                "type": "heuristic",
                "total_params": total_params if total_params > 0 else None,
                "input_shape": None,
                "output_shape": None,
                "layers": layers,
                "connections": _sequential_connections(layers, unverified=True),
                "blocks": None,
            }
        )

    return models


# ─────────────────────────────────────────────
# Main extraction entry point
# ─────────────────────────────────────────────


def extract_models_from_source(
    source_code: str,
    file_path: str,
) -> list[dict]:
    """Extract all neural network model definitions from a Python source file.

    Returns a list of NNModel-compatible dicts.
    """
    models: list[dict] = []

    try:
        tree = ast.parse(source_code)
    except SyntaxError:
        logger.debug(f"Failed to parse {file_path} — skipping NN extraction")
        return models

    # Resolve import aliases so aliased bases/layers (`import torch.nn as N`,
    # `from torch.nn import Module`) are recognized structurally.
    alias_map = _build_import_alias_map(tree)

    class_defs = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]

    # Precompute each class's base info: (resolved dotted base, simple last name).
    class_bases: dict[str, list[tuple[str | None, str | None]]] = {}
    for cd in class_defs:
        bases: list[tuple[str | None, str | None]] = []
        for base in cd.bases:
            dotted = _base_dotted_name(base)
            resolved = _resolve_with_alias(dotted, alias_map)
            simple = dotted.split(".")[-1] if dotted else None
            bases.append((resolved, simple))
        class_bases[cd.name] = bases

    # 1. Determine model classes: those subclassing a known NN base directly, or
    # (transitively) a local class that does. Fixpoint handles forward/late refs.
    local_model_fw: dict[str, str] = {}
    changed = True
    while changed:
        changed = False
        for cd in class_defs:
            if cd.name in local_model_fw:
                continue
            for resolved, simple in class_bases[cd.name]:
                fw = _known_base_framework(resolved)
                if fw is None and simple in local_model_fw:
                    fw = local_model_fw[simple]
                if fw is not None:
                    local_model_fw[cd.name] = fw
                    changed = True
                    break

    extracted_classes: list[ast.ClassDef] = []
    for cd in class_defs:
        fw = local_model_fw.get(cd.name)
        if fw is None:
            continue
        model = _extract_module_class(cd, file_path, framework=fw, alias_map=alias_map)
        if model and len(model["layers"]) >= 1:  # relaxed floor — small models are valid
            models.append(model)
            extracted_classes.append(cd)

    # `self.x = nn.Sequential(...)` inside an extracted class is already folded
    # into that class's layers by _collect_layers_from_value, so emitting it
    # again below would report a submodule as a sibling model — a two-model file
    # would list four. Only assignments inside classes that actually produced a
    # model are claimed; if class extraction bailed (no __init__, no layers),
    # the standalone pass is the only chance to capture them.
    claimed_assigns: set[int] = {
        id(sub) for cd in extracted_classes for sub in ast.walk(cd) if isinstance(sub, ast.Assign)
    }

    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)):
            continue

        call_name = _get_call_name(node.value)

        # 2. Sequential(...) assignments — positional args, list-form, and
        # OrderedDict/dict-of-layers (Change 2). Empty-arg Sequential() is left
        # for the imperative .add() pass below (mutually exclusive, no double emit).
        if call_name and any(call_name.endswith(s) for s in ("Sequential", "nn.Sequential", "keras.Sequential")):
            model_name = "SequentialModel"
            if node.targets and isinstance(node.targets[0], ast.Name):
                model_name = node.targets[0].id
            elif (
                node.targets
                and isinstance(node.targets[0], ast.Attribute)
                and isinstance(node.targets[0].value, ast.Name)
                and node.targets[0].value.id == "self"
            ):
                if id(node) in claimed_assigns:
                    continue  # already a submodule of an extracted class model
                model_name = node.targets[0].attr

            resolved = _resolve_with_alias(call_name, alias_map) or call_name
            framework = "keras" if "keras" in resolved else "pytorch"
            model = _extract_sequential(
                node.value, file_path, node.lineno, model_name, alias_map=alias_map, framework=framework
            )
            if model and len(model["layers"]) >= 1:
                models.append(model)
            continue

        # 3. Standalone pretrained-model factory assignments, e.g.
        # `model = torchvision.models.resnet50(weights=...)`. Backbones nested
        # inside a model class's __init__ (`self.backbone = resnet50(...)`) are
        # already captured via _collect_layers_from_value during class
        # extraction above, so only plain-variable targets are handled here to
        # avoid emitting the same call twice.
        if node.targets and isinstance(node.targets[0], ast.Name):
            match = _match_pretrained_call(node.value, alias_map)
            if match is not None:
                models.append(_build_pretrained_model(match, file_path, node.lineno, node.targets[0].id))

    # 4. Imperative `model.add(...)` Sequential chains (Change 3).
    models.extend(_extract_imperative_sequential(tree, file_path, alias_map))

    # 5. Keras functional API (Change 4).
    models.extend(_extract_functional(tree, file_path, alias_map))

    # 6. Conservative heuristic catch-all — only for ML files where nothing
    # structured matched, and only for scopes not already claimed (Change 6).
    if not models and _is_ml_file(alias_map):
        models.extend(_extract_heuristic_models(tree, file_path, alias_map, claimed_lines=set()))
    elif models:
        claimed_lines = {m["line"] for m in models if m.get("line") is not None}
        if _is_ml_file(alias_map):
            models.extend(_extract_heuristic_models(tree, file_path, alias_map, claimed_lines))

    # Order matters: widths first, because they fill in the channel counts that
    # the spatial pass then uses for block thickness.
    for model in models:
        _propagate_feature_widths(model)
        _propagate_spatial_shapes(model)

    return models


# Notebook magic/shell lines (`!pip install ...`, `%matplotlib inline`,
# `%%time`) that break `ast.parse` when a notebook is concatenated into one
# source string.
_NOTEBOOK_MAGIC_LINE_RE = re.compile(r"^\s*[!%]")


def extract_models_from_notebook(
    notebook_json: dict,
    file_path: str,
) -> list[dict]:
    """Extract NN models from a Jupyter notebook's code cells.

    Code cells are concatenated into a single source and parsed once, so
    imports, base classes, and helpers defined in one cell are visible to
    definitions in later cells (notebooks share one logical namespace across
    cells). Magic/shell lines are blanked first since they're the usual
    ``SyntaxError`` cause. Falls back to per-cell parsing if the concatenated
    source yields nothing, so one cell an editor can't fix doesn't zero out an
    otherwise salvageable notebook.
    """
    cells = notebook_json.get("cells", [])
    code_sources: list[str] = []
    for cell in cells:
        if cell.get("cell_type") != "code":
            continue
        source_lines = cell.get("source", [])
        if isinstance(source_lines, list):
            source = "".join(source_lines)
        else:
            source = str(source_lines)
        cleaned = "\n".join("" if _NOTEBOOK_MAGIC_LINE_RE.match(line) else line for line in source.splitlines())
        code_sources.append(cleaned)

    models = extract_models_from_source("\n".join(code_sources), file_path)
    if models:
        return models

    for source in code_sources:
        models.extend(extract_models_from_source(source, file_path))

    return models


def select_nn_candidates(file_profiles: list, dep_data: Any) -> list[dict]:
    """Select files to run NN extraction on, decoupled from the classifier role.

    A Python/notebook file is a candidate if EITHER:
      - its parsed imports (``dep_data.file_imports``) reference an ML framework
        root (matched on the first dotted segment, so ``torch.nn.functional`` ->
        ``torch``) — immune to the classifier's 4KB window and import aliasing, OR
      - its FileProfile role is ml_model/ml_training/ml_pipeline (safety net for
        files the import graph missed).

    Returns ``list[dict]`` (via ``model_dump()``) so ``extract_all_models`` still
    receives the ``{"path": ...}`` shape it expects.
    """
    # dep_data is a DepGraph (pydantic) or a plain dict on the degraded path.
    file_imports = getattr(dep_data, "file_imports", None)
    if file_imports is None and isinstance(dep_data, dict):
        file_imports = dep_data.get("file_imports")
    file_imports = file_imports or {}

    candidates: list[dict] = []
    for fp in file_profiles:
        path = getattr(fp, "path", None) if not isinstance(fp, dict) else fp.get("path")
        if not path or not (path.endswith(".py") or path.endswith(".ipynb")):
            continue

        role = getattr(fp, "role", None) if not isinstance(fp, dict) else fp.get("role")
        matched = role in _NN_CANDIDATE_ROLES
        if not matched:
            for imp in file_imports.get(path, []):
                raw = imp.get("raw", "") if isinstance(imp, dict) else ""
                root = raw.lstrip(".").split(".")[0] if raw else ""
                if root in _ML_FRAMEWORK_ROOTS:
                    matched = True
                    break

        if matched:
            candidates.append(fp.model_dump() if hasattr(fp, "model_dump") else dict(fp))

    logger.info(f"Selected {len(candidates)} NN candidate file(s) from {len(file_profiles)} profile(s)")
    return candidates


def _dedupe_models(models: list[dict]) -> list[dict]:
    """Drop models that repeat one already seen in another file.

    Notebooks get saved as revisions — `final-code-v1.ipynb`, `final-code-v2`,
    `final_code` — and each copy re-declares the same architecture, so one model
    is reported three times and the chart offers three identical figures.

    Keyed on name AND layer signature, and only across files. Two same-named
    models with different layers are genuinely different and both survive; two
    differently-named models in one file are left alone, because within a single
    file distinct names usually mean distinct models.
    """
    seen: dict[tuple, str] = {}
    kept: list[dict] = []

    for model in models:
        signature = (
            model.get("name"),
            tuple(_layer_signature(layer) for layer in model.get("layers") or []),
        )
        origin = seen.get(signature)
        if origin is not None and origin != model.get("file"):
            continue
        if origin is None:
            seen[signature] = model.get("file") or ""
        kept.append(model)

    dropped = len(models) - len(kept)
    if dropped:
        logger.info(f"Dropped {dropped} duplicate NN model(s) repeated across files")
    return kept


async def extract_all_models(
    ml_model_files: list[dict],
    content_cache: dict[str, str] | BoundedContentCache | None = None,
    repo_root: str = "",
) -> list[dict]:
    """Extract NN models from all ML model files.

    Args:
        ml_model_files: File profiles with role='ml_model' from classifier.
        content_cache: Cached file contents.
        repo_root: Root path of the cloned repo.

    Returns:
        List of NNModel-compatible dicts.
    """
    import json as json_mod
    import os

    all_models: list[dict] = []

    for file_info in ml_model_files:
        rel_path = file_info.get("path", "")
        abs_path = os.path.join(repo_root, rel_path) if repo_root else rel_path

        # Get file content
        content = None
        if content_cache and rel_path in content_cache:
            content = content_cache[rel_path]
        else:
            try:
                with open(abs_path, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except OSError:
                logger.warning(f"Cannot read {rel_path} for NN extraction")
                continue

        if not content:
            continue

        # Handle notebooks
        if rel_path.endswith(".ipynb"):
            try:
                nb_json = json_mod.loads(content)
                models = extract_models_from_notebook(nb_json, rel_path)
            except (json_mod.JSONDecodeError, KeyError):
                logger.warning(f"Failed to parse notebook {rel_path}")
                continue
        else:
            models = extract_models_from_source(content, rel_path)

        all_models.extend(models)

    all_models = _dedupe_models(all_models)

    # Collapse repeated blocks (a 12-layer encoder stack, 2 BasicBlocks per
    # ResNet stage). Runs here rather than at request time so the visualize
    # endpoint stays zero-cost and serves straight from the analysis cache.
    for model in all_models:
        model["repeats"] = detect_repeats(model.get("layers") or [])

    logger.info(f"Extracted {len(all_models)} NN model(s) from {len(ml_model_files)} ML file(s)")
    return all_models

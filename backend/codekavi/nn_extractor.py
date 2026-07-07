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
import logging
import math
from typing import Any

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
    # Dropout
    "Dropout": "dropout",
    "Dropout2d": "dropout",
    "Dropout3d": "dropout",
    "AlphaDropout": "dropout",
    # Recurrent
    "LSTM": "recurrent",
    "GRU": "recurrent",
    "RNN": "recurrent",
    "LSTMCell": "recurrent",
    "GRUCell": "recurrent",
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
    # Keras-specific
    "Input": "other",
    "Concatenate": "other",
    "Add": "other",
}

# PyTorch nn module names for matching
_NN_MODULES = {"nn.Module", "torch.nn.Module"}
_KERAS_MODELS = {"keras.Model", "tf.keras.Model", "keras.models.Model"}


# ─────────────────────────────────────────────
# Block dimension computation
# ─────────────────────────────────────────────


def _compute_block_dims(
    layer_type: str,
    params: dict[str, Any],
    output_shape: list[int] | None,
) -> dict:
    """Compute PlotNeuralNet-style 3D block dimensions.

    - height/depth: proportional to spatial dimensions (log-scaled)
    - width: proportional to channel/feature count (log-scaled)
    """
    MIN_DIM, MAX_DIM = 8.0, 80.0
    MIN_WIDTH, MAX_WIDTH = 1.5, 25.0

    def _log_scale(val: Any, lo: float, hi: float) -> float:
        if not isinstance(val, (int, float)):
            return lo
        if val <= 0:
            return lo
        scaled = lo + (hi - lo) * (math.log2(val + 1) / math.log2(1024))
        return max(lo, min(hi, scaled))

    height = 20.0
    depth = 20.0
    width = 2.0

    if output_shape:
        if len(output_shape) >= 3:  # [C, H, W]
            height = _log_scale(output_shape[-2], MIN_DIM, MAX_DIM)
            depth = _log_scale(output_shape[-1], MIN_DIM, MAX_DIM)
            width = _log_scale(output_shape[0], MIN_WIDTH, MAX_WIDTH)
        elif len(output_shape) == 2:  # [C, L] (1D)
            height = _log_scale(output_shape[-1], MIN_DIM, MAX_DIM)
            depth = 10.0
            width = _log_scale(output_shape[0], MIN_WIDTH, MAX_WIDTH)
        elif len(output_shape) == 1:  # [features]
            height = _log_scale(output_shape[0], MIN_DIM, MAX_DIM)
            depth = 10.0
            width = 3.0

    # Fallback from params
    elif "out_channels" in params:
        width = _log_scale(params["out_channels"], MIN_WIDTH, MAX_WIDTH)
    elif "out_features" in params:
        height = _log_scale(params["out_features"], MIN_DIM, MAX_DIM)
        depth = 10.0
        width = 3.0

    return {"height": round(height, 1), "depth": round(depth, 1), "width": round(width, 1)}


# ─────────────────────────────────────────────
# AST Helpers
# ─────────────────────────────────────────────


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
        current = func
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


def _is_nn_layer_call(call_name: str) -> bool:
    """Check if a call name looks like a neural network layer constructor."""
    layer_prefixes = ["nn.", "torch.nn.", "layers.", "keras.layers.", "tf.keras.layers."]
    return any(call_name.startswith(p) for p in layer_prefixes)


def _normalize_params(layer_type: str, params: dict) -> dict:
    """Normalize positional params to named params based on layer type."""
    normalized = {k: v for k, v in params.items() if not k.startswith("_pos_")}

    # PyTorch Conv2d: (in_channels, out_channels, kernel_size, ...)
    if layer_type in ("Conv1d", "Conv2d", "Conv3d", "ConvTranspose1d", "ConvTranspose2d", "ConvTranspose3d"):
        pos_map = ["in_channels", "out_channels", "kernel_size", "stride", "padding"]
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

    return normalized


def _estimate_param_count(layer_type: str, params: dict) -> int | None:
    """Rough parameter count estimation for common layer types."""
    try:
        if layer_type in ("Conv2d", "Conv1d", "Conv3d"):
            ic = params.get("in_channels", 0)
            oc = params.get("out_channels", 0)
            ks = params.get("kernel_size", 3)
            ks = ks if isinstance(ks, int) else (ks[0] * ks[1] if len(ks) >= 2 else ks[0])
            bias = 1 if params.get("bias", True) else 0
            if ic and oc:
                if layer_type == "Conv1d":
                    return int(ic * oc * ks + oc * bias)
                elif layer_type == "Conv2d":
                    k2 = ks * ks if isinstance(ks, int) else ks
                    return int(ic * oc * k2 + oc * bias)
                elif layer_type == "Conv3d":
                    k3 = ks**3 if isinstance(ks, int) else ks
                    return int(ic * oc * k3 + oc * bias)
        elif layer_type in ("Linear", "Dense"):
            inf = params.get("in_features", params.get("units", 0))
            outf = params.get("out_features", params.get("units", 0))
            if inf and outf:
                return int(inf * outf + outf)
        elif layer_type in ("BatchNorm1d", "BatchNorm2d", "BatchNorm3d"):
            nf = params.get("num_features", 0)
            if nf:
                return int(nf * 2)  # gamma + beta
        elif layer_type in ("Embedding", "EmbeddingBag"):
            ne = params.get("num_embeddings", 0)
            ed = params.get("embedding_dim", 0)
            if ne and ed:
                return int(ne * ed)
        elif layer_type in ("LSTM", "GRU"):
            inp = params.get("input_size", 0)
            hid = params.get("hidden_size", 0)
            nl = params.get("num_layers", 1)
            if inp and hid:
                gates = 4 if layer_type == "LSTM" else 3
                return int(nl * gates * (inp * hid + hid * hid + hid))
        elif layer_type == "LayerNorm":
            ns = params.get("normalized_shape", 0)
            if isinstance(ns, (list, tuple)):
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


def _extract_module_class(
    class_node: ast.ClassDef,
    file_path: str,
    framework: str = "pytorch",
) -> dict | None:
    """Extract a neural network architecture from an nn.Module or Keras Model subclass."""
    layers: list[dict] = []
    layer_order: list[str] = []
    connections: list[dict] = []

    # 1. Parse __init__ — find self.xxx = nn.YYY(...) assignments
    init_method = None
    forward_method = None
    for item in class_node.body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
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

    # Walk __init__ for layer assignments
    for node in ast.walk(init_method):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == "self"
                    and isinstance(node.value, ast.Call)
                ):
                    call_name = _get_call_name(node.value)
                    if call_name and _is_nn_layer_call(call_name):
                        layer_type = _resolve_layer_type(call_name)
                        raw_params = _extract_call_params(node.value)
                        params = _normalize_params(layer_type, raw_params)
                        category = _LAYER_CATEGORIES.get(layer_type, "other")
                        param_count = _estimate_param_count(layer_type, params)
                        block_dims = _compute_block_dims(layer_type, params, None)

                        layer_id = target.attr
                        layers.append(
                            {
                                "id": layer_id,
                                "type": layer_type,
                                "category": category,
                                "params": params,
                                "output_shape": None,
                                "param_count": param_count,
                                "activation": None,
                                "block_dims": block_dims,
                            }
                        )
                        layer_order.append(layer_id)

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

    total_params = sum(l.get("param_count", 0) or 0 for l in layers)

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
    forward_node: ast.FunctionDef,
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
            if isinstance(target, ast.Name):
                # Check if RHS is self.layer(x)
                if isinstance(node.value, ast.Call):
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
) -> dict | None:
    """Extract layers from nn.Sequential(...) definitions."""
    layers: list[dict] = []
    connections: list[dict] = []

    for i, arg in enumerate(call_node.args):
        if isinstance(arg, ast.Call):
            call_name = _get_call_name(arg)
            if call_name:
                layer_type = _resolve_layer_type(call_name)
                raw_params = _extract_call_params(arg)
                params = _normalize_params(layer_type, raw_params)
                category = _LAYER_CATEGORIES.get(layer_type, "other")
                param_count = _estimate_param_count(layer_type, params)
                block_dims = _compute_block_dims(layer_type, params, None)

                layer_id = f"layer_{i}"
                layers.append(
                    {
                        "id": layer_id,
                        "type": layer_type,
                        "category": category,
                        "params": params,
                        "output_shape": None,
                        "param_count": param_count,
                        "activation": None,
                        "block_dims": block_dims,
                    }
                )

    if not layers:
        return None

    # Sequential = linear chain
    for i in range(len(layers)):
        from_id = "input" if i == 0 else layers[i - 1]["id"]
        connections.append({"from_id": from_id, "to_id": layers[i]["id"], "type": "sequential"})
    connections.append({"from_id": layers[-1]["id"], "to_id": "output", "type": "sequential"})

    total_params = sum(l.get("param_count", 0) or 0 for l in layers)

    return {
        "name": model_name,
        "file": file_path,
        "line": line,
        "framework": "pytorch",
        "type": "sequential",
        "total_params": total_params if total_params > 0 else None,
        "input_shape": None,
        "output_shape": None,
        "layers": layers,
        "connections": connections,
        "blocks": None,
    }


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

    for node in ast.walk(tree):
        # 1. nn.Module subclasses
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                base_name = None
                if isinstance(base, ast.Attribute):
                    base_name = f"{_ast_to_value(base.value)}.{base.attr}" if isinstance(base.value, ast.Name) else None
                elif isinstance(base, ast.Name):
                    base_name = base.id

                if base_name and (base_name in _NN_MODULES or base_name in _KERAS_MODELS or base_name == "Module"):
                    framework = "keras" if base_name in _KERAS_MODELS else "pytorch"
                    model = _extract_module_class(node, file_path, framework=framework)
                    if model and len(model["layers"]) >= 2:  # Minimum 2 layers to be meaningful
                        models.append(model)
                    break

        # 2. nn.Sequential(...) assignments
        if isinstance(node, ast.Assign):
            if isinstance(node.value, ast.Call):
                call_name = _get_call_name(node.value)
                if call_name and any(
                    call_name.endswith(s) for s in ("Sequential", "nn.Sequential", "keras.Sequential")
                ):
                    # Get model name from assignment target
                    model_name = "SequentialModel"
                    if node.targets and isinstance(node.targets[0], ast.Name):
                        model_name = node.targets[0].id
                    elif (
                        node.targets
                        and isinstance(node.targets[0], ast.Attribute)
                        and isinstance(node.targets[0].value, ast.Name)
                        and node.targets[0].value.id == "self"
                    ):
                        model_name = node.targets[0].attr

                    model = _extract_sequential(node.value, file_path, node.lineno, model_name)
                    if model and len(model["layers"]) >= 2:
                        models.append(model)

    return models


def extract_models_from_notebook(
    notebook_json: dict,
    file_path: str,
) -> list[dict]:
    """Extract NN models from a Jupyter notebook's code cells."""
    models: list[dict] = []

    cells = notebook_json.get("cells", [])
    for cell in cells:
        if cell.get("cell_type") != "code":
            continue
        source_lines = cell.get("source", [])
        if isinstance(source_lines, list):
            source = "".join(source_lines)
        else:
            source = str(source_lines)

        cell_models = extract_models_from_source(source, file_path)
        models.extend(cell_models)

    return models


async def extract_all_models(
    ml_model_files: list[dict],
    content_cache: dict[str, str] | None = None,
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

    logger.info(f"Extracted {len(all_models)} NN model(s) from {len(ml_model_files)} ML file(s)")
    return all_models

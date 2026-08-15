"""
Tests for model-boundary decisions in the neural network extractor.

The visualization renders one figure per extracted model, so a submodule
reported as a sibling model shows the researcher a model they never wrote.
These pin down which assignments count as their own model and which are already
folded into an enclosing class.
"""

from codekavi.nn_extractor import _dedupe_models, extract_models_from_source


def _model(name: str, file: str, types: list[str]) -> dict:
    return {
        "name": name,
        "file": file,
        "layers": [{"id": f"l{i}", "type": t, "category": "dense", "params": {}} for i, t in enumerate(types)],
    }


def test_dedupe_drops_the_same_model_re_saved_in_another_file():
    """final-code-v1 / v2 / final_code are one architecture, not three."""
    models = [
        _model("lstm_model", "nb/v1.ipynb", ["Embedding", "LSTM", "Dense"]),
        _model("lstm_model", "nb/v2.ipynb", ["Embedding", "LSTM", "Dense"]),
        _model("lstm_model", "nb/final.ipynb", ["Embedding", "LSTM", "Dense"]),
    ]
    kept = _dedupe_models(models)
    assert [m["file"] for m in kept] == ["nb/v1.ipynb"]


def test_dedupe_keeps_same_name_with_different_layers():
    models = [
        _model("model", "a.py", ["Conv2d", "ReLU"]),
        _model("model", "b.py", ["LSTM", "Dense"]),
    ]
    assert len(_dedupe_models(models)) == 2


def test_dedupe_leaves_two_identical_models_in_one_file_alone():
    """Within a file, distinct names usually mean distinct models."""
    models = [
        _model("encoder", "net.py", ["MultiheadAttention", "LayerNorm"]),
        _model("encoder", "net.py", ["MultiheadAttention", "LayerNorm"]),
    ]
    assert len(_dedupe_models(models)) == 2


def test_dedupe_keeps_different_names_with_identical_layers():
    models = [
        _model("encoder", "a.py", ["MultiheadAttention", "LayerNorm"]),
        _model("decoder", "b.py", ["MultiheadAttention", "LayerNorm"]),
    ]
    assert len(_dedupe_models(models)) == 2


def _names(source: str) -> list[str]:
    return sorted(m["name"] for m in extract_models_from_source(source, "models/net.py"))


def test_sequential_submodule_is_not_a_sibling_model():
    """`self.body = nn.Sequential(...)` is already folded into the class."""
    source = """
import torch.nn as nn

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.stem = nn.Conv2d(3, 64, 7)
        self.body = nn.Sequential(nn.Conv2d(64, 64, 3), nn.ReLU())
"""
    assert _names(source) == ["Net"]


def test_submodule_layers_are_still_present_on_the_parent():
    """Suppressing the sibling model must not lose the layers it held."""
    source = """
import torch.nn as nn

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.body = nn.Sequential(nn.Conv2d(64, 64, 3), nn.BatchNorm2d(64), nn.ReLU())
"""
    (model,) = extract_models_from_source(source, "models/net.py")
    assert [layer["type"] for layer in model["layers"]] == ["Conv2d", "BatchNorm2d", "ReLU"]


def test_module_level_sequential_is_still_its_own_model():
    source = """
import torch.nn as nn

classifier = nn.Sequential(nn.Linear(512, 256), nn.ReLU(), nn.Linear(256, 10))
"""
    assert _names(source) == ["classifier"]


def test_sequential_in_a_non_model_class_is_still_its_own_model():
    """A plain builder class is not an nn.Module, so nothing absorbed its layers."""
    source = """
import torch.nn as nn

class Builder:
    def __init__(self):
        self.net = nn.Sequential(nn.Linear(512, 256), nn.ReLU())
"""
    assert _names(source) == ["net"]


def test_sequential_survives_when_class_extraction_bails():
    """No __init__ means _extract_module_class returns None, so the standalone
    pass is the only chance to capture these layers."""
    source = """
import torch.nn as nn

class Headless(nn.Module):
    body = nn.Sequential(nn.Linear(512, 256), nn.ReLU())
"""
    assert _names(source) == ["body"]


def test_two_classes_each_with_a_submodule_yield_two_models():
    source = """
import torch.nn as nn

class Encoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.blocks = nn.Sequential(nn.MultiheadAttention(768, 12), nn.LayerNorm(768))

class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.blocks = nn.Sequential(nn.MultiheadAttention(768, 12), nn.LayerNorm(768))
"""
    assert _names(source) == ["Decoder", "Encoder"]


def _param_count(layer_expr: str) -> int | None:
    source = f"import torch.nn as nn\nm = nn.Sequential({layer_expr})\n"
    (model,) = extract_models_from_source(source, "models/net.py")
    return model["layers"][0]["param_count"]


def test_tuple_kernel_size_is_not_squared_twice():
    """`(3, 3)` was multiplied out to 9 and then squared again to 81."""
    assert _param_count("nn.Conv2d(64, 64, kernel_size=3)") == 64 * 64 * 9 + 64
    assert _param_count("nn.Conv2d(64, 64, kernel_size=(3, 3))") == 64 * 64 * 9 + 64


def test_conv3d_tuple_kernel_uses_all_three_axes():
    assert _param_count("nn.Conv3d(16, 16, kernel_size=(3, 3, 3))") == 16 * 16 * 27 + 16


def test_anisotropic_kernel_multiplies_its_axes():
    assert _param_count("nn.Conv2d(64, 64, kernel_size=(3, 5))") == 64 * 64 * 15 + 64


def test_grouped_convolution_divides_by_groups():
    """Depthwise convs are a fraction of the dense cost."""
    assert _param_count("nn.Conv2d(64, 64, 3, groups=64)") == 64 * 64 * 9 // 64 + 64


def test_conv_transpose_is_counted():
    assert _param_count("nn.ConvTranspose2d(64, 32, 4)") == 64 * 32 * 16 + 32


def test_multihead_attention_is_counted():
    """A transformer's largest component previously counted as zero."""
    assert _param_count("nn.MultiheadAttention(768, 12)") == 4 * 768 * 768 + 4 * 768


def test_bias_false_drops_the_bias_term():
    assert _param_count("nn.Conv2d(64, 64, 3, bias=False)") == 64 * 64 * 9


def test_unresolvable_kernel_size_yields_no_estimate():
    """Params come from AST literals; a name reference is not a number."""
    source = "import torch.nn as nn\nK = 3\nm = nn.Sequential(nn.Conv2d(64, 64, kernel_size=K))\n"
    (model,) = extract_models_from_source(source, "models/net.py")
    assert model["layers"][0]["param_count"] is None


def test_bidirectional_recurrent_doubles():
    plain = _param_count("nn.LSTM(128, 256)")
    assert plain is not None
    assert _param_count("nn.LSTM(128, 256, bidirectional=True)") == plain * 2


KERAS_HEAD = """
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Embedding, LSTM, Dense, Dropout, Bidirectional
"""


def test_tokenizers_are_not_models():
    """`.from_pretrained` also loads tokenizers, which have no layers at all."""
    source = """
from transformers import RobertaTokenizer, RobertaForSequenceClassification
tok = RobertaTokenizer.from_pretrained("roberta-base")
net = RobertaForSequenceClassification.from_pretrained("roberta-base")
"""
    assert _names(source) == ["net"]


def test_processors_and_configs_are_not_models():
    source = """
from transformers import AutoProcessor, AutoConfig, AutoTokenizer, AutoModel
a = AutoProcessor.from_pretrained("x")
b = AutoConfig.from_pretrained("x")
c = AutoTokenizer.from_pretrained("x")
d = AutoModel.from_pretrained("x")
"""
    assert _names(source) == ["d"]


def test_dense_input_width_comes_from_the_previous_layer():
    """`Dense(6)` after a 64-wide layer is 390 params, not 6*6+6."""
    source = (
        KERAS_HEAD
        + """
m = Sequential([Dense(64), Dense(6)])
"""
    )
    (model,) = extract_models_from_source(source, "models/net.py")
    counts = [layer["param_count"] for layer in model["layers"]]
    assert counts == [None, 64 * 6 + 6]


def test_dense_with_unknown_input_declines_to_estimate():
    """The first Dense has nothing before it, so its input width is unknown."""
    source = KERAS_HEAD + "m = Sequential([Dense(64)])\n"
    (model,) = extract_models_from_source(source, "models/net.py")
    assert model["layers"][0]["param_count"] is None
    assert model["total_params"] is None


def test_width_propagates_through_shape_preserving_layers():
    source = (
        KERAS_HEAD
        + """
m = Sequential([Dense(64), Dropout(0.5), Dense(6)])
"""
    )
    (model,) = extract_models_from_source(source, "models/net.py")
    assert model["layers"][2]["param_count"] == 64 * 6 + 6


def test_width_stops_at_a_layer_with_unresolvable_arguments():
    """An Embedding built from variables breaks the chain; downstream must not
    invent a width to replace it."""
    source = (
        KERAS_HEAD
        + """
m = Sequential([Embedding(vocab_size, EMBEDDING_DIM), Dense(6)])
"""
    )
    (model,) = extract_models_from_source(source, "models/net.py")
    assert [layer["param_count"] for layer in model["layers"]] == [None, None]


def test_bidirectional_keras_lstm_doubles_the_downstream_width():
    """Bidirectional(LSTM(32)) emits 64, so the next Dense sees 64 inputs."""
    source = (
        KERAS_HEAD
        + """
m = Sequential([Bidirectional(LSTM(32)), Dense(6)])
"""
    )
    (model,) = extract_models_from_source(source, "models/net.py")
    assert model["layers"][1]["param_count"] == 64 * 6 + 6


def test_pytorch_linear_still_uses_its_own_declared_input():
    """Propagation must not overwrite a width the layer already stated."""
    source = "import torch.nn as nn\nm = nn.Sequential(nn.Linear(512, 256), nn.Linear(256, 10))\n"
    (model,) = extract_models_from_source(source, "models/net.py")
    counts = [layer["param_count"] for layer in model["layers"]]
    assert counts == [512 * 256 + 256, 256 * 10 + 10]


def test_keras_layers_get_distinct_block_geometry():
    """All-default dims would draw a Keras model as identical slabs."""
    source = KERAS_HEAD + "m = Sequential([Dense(512), Dense(64), Dense(8)])\n"
    (model,) = extract_models_from_source(source, "models/net.py")
    heights = [layer["block_dims"]["height"] for layer in model["layers"]]
    assert len(set(heights)) == 3, heights
    assert heights == sorted(heights, reverse=True)


TORCH_CNN = """
import torch.nn as nn
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(3, 64, 7, stride=2)
        self.bn1 = nn.BatchNorm2d(64)
        self.pool = nn.MaxPool2d(2)
        self.conv2 = nn.Conv2d(64, 128, 3, stride=2)
        self.gap = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(128, 10)
"""


def _by_id(source: str) -> dict[str, dict]:
    (model,) = [m for m in extract_models_from_source(source, "m.py") if m["name"] == "Net"]
    return {layer["id"]: layer for layer in model["layers"]}


def test_stride_two_halves_the_feature_map():
    layers = _by_id(TORCH_CNN)
    assert layers["conv1"]["spatial_extent"] == 0.5


def test_shape_preserving_layers_keep_the_extent():
    layers = _by_id(TORCH_CNN)
    assert layers["bn1"]["spatial_extent"] == layers["conv1"]["spatial_extent"]


def test_pool_stride_defaults_to_its_window():
    """A bare MaxPool2d(2) halves the map even with no stride argument."""
    layers = _by_id(TORCH_CNN)
    assert layers["pool"]["spatial_extent"] == 0.25


def test_global_pool_collapses_to_the_floor():
    layers = _by_id(TORCH_CNN)
    assert layers["gap"]["spatial_extent"] < layers["conv2"]["spatial_extent"]


def test_spatial_ends_at_the_classifier():
    layers = _by_id(TORCH_CNN)
    assert layers["fc"]["spatial_extent"] is None


def test_the_face_shrinks_monotonically_through_the_stack():
    """This silhouette is the whole point of the isometric view."""
    layers = _by_id(TORCH_CNN)
    faces = [layers[k]["block_dims"]["height"] for k in ("conv1", "pool", "conv2", "gap")]
    assert faces == sorted(faces, reverse=True), faces
    assert len(set(faces)) == len(faces), faces


def test_thickness_grows_with_channels():
    layers = _by_id(TORCH_CNN)
    assert layers["conv2"]["block_dims"]["width"] > layers["conv1"]["block_dims"]["width"]


def test_the_classifier_head_does_not_tower_over_the_input():
    """A 1000-way fc scaled on the full range out-towered conv1 and inverted
    the silhouette."""
    layers = _by_id(TORCH_CNN)
    assert layers["fc"]["block_dims"]["height"] < layers["conv1"]["block_dims"]["height"]


def test_a_pure_mlp_still_uses_the_full_height_range():
    """The head squeeze must not apply where there was never a feature map."""
    source = "import torch.nn as nn\nm = nn.Sequential(nn.Linear(784, 512), nn.Linear(512, 10))\n"
    (model,) = extract_models_from_source(source, "m.py")
    assert model["layers"][0]["block_dims"]["height"] > 60


def test_activations_inherit_the_face_of_what_they_receive():
    source = "import torch.nn as nn\nm = nn.Sequential(nn.Linear(784, 512), nn.ReLU())\n"
    (model,) = extract_models_from_source(source, "m.py")
    linear, relu = model["layers"]
    assert relu["block_dims"]["height"] == linear["block_dims"]["height"]


def test_keras_conv_and_pool_are_understood():
    """Conv2D(filters, ...) and MaxPooling2D(pool_size) had no positional map,
    so a Keras CNN rendered as identical blocks."""
    source = """
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Conv2D, MaxPooling2D
m = Sequential([Conv2D(32, 3), MaxPooling2D(2), Conv2D(64, 3)])
"""
    (model,) = extract_models_from_source(source, "m.py")
    conv1, pool, conv2 = model["layers"]
    assert conv1["params"]["out_channels"] == 32
    assert pool["spatial_extent"] == 0.5
    assert conv2["block_dims"]["width"] > conv1["block_dims"]["width"]


def test_output_shape_is_never_synthesised():
    """Relative extent must not become a fabricated tensor shape — the edge
    labels a researcher reads off the figure have to be real."""
    (model,) = [m for m in extract_models_from_source(TORCH_CNN, "m.py") if m["name"] == "Net"]
    assert all(layer["output_shape"] is None for layer in model["layers"])


def test_depth_is_a_constant_lip_not_a_data_channel():
    """Depth used to mirror height, which threw ~75px of horizontal shear on an
    early conv and made every block a sheared ribbon instead of a slab."""
    layers = _by_id(TORCH_CNN)
    depths = {layer["block_dims"]["depth"] for layer in layers.values()}
    assert len(depths) == 1, depths


def test_the_tail_of_the_silhouette_never_out_towers_its_neighbour():
    """conv1 > ... > conv2 > fc > gap, monotone the whole way down. A tail that
    rises again reads as a second network starting."""
    layers = _by_id(TORCH_CNN)
    order = ["conv1", "pool", "conv2", "fc", "gap"]
    heights = [layers[k]["block_dims"]["height"] for k in order]
    assert heights == sorted(heights, reverse=True), dict(zip(order, heights, strict=False))


def test_a_late_block_trades_height_for_thickness():
    """The mockup's layer4 is the widest block in the figure, not a speck. With
    thickness capped well under the face range it could only ever shrink."""
    layers = _by_id(TORCH_CNN)
    early, late = layers["conv1"]["block_dims"], layers["conv2"]["block_dims"]
    assert late["height"] < early["height"]
    assert late["width"] > early["width"]


def test_feature_width_is_carried_forward_through_shape_preserving_layers():
    layers = _by_id(TORCH_CNN)
    assert layers["conv1"]["feature_width"] == 64
    assert layers["bn1"]["feature_width"] == 64
    assert layers["pool"]["feature_width"] == 64
    assert layers["conv2"]["feature_width"] == 128
    assert layers["fc"]["feature_width"] == 10


def test_feature_width_is_none_when_the_chain_cannot_be_resolved():
    """It is printed on the arrows, so a guess here is a guess on the page."""
    source = """
import torch.nn as nn
class Net(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        self.embed = nn.Embedding(cfg.vocab, cfg.dim)
        self.act = nn.ReLU()
"""
    layers = _by_id(source)
    assert layers["embed"]["feature_width"] is None
    assert layers["act"]["feature_width"] is None


def test_a_class_and_an_unrelated_module_level_sequential_coexist():
    source = """
import torch.nn as nn

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.body = nn.Sequential(nn.Conv2d(64, 64, 3), nn.ReLU())

head = nn.Sequential(nn.Linear(512, 10))
"""
    assert _names(source) == ["Net", "head"]

"""Label disambiguation for the architecture graph's file chips."""

from codekavi.routes.visualize import _disambiguate_labels, _layer_of


def _labels(*ids: str) -> list[str]:
    nodes = [{"id": i, "label": i.rsplit("/", 1)[-1]} for i in ids]
    _disambiguate_labels(nodes)
    return [n["label"] for n in nodes]


def test_unique_basenames_untouched():
    assert _labels("a/main.py", "b/util.py") == ["main.py", "util.py"]


def test_grows_until_unique():
    # One segment is not enough here — both parents are `x`.
    assert _labels("a/x/__init__.py", "b/x/__init__.py") == [
        "a/x/__init__.py",
        "b/x/__init__.py",
    ]


def test_only_the_clashing_group_grows():
    assert _labels("a/api.py", "b/api.py", "c/solo.py") == [
        "a/api.py",
        "b/api.py",
        "solo.py",
    ]


def test_identical_ids_terminate():
    # Nothing left to grow — must stop rather than loop forever.
    assert _labels("dup.py", "dup.py") == ["dup.py", "dup.py"]


def test_architectural_role_wins_over_path():
    assert _layer_of({"id": "app/utils/helpers.py", "role": "router"}) == "routes"


def test_structural_role_defers_to_path():
    # "leaf" says where the file sits in the import tree, not what it does.
    assert _layer_of({"id": "app/routes/users.py", "role": "leaf"}) == "routes"
    assert _layer_of({"id": "app/config/settings.py", "role": None}) == "config"

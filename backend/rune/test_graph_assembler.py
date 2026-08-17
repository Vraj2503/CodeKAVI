from rune.graph_assembler import _folder_buckets, derive_containers


def test_files_at_common_prefix_are_named_after_that_folder():
    buckets = _folder_buckets(["src/api/a.py", "src/api/b.py", "src/db/c.py"])
    assert set(buckets) == {"api", "db"}


def test_prefix_bucket_falls_back_to_root_when_paths_are_top_level():
    buckets = _folder_buckets(["main.py", "setup.py", "pkg/x.py"])
    assert set(buckets) == {"root", "pkg"}


def test_prefix_bucket_name_does_not_collide_with_a_subdirectory():
    # basename("src/api") == "api", and "src/api/api/" also wants that name.
    buckets = _folder_buckets(["src/api/a.py", "src/api/api/b.py"])
    assert set(buckets) == {"api", "api-files"}
    assert buckets["api-files"] == ["src/api/a.py"]


def test_single_file_buckets_merge_into_standalone():
    paths = ["src/a/1.py", "src/a/2.py", "src/b/1.py", "src/c/1.py"]
    names = {c["name"] for c in derive_containers("utils", paths, {})}
    assert names == {"a", "standalone"}


def test_no_merge_below_suppression_threshold():
    names = {c["name"] for c in derive_containers("utils", ["src/a/1.py", "src/b/1.py"], {})}
    assert names == {"a", "b"}


def test_container_ids_are_stable_across_runs():
    paths = ["src/a/1.py", "src/a/2.py", "src/b/1.py", "src/c/1.py"]
    first = [c["id"] for c in derive_containers("utils", paths, {})]
    second = [c["id"] for c in derive_containers("utils", list(reversed(paths)), {})]
    assert first == second == sorted(first)

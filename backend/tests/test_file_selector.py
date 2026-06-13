"""
test_file_selector.py — Tests for smart file selection.

Phase 0: Smoke tests.
Phase 4: Full coverage (budget, ordering, penalties).
"""



class TestSmartFileSelector:
    """Test the SmartFileSelector class."""

    def test_select_files_returns_list(self, sample_file_list, sample_dep_data, sample_file_profiles):
        """select_files should return a non-empty list."""
        from codekavi.file_selector import SmartFileSelector

        selector = SmartFileSelector()
        selected = selector.select_files(sample_file_list, sample_dep_data, sample_file_profiles)

        assert isinstance(selected, list)
        assert len(selected) > 0

    def test_respects_max_files_limit(self, sample_file_list, sample_dep_data, sample_file_profiles):
        """Selection should not exceed MAX_FILES."""
        from codekavi.file_selector import SmartFileSelector

        selector = SmartFileSelector()
        selected = selector.select_files(sample_file_list, sample_dep_data, sample_file_profiles)

        assert len(selected) <= selector.MAX_FILES

    def test_sorted_by_score(self, sample_file_list, sample_dep_data, sample_file_profiles):
        """Selected files should be sorted by score descending."""
        from codekavi.file_selector import SmartFileSelector

        selector = SmartFileSelector()
        selected = selector.select_files(sample_file_list, sample_dep_data, sample_file_profiles)

        scores = [item["score"] for item in selected]
        assert scores == sorted(scores, reverse=True)

    def test_each_item_has_required_keys(self, sample_file_list, sample_dep_data, sample_file_profiles):
        """Each selected item should have path, score, estimated_tokens."""
        from codekavi.file_selector import SmartFileSelector

        selector = SmartFileSelector()
        selected = selector.select_files(sample_file_list, sample_dep_data, sample_file_profiles)

        for item in selected:
            assert "path" in item
            assert "score" in item
            assert "estimated_tokens" in item

    def test_test_files_penalized(self, sample_file_list, sample_dep_data, sample_file_profiles):
        """Test files should have lower scores than entry points."""
        from codekavi.file_selector import SmartFileSelector

        selector = SmartFileSelector()
        selected = selector.select_files(sample_file_list, sample_dep_data, sample_file_profiles)

        selected_paths = {item["path"] for item in selected}
        selected_by_path = {item["path"]: item for item in selected}

        # If both main.py and test_helpers.py are selected, main.py should score higher
        if "main.py" in selected_paths:
            test_items = [
                item for path, item in selected_by_path.items()
                if "test_" in path
            ]
            main_score = selected_by_path["main.py"]["score"]
            for test_item in test_items:
                assert main_score > test_item["score"], (
                    f"Entry point main.py ({main_score}) should score higher "
                    f"than test file {test_item['path']} ({test_item['score']})"
                )

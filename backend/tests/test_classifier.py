"""
test_classifier.py — Tests for the file role classifier.

Phase 0: Smoke tests to verify tooling works.
Phase 4: Full coverage (all 14 roles, importance ordering).
"""



class TestRoleDetection:
    """Test that specific fixture files get the expected roles."""

    def test_entry_point_detected(self, sample_file_profiles):
        """main.py should be classified as an entry point."""
        profiles_by_path = {p["path"]: p for p in sample_file_profiles}
        main_profile = profiles_by_path.get("main.py")
        assert main_profile is not None, "main.py should be in profiles"
        assert main_profile["role"] == "entry_point", (
            f"main.py should be entry_point, got: {main_profile['role']}"
        )

    def test_config_detected(self, sample_file_profiles):
        """config.py should be classified as config."""
        profiles_by_path = {p["path"]: p for p in sample_file_profiles}
        config_profile = profiles_by_path.get("config.py")
        assert config_profile is not None, "config.py should be in profiles"
        assert config_profile["role"] == "config", (
            f"config.py should be config, got: {config_profile['role']}"
        )

    def test_test_file_detected(self, sample_file_profiles):
        """tests/test_helpers.py should be classified as test."""
        profiles_by_path = {p["path"]: p for p in sample_file_profiles}
        # Find any path containing test_helpers
        test_profiles = [
            p for path, p in profiles_by_path.items()
            if "test_helpers" in path
        ]
        assert len(test_profiles) > 0, "test_helpers.py should be in profiles"
        assert test_profiles[0]["role"] == "test", (
            f"test_helpers.py should be test, got: {test_profiles[0]['role']}"
        )

    def test_documentation_detected(self, sample_file_profiles):
        """README.md should be classified as documentation."""
        profiles_by_path = {p["path"]: p for p in sample_file_profiles}
        readme = profiles_by_path.get("README.md")
        assert readme is not None, "README.md should be in profiles"
        assert readme["role"] == "documentation", (
            f"README.md should be documentation, got: {readme['role']}"
        )


class TestImportanceOrdering:
    """Test that profiles are sorted by importance."""

    def test_profiles_sorted_by_importance(self, sample_file_profiles):
        """File profiles should be sorted by importance_score descending."""
        scores = [p["importance_score"] for p in sample_file_profiles]
        assert scores == sorted(scores, reverse=True), (
            "Profiles should be sorted by importance_score descending"
        )

    def test_entry_point_high_importance(self, sample_file_profiles):
        """Entry points should have high importance scores."""
        for p in sample_file_profiles:
            if p["role"] == "entry_point":
                assert p["importance_score"] >= 10, (
                    f"Entry point {p['path']} should have importance >= 10, "
                    f"got: {p['importance_score']}"
                )


class TestSummarizeRoles:
    """Test the summarize_roles function."""

    def test_role_counts(self, sample_file_profiles):
        """summarize_roles should produce valid counts."""
        from codekavi.classifier import summarize_roles

        summary = summarize_roles(sample_file_profiles)
        assert summary["total_files"] == len(sample_file_profiles)
        assert "role_counts" in summary
        assert "role_distribution" in summary
        # Total of all role counts should equal total files
        total = sum(summary["role_counts"].values())
        assert total == summary["total_files"]

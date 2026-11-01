"""detect_layer: a file's architectural layer, from whole words in its path.

It used to match substrings, so a keyword inside an unrelated word decided the
layer. Chat drops "frontend" chunks for technical questions, so a mislabelled
backend file stopped reaching the answer: asked where the vector collection's
schema is defined, chat never saw vectorstore.py ("store" -> frontend).
"""

import pytest

from rune.config import detect_layer


@pytest.mark.parametrize(
    ("path", "layer"),
    [
        # a keyword inside another word no longer counts
        ("backend/rune/vectorstore.py", "other"),  # vector-store
        ("backend/requirements.txt", "other"),  # req-ui-rements
        ("frontend/components/report/CreateReportModal.tsx", "frontend"),  # repo-rt was "database"
        ("packages/react-client/src/ReactFlightClient.js", "other"),  # cli-ent was "utils"
        ("compiler/src/Validation/ValidateNoCapitalizedCalls.ts", "other"),  # cap-i-talized was "routes"
        ("compiler/crates/react_compiler_lowering/src/hir_builder.rs", "other"),  # b-ui-lder was "frontend"
        ("docs/specs/2026-07-25-graph-and-tour-design.md", "other"),  # spec-s were "tests"
        ("packages/shared/getPrototypeOf.js", "utils"),  # proto-type was "models"
        # camel case and snake case split into words
        ("frontend/components/RepoStatePanel.tsx", "frontend"),
        ("packages/react-client/src/forks/ReactFlightClientConfig.dom-browser.js", "config"),
        ("frontend/hooks/useRepoGraph.ts", "frontend"),
        # UI words don't make server-side code frontend
        ("backend/rune/symbol_store.py", "other"),
        ("services/state_machine.go", "services"),
        # the extension is a word: stylesheets are frontend
        ("frontend/app/globals.src.css", "frontend"),
        ("frontend/tsconfig.json", "config"),
        ("frontend/.env.local", "config"),
        # the usual conventions, singular or plural, still land where they did
        ("backend/rune/routes/chat.py", "routes"),
        ("api/handlers.py", "routes"),
        ("app/models/user.py", "models"),
        ("src/entities/User.java", "models"),
        ("services/billing.py", "services"),
        ("db/migrations/0001_init.sql", "database"),
        ("src/utils/format.ts", "utils"),
        ("config/settings.py", "config"),
        ("src/components/Button.tsx", "frontend"),
        ("README.md", "other"),
        # test code is "tests", whatever else the path says
        ("tests/test_cache.py", "tests"),
        ("frontend/components/__tests__/AnalysisProgress.test.tsx", "tests"),
        ("packages/react-devtools-shared/src/__tests__/store-test.js", "tests"),
    ],
)
def test_a_files_layer_comes_from_whole_words_in_its_path(path, layer):
    assert detect_layer(path) == layer


def test_windows_separators_give_the_same_layer():
    assert detect_layer("backend\\rune\\routes\\chat.py") == detect_layer("backend/rune/routes/chat.py") == "routes"

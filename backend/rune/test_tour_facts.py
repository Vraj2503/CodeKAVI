"""T18/T19: tour steps and graph files say what a file does, not only how many files touch it."""

from rune.graph_assembler import assemble_graph
from rune.tour_generator import assemble_diff_tour, assemble_tour

MAIN, CLONER, CHAT = "app/main.py", "app/cloner.py", "app/routes/chat.py"


def _record() -> dict:
    def profile(path, role, importance, depends_on=(), used_by=()):
        return {
            "path": path,
            "role": role,
            "role_label": role.title(),
            "importance_score": importance,
            "depends_on": list(depends_on),
            "used_by": list(used_by),
            "in_degree": len(used_by),
            "out_degree": len(depends_on),
            "size": 900,
            "language": "Python",
        }

    return {
        "file_profiles": [
            profile(MAIN, "entry_point", 90, depends_on=[CLONER, CHAT]),
            profile(CHAT, "router", 80, depends_on=[CLONER], used_by=[MAIN]),
            profile(CLONER, "core_module", 70, used_by=[MAIN, CHAT]),
        ],
        "dep_data": {
            "edges": [
                {"source": MAIN, "target": CLONER},
                {"source": MAIN, "target": CHAT},
                {"source": CHAT, "target": CLONER},
            ],
            "adjacency": {MAIN: [CLONER, CHAT], CHAT: [CLONER], CLONER: []},
            "reverse_adjacency": {CLONER: [MAIN, CHAT], CHAT: [MAIN], MAIN: []},
        },
    }


def _symbol(name, complexity, line):
    return {"name": name, "kind": "function", "line": line, "end_line": line + 4, "complexity": complexity}


FACTS = {
    CLONER: {
        "purpose": "Clones repositories into a temp folder.",
        "purpose_source": "doc",
        "symbols": [_symbol("parse_repo_url", 2, 30), _symbol("clone_repo", 7, 10), _symbol("cleanup_repo", 1, 50)],
    },
    CHAT: {
        "purpose": "RAG chat over an analyzed repo.",
        "purpose_source": "doc",
        "symbols": [_symbol("chat_repo", 9, 20)],
        "routes": ["POST /chat/{repo_id}", "DELETE /session/{sid}"],
    },
    MAIN: {"purpose": "Routes: GET /health", "purpose_source": "derived", "symbols": [], "routes": ["GET /health"]},
}


class _Reads:
    def __init__(self):
        self.asked: list[list[str]] = []

    def __call__(self, paths):
        self.asked.append(list(paths))
        return {p: FACTS[p] for p in paths if p in FACTS}


def _facts_by_title(tour) -> dict[str, list[str]]:
    return {step["node_ids"][0]: step["facts"] for step in tour["steps"]}


def test_a_step_on_cloner_names_clone_repo_not_just_its_degree():
    tour = assemble_tour(assemble_graph(_record()), "learn", facts_for=_Reads())

    facts = _facts_by_title(tour)[CLONER]
    assert facts[0] == "Clones repositories into a temp folder."
    assert facts[1] == "Key functions: clone_repo, parse_repo_url, cleanup_repo"
    assert facts[-1] == "2 file(s) depend on this; it depends on 0"


def test_a_handler_step_lists_the_routes_it_serves_once():
    facts = _facts_by_title(assemble_tour(assemble_graph(_record()), "learn", facts_for=_Reads()))

    assert facts[CHAT][:2] == ["RAG chat over an analyzed repo.", "Serves POST /chat/{repo_id}, DELETE /session/{sid}"]
    assert facts[MAIN][0] == "Routes: GET /health"
    assert not any(line.startswith("Serves") for line in facts[MAIN])  # the derived line already says it


def test_the_tour_reads_facts_for_its_own_steps_only():
    reads = _Reads()
    tour = assemble_tour(assemble_graph(_record()), "recall", facts_for=reads)

    assert reads.asked == [[step["node_ids"][0] for step in tour["steps"]]]


def test_without_facts_a_step_reads_as_before():
    facts = _facts_by_title(assemble_tour(assemble_graph(_record()), "learn"))
    assert facts[CLONER] == ["Core_Module", "2 file(s) depend on this; it depends on 0"]


def test_a_diff_step_says_what_the_changed_file_does():
    tour = assemble_diff_tour(assemble_graph(_record()), {CLONER: "STRUCTURAL"}, facts_for=_Reads())
    assert tour["steps"][0]["facts"][0] == "Clones repositories into a temp folder."


def test_graph_files_carry_the_facts_they_were_given():
    graph = assemble_graph(_record(), {CHAT: FACTS[CHAT]})
    files = {f["id"]: f for f in graph["files"]}

    assert files[CHAT]["purpose"] == "RAG chat over an analyzed repo."
    assert files[CHAT]["key_symbols"] == ["chat_repo"]
    assert files[CHAT]["routes"] == ["POST /chat/{repo_id}", "DELETE /session/{sid}"]
    assert "purpose" not in files[CLONER]  # not asked for: no facts, no keys

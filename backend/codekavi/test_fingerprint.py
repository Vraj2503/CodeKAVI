"""Guards the tree-sitter capture-shape handling in _js_ts_structure_signature.

0.23+ bindings return {capture_name: [nodes]}; unpacking that as (node, name)
silently blew up on `str.text`, leaving every JS/TS fingerprint empty.
"""

from codekavi.fingerprint import _js_ts_structure_signature

SOURCE = """
import x from "./a";
export function foo() {}
export class Bar {}
"""


def test_js_ts_structure_signature_reads_captures():
    result = _js_ts_structure_signature(SOURCE, "ts")

    assert result["parse_error"] is False
    assert [i.source for i in result["imports"]] == ["./a"]
    assert [f.name for f in result["functions"]] == ["foo"]
    assert [c.name for c in result["classes"]] == ["Bar"]

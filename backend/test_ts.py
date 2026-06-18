import tree_sitter_javascript as tsjs
from tree_sitter import Language, Parser

JS_LANGUAGE = Language(tsjs.language(), "javascript")
parser = Parser()
parser.set_language(JS_LANGUAGE)

source = b"""
import { a } from './module_a.js';
const b = require('./module_b');
const c = await import('./module_c');
export { d } from './module_d';
"""
tree = parser.parse(source)

query = JS_LANGUAGE.query("""
    (import_statement source: (string (string_fragment) @path))
    (export_statement source: (string (string_fragment) @path))
    (call_expression 
        function: (identifier) @fname
        arguments: (arguments (string (string_fragment) @path))
        (#eq? @fname "require"))
    (call_expression
        function: (import)
        arguments: (arguments (string (string_fragment) @path)))
""")

captures = query.captures(tree.root_node)
print("Captures type:", type(captures))
if isinstance(captures, list):
    for capture in captures:
        node = capture[0]
        name = capture[1]
        if name == "path":
            print("Found:", node.text.decode('utf8'), "at line", node.start_point.row + 1)
else:
    for node, name in captures.items():
        if name == "path":
            print("Found:", node.text.decode('utf8'), "at line", node.start_point.row + 1)

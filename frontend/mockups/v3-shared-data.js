// v3-shared-data.js — Shared realistic fake data for all v3 Knowledge Graph mockups.
// Embed this DATA object at the top of each HTML file's <script> tag.
// All field names match the real API contract exactly.

const DATA = {

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW TIER — groups (files) and group_edges (inter-file calls)
// ═══════════════════════════════════════════════════════════════════

groups: [
  // ── Drawn groups (25) ──
  {id:"rune/analyzer.py",label:"analyzer.py",file:"rune/analyzer.py",role:"core_module",importance:92.1,symbol_count:15,top_symbols:["AnalysisEngine","run_analysis","build_call_graph"],effects:["filesystem","cache"],routes:[],drawn:true},
  {id:"rune/cache.py",label:"cache.py",file:"rune/cache.py",role:"core_module",importance:87.4,symbol_count:8,top_symbols:["AnalysisCache","get_cache","invalidate"],effects:["cache","network"],routes:[],drawn:true},
  {id:"rune/graph.py",label:"graph.py",file:"rune/graph.py",role:"core_module",importance:84.7,symbol_count:10,top_symbols:["SymbolGraph","compute_pagerank","resolve_edges"],effects:["cache"],routes:[],drawn:true},
  {id:"rune/classifier.py",label:"classifier.py",file:"rune/classifier.py",role:"core_module",importance:78.3,symbol_count:7,top_symbols:["classify_role","RoleClassifier","score_centrality"],effects:["llm"],routes:[],drawn:true},
  {id:"rune/traversal.py",label:"traversal.py",file:"rune/traversal.py",role:"core_module",importance:75.6,symbol_count:6,top_symbols:["walk_ast","ASTVisitor","collect_imports"],effects:["filesystem"],routes:[],drawn:true},
  {id:"rune/indexer.py",label:"indexer.py",file:"rune/indexer.py",role:"core_module",importance:71.2,symbol_count:5,top_symbols:["SymbolIndex","build_index","lookup"],effects:["cache","db"],routes:[],drawn:true},
  {id:"rune/routes/analyze.py",label:"analyze.py",file:"rune/routes/analyze.py",role:"router",importance:68.5,symbol_count:4,top_symbols:["analyze_endpoint","stream_results","validate_repo"],effects:["network","filesystem"],routes:["POST /analyze","POST /analyze/stream"],drawn:true},
  {id:"rune/routes/visualize.py",label:"visualize.py",file:"rune/routes/visualize.py",role:"router",importance:52.3,symbol_count:4,top_symbols:["get_knowledge","get_dependency","get_file_tree"],effects:["network","cache"],routes:["GET /visualize/knowledge","GET /visualize/dependency"],drawn:true},
  {id:"rune/routes/health.py",label:"health.py",file:"rune/routes/health.py",role:"router",importance:22.1,symbol_count:2,top_symbols:["health_check","readiness"],effects:["network"],routes:["GET /health"],drawn:true},
  {id:"rune/models.py",label:"models.py",file:"rune/models.py",role:"shared_utility",importance:65.8,symbol_count:8,top_symbols:["Repository","SymbolNode","EdgeRecord"],effects:[],routes:[],drawn:true},
  {id:"rune/utils.py",label:"utils.py",file:"rune/utils.py",role:"shared_utility",importance:58.4,symbol_count:5,top_symbols:["hash_content","normalize_path","timer"],effects:["filesystem"],routes:[],drawn:true},
  {id:"rune/schema.py",label:"schema.py",file:"rune/schema.py",role:"shared_utility",importance:45.2,symbol_count:4,top_symbols:["RepoSchema","SymbolSchema","validate_payload"],effects:[],routes:[],drawn:true},
  {id:"rune/exceptions.py",label:"exceptions.py",file:"rune/exceptions.py",role:"shared_utility",importance:32.6,symbol_count:3,top_symbols:["AnalysisError","ParseError","QuotaExceeded"],effects:[],routes:[],drawn:true},
  {id:"rune/parsers/python_parser.py",label:"python_parser.py",file:"rune/parsers/python_parser.py",role:"internal_helper",importance:61.3,symbol_count:5,top_symbols:["PythonParser","parse_module","extract_decorators"],effects:["filesystem"],routes:[],drawn:true},
  {id:"rune/parsers/js_parser.py",label:"js_parser.py",file:"rune/parsers/js_parser.py",role:"internal_helper",importance:42.7,symbol_count:4,top_symbols:["JSParser","parse_module","extract_exports"],effects:["filesystem"],routes:[],drawn:true},
  {id:"rune/parsers/tree_sitter.py",label:"tree_sitter.py",file:"rune/parsers/tree_sitter.py",role:"internal_helper",importance:55.1,symbol_count:4,top_symbols:["TreeSitterWrapper","parse_source","get_node_text"],effects:["subprocess"],routes:[],drawn:true},
  {id:"rune/parsers/base_parser.py",label:"base_parser.py",file:"rune/parsers/base_parser.py",role:"internal_helper",importance:48.9,symbol_count:3,top_symbols:["BaseParser","parse","get_symbols"],effects:[],routes:[],drawn:true},
  {id:"rune/llm/client.py",label:"client.py",file:"rune/llm/client.py",role:"orchestrator",importance:63.7,symbol_count:5,top_symbols:["LLMClient","generate","batch_embed"],effects:["network","llm"],routes:[],drawn:true},
  {id:"rune/llm/prompts.py",label:"prompts.py",file:"rune/llm/prompts.py",role:"internal_helper",importance:38.4,symbol_count:3,top_symbols:["build_prompt","CLASSIFY_TEMPLATE","CONCEPT_TEMPLATE"],effects:[],routes:[],drawn:true},
  {id:"rune/llm/embeddings.py",label:"embeddings.py",file:"rune/llm/embeddings.py",role:"internal_helper",importance:44.8,symbol_count:4,top_symbols:["embed_symbols","EmbeddingStore","cosine_sim"],effects:["network","llm","cache"],routes:[],drawn:true},
  {id:"rune/storage/redis_store.py",label:"redis_store.py",file:"rune/storage/redis_store.py",role:"leaf",importance:36.5,symbol_count:3,top_symbols:["RedisStore","connect","flush"],effects:["network","cache"],routes:[],drawn:true},
  {id:"rune/storage/git_ops.py",label:"git_ops.py",file:"rune/storage/git_ops.py",role:"leaf",importance:41.2,symbol_count:4,top_symbols:["clone_repo","get_diff","list_files"],effects:["filesystem","subprocess"],routes:[],drawn:true},
  {id:"rune/main.py",label:"main.py",file:"rune/main.py",role:"entry_point",importance:50.8,symbol_count:3,top_symbols:["main","create_app","setup_logging"],effects:["filesystem","network"],routes:[],drawn:true},
  {id:"rune/cli.py",label:"cli.py",file:"rune/cli.py",role:"entry_point",importance:46.3,symbol_count:3,top_symbols:["cli","analyze_cmd","serve_cmd"],effects:["filesystem","network"],routes:[],drawn:true},
  {id:"rune/config.py",label:"config.py",file:"rune/config.py",role:"config",importance:34.7,symbol_count:3,top_symbols:["Settings","load_config","DEFAULTS"],effects:["filesystem"],routes:[],drawn:true},
  // ── Non-drawn groups (20) ──
  {id:"rune/routes/auth.py",label:"auth.py",file:"rune/routes/auth.py",role:"router",importance:18.3,symbol_count:3,top_symbols:["verify_token","require_auth"],effects:["network"],routes:["POST /auth/verify"],drawn:false},
  {id:"rune/routes/repos.py",label:"repos.py",file:"rune/routes/repos.py",role:"router",importance:15.7,symbol_count:2,top_symbols:["list_repos","delete_repo"],effects:["network","db"],routes:["GET /repos"],drawn:false},
  {id:"rune/middleware.py",label:"middleware.py",file:"rune/middleware.py",role:"shared_utility",importance:14.2,symbol_count:3,top_symbols:["cors_middleware","rate_limiter"],effects:["network"],routes:[],drawn:false},
  {id:"rune/quota.py",label:"quota.py",file:"rune/quota.py",role:"internal_helper",importance:12.8,symbol_count:2,top_symbols:["check_quota","QuotaManager"],effects:["db","cache"],routes:[],drawn:false},
  {id:"rune/parsers/go_parser.py",label:"go_parser.py",file:"rune/parsers/go_parser.py",role:"internal_helper",importance:11.4,symbol_count:3,top_symbols:["GoParser","parse_package"],effects:["filesystem"],routes:[],drawn:false},
  {id:"rune/parsers/ruby_parser.py",label:"ruby_parser.py",file:"rune/parsers/ruby_parser.py",role:"internal_helper",importance:9.6,symbol_count:2,top_symbols:["RubyParser","parse_file"],effects:["filesystem"],routes:[],drawn:false},
  {id:"rune/parsers/java_parser.py",label:"java_parser.py",file:"rune/parsers/java_parser.py",role:"internal_helper",importance:10.2,symbol_count:3,top_symbols:["JavaParser","parse_class"],effects:["filesystem"],routes:[],drawn:false},
  {id:"rune/formatters/html.py",label:"html.py",file:"rune/formatters/html.py",role:"leaf",importance:8.1,symbol_count:2,top_symbols:["render_html","HTMLFormatter"],effects:[],routes:[],drawn:false},
  {id:"rune/formatters/json.py",label:"json.py",file:"rune/formatters/json.py",role:"leaf",importance:7.5,symbol_count:2,top_symbols:["render_json","JSONFormatter"],effects:[],routes:[],drawn:false},
  {id:"rune/formatters/markdown.py",label:"markdown.py",file:"rune/formatters/markdown.py",role:"leaf",importance:6.9,symbol_count:2,top_symbols:["render_markdown"],effects:[],routes:[],drawn:false},
  {id:"rune/migrations/001_init.py",label:"001_init.py",file:"rune/migrations/001_init.py",role:"config",importance:5.2,symbol_count:2,top_symbols:["upgrade","downgrade"],effects:["db"],routes:[],drawn:false},
  {id:"rune/migrations/002_add_cache.py",label:"002_add_cache.py",file:"rune/migrations/002_add_cache.py",role:"config",importance:4.8,symbol_count:2,top_symbols:["upgrade","downgrade"],effects:["db"],routes:[],drawn:false},
  {id:"rune/tests/test_analyzer.py",label:"test_analyzer.py",file:"rune/tests/test_analyzer.py",role:"test",importance:6.4,symbol_count:4,top_symbols:["TestAnalysisEngine","test_run"],effects:[],routes:[],drawn:false},
  {id:"rune/tests/test_cache.py",label:"test_cache.py",file:"rune/tests/test_cache.py",role:"test",importance:5.8,symbol_count:3,top_symbols:["TestCache","test_invalidate"],effects:[],routes:[],drawn:false},
  {id:"rune/tests/test_graph.py",label:"test_graph.py",file:"rune/tests/test_graph.py",role:"test",importance:5.1,symbol_count:3,top_symbols:["TestGraph","test_pagerank"],effects:[],routes:[],drawn:false},
  {id:"rune/tests/test_parser.py",label:"test_parser.py",file:"rune/tests/test_parser.py",role:"test",importance:4.5,symbol_count:2,top_symbols:["TestPythonParser"],effects:[],routes:[],drawn:false},
  {id:"rune/tests/test_routes.py",label:"test_routes.py",file:"rune/tests/test_routes.py",role:"test",importance:4.2,symbol_count:3,top_symbols:["TestAnalyzeRoute","test_stream"],effects:[],routes:[],drawn:false},
  {id:"rune/tests/conftest.py",label:"conftest.py",file:"rune/tests/conftest.py",role:"test",importance:3.8,symbol_count:2,top_symbols:["app_fixture","db_fixture"],effects:[],routes:[],drawn:false},
  {id:"rune/logging_config.py",label:"logging_config.py",file:"rune/logging_config.py",role:"config",importance:3.1,symbol_count:1,top_symbols:["configure_logging"],effects:["filesystem"],routes:[],drawn:false},
  {id:"rune/__init__.py",label:"__init__.py",file:"rune/__init__.py",role:"config",importance:2.4,symbol_count:1,top_symbols:["__version__"],effects:[],routes:[],drawn:false},
],

group_edges: [
  // Entry points → core
  {source:"rune/main.py",target:"rune/analyzer.py",weight:8},
  {source:"rune/main.py",target:"rune/config.py",weight:3},
  {source:"rune/main.py",target:"rune/cache.py",weight:2},
  {source:"rune/cli.py",target:"rune/main.py",weight:4},
  {source:"rune/cli.py",target:"rune/config.py",weight:3},
  {source:"rune/cli.py",target:"rune/analyzer.py",weight:2},
  // Routes → core
  {source:"rune/routes/analyze.py",target:"rune/analyzer.py",weight:12},
  {source:"rune/routes/analyze.py",target:"rune/cache.py",weight:7},
  {source:"rune/routes/analyze.py",target:"rune/models.py",weight:4},
  {source:"rune/routes/analyze.py",target:"rune/schema.py",weight:3},
  {source:"rune/routes/analyze.py",target:"rune/exceptions.py",weight:2},
  {source:"rune/routes/visualize.py",target:"rune/graph.py",weight:9},
  {source:"rune/routes/visualize.py",target:"rune/cache.py",weight:5},
  {source:"rune/routes/visualize.py",target:"rune/models.py",weight:3},
  {source:"rune/routes/visualize.py",target:"rune/classifier.py",weight:2},
  {source:"rune/routes/health.py",target:"rune/cache.py",weight:1},
  {source:"rune/routes/health.py",target:"rune/config.py",weight:1},
  // Analyzer → everything
  {source:"rune/analyzer.py",target:"rune/cache.py",weight:9},
  {source:"rune/analyzer.py",target:"rune/graph.py",weight:11},
  {source:"rune/analyzer.py",target:"rune/classifier.py",weight:6},
  {source:"rune/analyzer.py",target:"rune/traversal.py",weight:14},
  {source:"rune/analyzer.py",target:"rune/indexer.py",weight:5},
  {source:"rune/analyzer.py",target:"rune/models.py",weight:8},
  {source:"rune/analyzer.py",target:"rune/utils.py",weight:6},
  {source:"rune/analyzer.py",target:"rune/exceptions.py",weight:3},
  {source:"rune/analyzer.py",target:"rune/config.py",weight:2},
  {source:"rune/analyzer.py",target:"rune/parsers/python_parser.py",weight:7},
  {source:"rune/analyzer.py",target:"rune/parsers/js_parser.py",weight:4},
  {source:"rune/analyzer.py",target:"rune/parsers/tree_sitter.py",weight:3},
  {source:"rune/analyzer.py",target:"rune/llm/client.py",weight:5},
  {source:"rune/analyzer.py",target:"rune/storage/git_ops.py",weight:6},
  // Graph → helpers
  {source:"rune/graph.py",target:"rune/models.py",weight:7},
  {source:"rune/graph.py",target:"rune/utils.py",weight:4},
  {source:"rune/graph.py",target:"rune/classifier.py",weight:5},
  {source:"rune/graph.py",target:"rune/indexer.py",weight:3},
  {source:"rune/graph.py",target:"rune/exceptions.py",weight:2},
  // Classifier → helpers
  {source:"rune/classifier.py",target:"rune/graph.py",weight:4},
  {source:"rune/classifier.py",target:"rune/models.py",weight:5},
  {source:"rune/classifier.py",target:"rune/llm/client.py",weight:6},
  {source:"rune/classifier.py",target:"rune/llm/prompts.py",weight:3},
  {source:"rune/classifier.py",target:"rune/utils.py",weight:2},
  // Traversal → parsers
  {source:"rune/traversal.py",target:"rune/parsers/python_parser.py",weight:8},
  {source:"rune/traversal.py",target:"rune/parsers/js_parser.py",weight:5},
  {source:"rune/traversal.py",target:"rune/parsers/tree_sitter.py",weight:6},
  {source:"rune/traversal.py",target:"rune/parsers/base_parser.py",weight:4},
  {source:"rune/traversal.py",target:"rune/models.py",weight:3},
  {source:"rune/traversal.py",target:"rune/utils.py",weight:5},
  // Indexer
  {source:"rune/indexer.py",target:"rune/cache.py",weight:6},
  {source:"rune/indexer.py",target:"rune/models.py",weight:4},
  {source:"rune/indexer.py",target:"rune/storage/redis_store.py",weight:5},
  {source:"rune/indexer.py",target:"rune/utils.py",weight:2},
  // Cache → storage
  {source:"rune/cache.py",target:"rune/storage/redis_store.py",weight:8},
  {source:"rune/cache.py",target:"rune/models.py",weight:3},
  {source:"rune/cache.py",target:"rune/config.py",weight:2},
  {source:"rune/cache.py",target:"rune/utils.py",weight:3},
  {source:"rune/cache.py",target:"rune/exceptions.py",weight:1},
  // Parsers cross-calls
  {source:"rune/parsers/python_parser.py",target:"rune/parsers/base_parser.py",weight:6},
  {source:"rune/parsers/python_parser.py",target:"rune/parsers/tree_sitter.py",weight:4},
  {source:"rune/parsers/python_parser.py",target:"rune/models.py",weight:3},
  {source:"rune/parsers/js_parser.py",target:"rune/parsers/base_parser.py",weight:5},
  {source:"rune/parsers/js_parser.py",target:"rune/parsers/tree_sitter.py",weight:3},
  {source:"rune/parsers/js_parser.py",target:"rune/models.py",weight:2},
  {source:"rune/parsers/tree_sitter.py",target:"rune/parsers/base_parser.py",weight:3},
  {source:"rune/parsers/tree_sitter.py",target:"rune/utils.py",weight:2},
  // LLM
  {source:"rune/llm/client.py",target:"rune/llm/prompts.py",weight:5},
  {source:"rune/llm/client.py",target:"rune/llm/embeddings.py",weight:4},
  {source:"rune/llm/client.py",target:"rune/config.py",weight:3},
  {source:"rune/llm/client.py",target:"rune/exceptions.py",weight:2},
  {source:"rune/llm/client.py",target:"rune/cache.py",weight:3},
  {source:"rune/llm/embeddings.py",target:"rune/cache.py",weight:4},
  {source:"rune/llm/embeddings.py",target:"rune/models.py",weight:2},
  {source:"rune/llm/embeddings.py",target:"rune/storage/redis_store.py",weight:3},
  // Storage
  {source:"rune/storage/redis_store.py",target:"rune/config.py",weight:3},
  {source:"rune/storage/redis_store.py",target:"rune/exceptions.py",weight:1},
  {source:"rune/storage/git_ops.py",target:"rune/config.py",weight:2},
  {source:"rune/storage/git_ops.py",target:"rune/utils.py",weight:3},
  {source:"rune/storage/git_ops.py",target:"rune/exceptions.py",weight:1},
  // Schema / utils / models cross-usage
  {source:"rune/schema.py",target:"rune/models.py",weight:6},
  {source:"rune/schema.py",target:"rune/exceptions.py",weight:2},
  {source:"rune/utils.py",target:"rune/config.py",weight:2},
  {source:"rune/utils.py",target:"rune/exceptions.py",weight:1},
  {source:"rune/models.py",target:"rune/exceptions.py",weight:2},
  {source:"rune/models.py",target:"rune/utils.py",weight:3},
  // Misc
  {source:"rune/config.py",target:"rune/exceptions.py",weight:1},
  {source:"rune/indexer.py",target:"rune/graph.py",weight:3},
  {source:"rune/indexer.py",target:"rune/exceptions.py",weight:1},
],

// ═══════════════════════════════════════════════════════════════════
// DRILL-DOWN TIER — individual symbols and call/inherit edges
// ═══════════════════════════════════════════════════════════════════

nodes: [
  // ── rune/analyzer.py (15 symbols) ──
  {id:"rune/analyzer.py::AnalysisEngine",label:"AnalysisEngine",type:"class",file:"rune/analyzer.py",line:28,loc:340,doc:"Central engine orchestrating multi-file repo analysis.",signature:"(repo: Repository, config: Settings)",is_async:false,http:null,external_calls:["json.dumps","hashlib.sha256"],effects:["filesystem","cache"],in_degree:12,out_degree:8,role:"core_module",importance:92.1},
  {id:"rune/analyzer.py::run_analysis",label:"run_analysis",type:"method",file:"rune/analyzer.py",line:45,loc:85,doc:"Run full analysis pipeline on a cloned repository.",signature:"(self, repo_path: Path, depth: int = 3) -> AnalysisResult",is_async:true,http:null,external_calls:["asyncio.gather","time.monotonic"],effects:["filesystem","cache"],in_degree:9,out_degree:6,role:"core_module",importance:88.5},
  {id:"rune/analyzer.py::analyze_file",label:"analyze_file",type:"method",file:"rune/analyzer.py",line:132,loc:42,doc:"Parse a single source file and extract symbols.",signature:"(self, path: Path) -> list[SymbolNode]",is_async:false,http:null,external_calls:["os.path.splitext"],effects:["filesystem"],in_degree:4,out_degree:5,role:"core_module",importance:72.3},
  {id:"rune/analyzer.py::merge_results",label:"merge_results",type:"method",file:"rune/analyzer.py",line:176,loc:28,doc:"Combine per-file results into a unified analysis.",signature:"(self, results: list[AnalysisResult]) -> AnalysisResult",is_async:false,http:null,external_calls:["itertools.chain"],effects:[],in_degree:3,out_degree:2,role:"core_module",importance:54.2},
  {id:"rune/analyzer.py::validate_input",label:"validate_input",type:"function",file:"rune/analyzer.py",line:206,loc:15,doc:"Validate repo URL or path before analysis begins.",signature:"(source: str) -> tuple[str, str]",is_async:false,http:null,external_calls:["urllib.parse.urlparse"],effects:[],in_degree:5,out_degree:1,role:"core_module",importance:41.8},
  {id:"rune/analyzer.py::create_snapshot",label:"create_snapshot",type:"function",file:"rune/analyzer.py",line:223,loc:22,doc:"Snapshot current analysis state for incremental updates.",signature:"(result: AnalysisResult, cache: AnalysisCache) -> str",is_async:false,http:null,external_calls:["json.dumps","gzip.compress"],effects:["filesystem","cache"],in_degree:2,out_degree:3,role:"core_module",importance:35.6},
  {id:"rune/analyzer.py::AnalysisResult",label:"AnalysisResult",type:"class",file:"rune/analyzer.py",line:247,loc:95,doc:"Immutable container for completed analysis output.",signature:"(symbols: list, edges: list, metadata: dict)",is_async:false,http:null,external_calls:[],effects:[],in_degree:7,out_degree:3,role:"core_module",importance:67.4},
  {id:"rune/analyzer.py::to_dict",label:"to_dict",type:"method",file:"rune/analyzer.py",line:260,loc:12,doc:null,signature:"(self) -> dict",is_async:false,http:null,external_calls:["json.dumps"],effects:[],in_degree:6,out_degree:0,role:"core_module",importance:28.9},
  {id:"rune/analyzer.py::from_cache",label:"from_cache",type:"method",file:"rune/analyzer.py",line:274,loc:18,doc:"Reconstruct an AnalysisResult from cache bytes.",signature:"(cls, data: bytes) -> AnalysisResult",is_async:false,http:null,external_calls:["json.loads","gzip.decompress"],effects:["cache"],in_degree:4,out_degree:2,role:"core_module",importance:38.1},
  {id:"rune/analyzer.py::SymbolExtractor",label:"SymbolExtractor",type:"class",file:"rune/analyzer.py",line:294,loc:120,doc:"Walks parsed AST to extract function, class, and method nodes.",signature:"(language: str, config: Settings)",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:5,role:"core_module",importance:61.7},
  {id:"rune/analyzer.py::extract_symbols",label:"extract_symbols",type:"method",file:"rune/analyzer.py",line:310,loc:45,doc:"Extract all symbol definitions from parsed AST.",signature:"(self, tree: Tree) -> list[SymbolNode]",is_async:false,http:null,external_calls:[],effects:[],in_degree:6,out_degree:4,role:"core_module",importance:58.3},
  {id:"rune/analyzer.py::resolve_references",label:"resolve_references",type:"method",file:"rune/analyzer.py",line:357,loc:52,doc:"Match call sites to their definitions across files.",signature:"(self, symbols: list[SymbolNode], index: SymbolIndex) -> list[EdgeRecord]",is_async:false,http:null,external_calls:[],effects:[],in_degree:2,out_degree:6,role:"core_module",importance:64.9},
  {id:"rune/analyzer.py::build_call_graph",label:"build_call_graph",type:"function",file:"rune/analyzer.py",line:411,loc:38,doc:"Construct the complete call graph from resolved references.",signature:"(symbols: list, edges: list) -> SymbolGraph",is_async:false,http:null,external_calls:[],effects:["cache"],in_degree:5,out_degree:4,role:"core_module",importance:76.2},
  {id:"rune/analyzer.py::compute_importance",label:"compute_importance",type:"function",file:"rune/analyzer.py",line:451,loc:44,doc:"Run PageRank to assign importance scores to all symbols.",signature:"(graph: SymbolGraph, damping: float = 0.85) -> dict[str, float]",is_async:false,http:null,external_calls:["numpy.array","numpy.linalg.norm"],effects:[],in_degree:3,out_degree:3,role:"core_module",importance:69.8},
  {id:"rune/analyzer.py::rank_symbols",label:"rank_symbols",type:"function",file:"rune/analyzer.py",line:497,loc:18,doc:null,signature:"(scores: dict[str, float], top_k: int = 25) -> list[str]",is_async:false,http:null,external_calls:["heapq.nlargest"],effects:[],in_degree:2,out_degree:2,role:"core_module",importance:31.4},

  // ── rune/cache.py (8 symbols) ──
  {id:"rune/cache.py::AnalysisCache",label:"AnalysisCache",type:"class",file:"rune/cache.py",line:41,loc:180,doc:"Redis-backed store for analysis results.",signature:"(redis_url: str, ttl: int = 3600)",is_async:false,http:null,external_calls:["json.loads","hgetall","setex"],effects:["cache","network"],in_degree:9,out_degree:4,role:"core_module",importance:87.4},
  {id:"rune/cache.py::get_cache",label:"get_cache",type:"method",file:"rune/cache.py",line:78,loc:24,doc:"Retrieve cached analysis by repo hash.",signature:"(self, key: str) -> Optional[bytes]",is_async:true,http:null,external_calls:["redis.get"],effects:["cache"],in_degree:7,out_degree:2,role:"core_module",importance:74.1},
  {id:"rune/cache.py::set_cache",label:"set_cache",type:"method",file:"rune/cache.py",line:104,loc:18,doc:"Store analysis result bytes with TTL.",signature:"(self, key: str, value: bytes) -> None",is_async:true,http:null,external_calls:["redis.setex"],effects:["cache"],in_degree:4,out_degree:1,role:"core_module",importance:62.5},
  {id:"rune/cache.py::invalidate",label:"invalidate",type:"method",file:"rune/cache.py",line:124,loc:12,doc:"Remove a cached entry by key pattern.",signature:"(self, pattern: str) -> int",is_async:true,http:null,external_calls:["redis.delete","redis.scan_iter"],effects:["cache"],in_degree:3,out_degree:2,role:"core_module",importance:45.3},
  {id:"rune/cache.py::CacheKey",label:"CacheKey",type:"class",file:"rune/cache.py",line:138,loc:32,doc:"Typed wrapper around cache key construction.",signature:"(repo_id: str, variant: str = 'full')",is_async:false,http:null,external_calls:[],effects:[],in_degree:5,out_degree:1,role:"core_module",importance:38.7},
  {id:"rune/cache.py::build_key",label:"build_key",type:"function",file:"rune/cache.py",line:172,loc:8,doc:null,signature:"(repo_id: str, suffix: str) -> str",is_async:false,http:null,external_calls:["hashlib.md5"],effects:[],in_degree:6,out_degree:0,role:"core_module",importance:33.2},
  {id:"rune/cache.py::warm_cache",label:"warm_cache",type:"function",file:"rune/cache.py",line:182,loc:26,doc:"Pre-populate cache for frequently accessed repos.",signature:"(cache: AnalysisCache, repo_ids: list[str]) -> None",is_async:true,http:null,external_calls:[],effects:["cache","network"],in_degree:1,out_degree:3,role:"core_module",importance:22.8},
  {id:"rune/cache.py::cache_stats",label:"cache_stats",type:"function",file:"rune/cache.py",line:210,loc:14,doc:"Return hit/miss ratio and memory usage.",signature:"(cache: AnalysisCache) -> dict",is_async:false,http:null,external_calls:["redis.info"],effects:["cache"],in_degree:2,out_degree:1,role:"core_module",importance:18.4},

  // ── rune/graph.py (10 symbols) ──
  {id:"rune/graph.py::SymbolGraph",label:"SymbolGraph",type:"class",file:"rune/graph.py",line:15,loc:260,doc:"Directed graph of symbol-level call and inheritance relationships.",signature:"()",is_async:false,http:null,external_calls:[],effects:[],in_degree:8,out_degree:6,role:"core_module",importance:84.7},
  {id:"rune/graph.py::add_node",label:"add_node",type:"method",file:"rune/graph.py",line:42,loc:12,doc:null,signature:"(self, node: SymbolNode) -> None",is_async:false,http:null,external_calls:[],effects:[],in_degree:5,out_degree:0,role:"core_module",importance:41.2},
  {id:"rune/graph.py::add_edge",label:"add_edge",type:"method",file:"rune/graph.py",line:56,loc:16,doc:null,signature:"(self, source: str, target: str, label: str) -> None",is_async:false,http:null,external_calls:[],effects:[],in_degree:4,out_degree:0,role:"core_module",importance:39.8},
  {id:"rune/graph.py::compute_pagerank",label:"compute_pagerank",type:"method",file:"rune/graph.py",line:74,loc:48,doc:"Iterative PageRank over the symbol graph.",signature:"(self, damping: float = 0.85, iterations: int = 100) -> dict[str, float]",is_async:false,http:null,external_calls:["numpy.zeros","numpy.abs"],effects:[],in_degree:6,out_degree:3,role:"core_module",importance:78.9},
  {id:"rune/graph.py::resolve_edges",label:"resolve_edges",type:"function",file:"rune/graph.py",line:124,loc:36,doc:"Match unresolved call-site names to known symbol IDs.",signature:"(calls: list[dict], index: SymbolIndex) -> tuple[list, list]",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:4,role:"core_module",importance:71.5},
  {id:"rune/graph.py::get_connected_components",label:"get_connected_components",type:"function",file:"rune/graph.py",line:162,loc:22,doc:"Find weakly connected components via BFS.",signature:"(graph: SymbolGraph) -> list[set[str]]",is_async:false,http:null,external_calls:["collections.deque"],effects:[],in_degree:2,out_degree:2,role:"core_module",importance:42.6},
  {id:"rune/graph.py::filter_by_threshold",label:"filter_by_threshold",type:"function",file:"rune/graph.py",line:186,loc:14,doc:null,signature:"(graph: SymbolGraph, min_importance: float) -> SymbolGraph",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:1,role:"core_module",importance:36.3},
  {id:"rune/graph.py::GraphNode",label:"GraphNode",type:"class",file:"rune/graph.py",line:202,loc:28,doc:"Internal graph node wrapper with adjacency lists.",signature:"(id: str, data: dict)",is_async:false,http:null,external_calls:[],effects:[],in_degree:4,out_degree:2,role:"core_module",importance:32.1},
  {id:"rune/graph.py::serialize_graph",label:"serialize_graph",type:"function",file:"rune/graph.py",line:232,loc:20,doc:"Export graph to JSON-serializable dict.",signature:"(graph: SymbolGraph) -> dict",is_async:false,http:null,external_calls:["json.dumps"],effects:[],in_degree:5,out_degree:1,role:"core_module",importance:29.4},
  {id:"rune/graph.py::collapse_to_groups",label:"collapse_to_groups",type:"function",file:"rune/graph.py",line:254,loc:32,doc:"Aggregate symbol-level edges into file-level group edges.",signature:"(graph: SymbolGraph) -> tuple[list, list]",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:3,role:"core_module",importance:65.7},

  // ── rune/classifier.py (7 symbols) ──
  {id:"rune/classifier.py::RoleClassifier",label:"RoleClassifier",type:"class",file:"rune/classifier.py",line:12,loc:145,doc:"Assigns architectural roles to symbols using heuristics and LLM.",signature:"(llm_client: Optional[LLMClient] = None)",is_async:false,http:null,external_calls:[],effects:["llm"],in_degree:4,out_degree:5,role:"core_module",importance:78.3},
  {id:"rune/classifier.py::classify_role",label:"classify_role",type:"method",file:"rune/classifier.py",line:38,loc:42,doc:"Determine the role of a single symbol.",signature:"(self, symbol: SymbolNode, graph: SymbolGraph) -> str",is_async:false,http:null,external_calls:[],effects:[],in_degree:6,out_degree:3,role:"core_module",importance:72.1},
  {id:"rune/classifier.py::score_centrality",label:"score_centrality",type:"function",file:"rune/classifier.py",line:82,loc:28,doc:"Betweenness centrality used as a classification signal.",signature:"(graph: SymbolGraph, node_id: str) -> float",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:2,role:"core_module",importance:55.6},
  {id:"rune/classifier.py::detect_entry_points",label:"detect_entry_points",type:"function",file:"rune/classifier.py",line:112,loc:18,doc:"Identify symbols with zero in-degree or route decorators.",signature:"(graph: SymbolGraph) -> list[str]",is_async:false,http:null,external_calls:[],effects:[],in_degree:2,out_degree:2,role:"core_module",importance:48.4},
  {id:"rune/classifier.py::apply_heuristics",label:"apply_heuristics",type:"function",file:"rune/classifier.py",line:132,loc:24,doc:null,signature:"(symbol: SymbolNode, metrics: dict) -> str",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:1,role:"core_module",importance:42.7},
  {id:"rune/classifier.py::ClassificationResult",label:"ClassificationResult",type:"class",file:"rune/classifier.py",line:158,loc:22,doc:"Container for classification output with confidence.",signature:"(role: str, confidence: float, reasoning: str)",is_async:false,http:null,external_calls:[],effects:[],in_degree:4,out_degree:0,role:"core_module",importance:36.5},
  {id:"rune/classifier.py::merge_classifications",label:"merge_classifications",type:"function",file:"rune/classifier.py",line:182,loc:16,doc:null,signature:"(results: list[ClassificationResult]) -> dict[str, str]",is_async:false,http:null,external_calls:[],effects:[],in_degree:2,out_degree:1,role:"core_module",importance:28.9},

  // ── rune/models.py (8 symbols) ──
  {id:"rune/models.py::Repository",label:"Repository",type:"class",file:"rune/models.py",line:8,loc:62,doc:"Core repository data model.",signature:"(url: str, branch: str, commit_sha: str)",is_async:false,http:null,external_calls:[],effects:[],in_degree:11,out_degree:2,role:"shared_utility",importance:65.8},
  {id:"rune/models.py::SymbolNode",label:"SymbolNode",type:"class",file:"rune/models.py",line:72,loc:48,doc:"Represents a single code symbol (function, class, method).",signature:"(id: str, label: str, type: str, file: str, line: int)",is_async:false,http:null,external_calls:[],effects:[],in_degree:14,out_degree:1,role:"shared_utility",importance:61.2},
  {id:"rune/models.py::EdgeRecord",label:"EdgeRecord",type:"class",file:"rune/models.py",line:122,loc:24,doc:null,signature:"(source: str, target: str, label: str)",is_async:false,http:null,external_calls:[],effects:[],in_degree:8,out_degree:0,role:"shared_utility",importance:44.7},
  {id:"rune/models.py::GroupRecord",label:"GroupRecord",type:"class",file:"rune/models.py",line:148,loc:32,doc:"File-level group aggregation container.",signature:"(id: str, file: str, symbols: list[str])",is_async:false,http:null,external_calls:[],effects:[],in_degree:6,out_degree:1,role:"shared_utility",importance:39.3},
  {id:"rune/models.py::serialize",label:"serialize",type:"function",file:"rune/models.py",line:182,loc:18,doc:null,signature:"(obj: Any) -> dict",is_async:false,http:null,external_calls:["json.dumps"],effects:[],in_degree:7,out_degree:0,role:"shared_utility",importance:34.8},
  {id:"rune/models.py::from_dict",label:"from_dict",type:"function",file:"rune/models.py",line:202,loc:22,doc:"Reconstruct a model instance from a dictionary.",signature:"(cls: type, data: dict) -> Any",is_async:false,http:null,external_calls:[],effects:[],in_degree:5,out_degree:1,role:"shared_utility",importance:31.2},
  {id:"rune/models.py::validate_model",label:"validate_model",type:"function",file:"rune/models.py",line:226,loc:14,doc:null,signature:"(instance: Any) -> bool",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:0,role:"shared_utility",importance:22.6},
  {id:"rune/models.py::RepoMetadata",label:"RepoMetadata",type:"class",file:"rune/models.py",line:242,loc:28,doc:"Extended metadata about a repository (language breakdown, LOC).",signature:"(languages: dict, total_loc: int, file_count: int)",is_async:false,http:null,external_calls:[],effects:[],in_degree:4,out_degree:0,role:"shared_utility",importance:27.4},

  // ── rune/routes/analyze.py (4 symbols) ──
  {id:"rune/routes/analyze.py::analyze_endpoint",label:"analyze_endpoint",type:"function",file:"rune/routes/analyze.py",line:18,loc:32,doc:"HTTP handler for repo analysis requests.",signature:"(request: Request) -> JSONResponse",is_async:true,http:"POST /analyze",external_calls:["json.loads"],effects:["network","filesystem"],in_degree:1,out_degree:5,role:"router",importance:68.5},
  {id:"rune/routes/analyze.py::stream_results",label:"stream_results",type:"function",file:"rune/routes/analyze.py",line:52,loc:44,doc:"SSE endpoint streaming analysis progress.",signature:"(request: Request) -> StreamingResponse",is_async:true,http:"POST /analyze/stream",external_calls:["asyncio.sleep"],effects:["network"],in_degree:1,out_degree:4,role:"router",importance:62.1},
  {id:"rune/routes/analyze.py::validate_repo",label:"validate_repo",type:"function",file:"rune/routes/analyze.py",line:98,loc:16,doc:null,signature:"(url: str) -> bool",is_async:false,http:null,external_calls:["urllib.parse.urlparse"],effects:[],in_degree:2,out_degree:1,role:"router",importance:34.7},
  {id:"rune/routes/analyze.py::format_response",label:"format_response",type:"function",file:"rune/routes/analyze.py",line:116,loc:10,doc:null,signature:"(result: AnalysisResult) -> dict",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:1,role:"router",importance:28.3},

  // ── rune/traversal.py (6 symbols) ──
  {id:"rune/traversal.py::walk_ast",label:"walk_ast",type:"function",file:"rune/traversal.py",line:14,loc:56,doc:"Recursively walk a parsed AST and yield symbol nodes.",signature:"(tree: Tree, file_path: str) -> Iterator[SymbolNode]",is_async:false,http:null,external_calls:[],effects:["filesystem"],in_degree:7,out_degree:3,role:"core_module",importance:75.6},
  {id:"rune/traversal.py::ASTVisitor",label:"ASTVisitor",type:"class",file:"rune/traversal.py",line:72,loc:98,doc:"Stateful visitor pattern for AST traversal.",signature:"(language: str)",is_async:false,http:null,external_calls:[],effects:[],in_degree:4,out_degree:4,role:"core_module",importance:62.3},
  {id:"rune/traversal.py::collect_imports",label:"collect_imports",type:"method",file:"rune/traversal.py",line:112,loc:22,doc:"Collect all import statements from a module.",signature:"(self, tree: Tree) -> list[str]",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:1,role:"core_module",importance:48.1},
  {id:"rune/traversal.py::extract_calls",label:"extract_calls",type:"method",file:"rune/traversal.py",line:136,loc:34,doc:"Find all function/method call sites in an AST.",signature:"(self, tree: Tree) -> list[dict]",is_async:false,http:null,external_calls:[],effects:[],in_degree:3,out_degree:2,role:"core_module",importance:55.4},
  {id:"rune/traversal.py::visit_function_def",label:"visit_function_def",type:"method",file:"rune/traversal.py",line:172,loc:18,doc:null,signature:"(self, node: ASTNode) -> SymbolNode",is_async:false,http:null,external_calls:[],effects:[],in_degree:2,out_degree:1,role:"core_module",importance:38.7},
  {id:"rune/traversal.py::visit_class_def",label:"visit_class_def",type:"method",file:"rune/traversal.py",line:192,loc:20,doc:null,signature:"(self, node: ASTNode) -> SymbolNode",is_async:false,http:null,external_calls:[],effects:[],in_degree:2,out_degree:1,role:"core_module",importance:36.2},

  // ── rune/utils.py (3 symbols) ──
  {id:"rune/utils.py::hash_content",label:"hash_content",type:"function",file:"rune/utils.py",line:8,loc:10,doc:"SHA-256 hash of file content bytes.",signature:"(content: bytes) -> str",is_async:false,http:null,external_calls:["hashlib.sha256"],effects:[],in_degree:8,out_degree:0,role:"shared_utility",importance:58.4},
  {id:"rune/utils.py::normalize_path",label:"normalize_path",type:"function",file:"rune/utils.py",line:20,loc:14,doc:"Normalize a file path relative to repo root.",signature:"(path: str, root: str) -> str",is_async:false,http:null,external_calls:["os.path.relpath","pathlib.PurePosixPath"],effects:[],in_degree:12,out_degree:0,role:"shared_utility",importance:52.1},
  {id:"rune/utils.py::timer",label:"timer",type:"function",file:"rune/utils.py",line:36,loc:18,doc:"Context manager that logs elapsed wall-clock time.",signature:"(label: str) -> ContextManager",is_async:false,http:null,external_calls:["time.perf_counter","logging.info"],effects:[],in_degree:6,out_degree:0,role:"shared_utility",importance:34.9},
],

edges: [
  // ── Intra-file: rune/analyzer.py ──
  {source:"rune/analyzer.py::AnalysisEngine",target:"rune/analyzer.py::SymbolExtractor",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/analyzer.py::analyze_file",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/analyzer.py::merge_results",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/analyzer.py::validate_input",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/analyzer.py::build_call_graph",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/analyzer.py::create_snapshot",label:"calls"},
  {source:"rune/analyzer.py::analyze_file",target:"rune/analyzer.py::SymbolExtractor",label:"calls"},
  {source:"rune/analyzer.py::analyze_file",target:"rune/analyzer.py::extract_symbols",label:"calls"},
  {source:"rune/analyzer.py::build_call_graph",target:"rune/analyzer.py::resolve_references",label:"calls"},
  {source:"rune/analyzer.py::build_call_graph",target:"rune/analyzer.py::compute_importance",label:"calls"},
  {source:"rune/analyzer.py::compute_importance",target:"rune/analyzer.py::rank_symbols",label:"calls"},
  {source:"rune/analyzer.py::create_snapshot",target:"rune/analyzer.py::to_dict",label:"calls"},
  {source:"rune/analyzer.py::from_cache",target:"rune/analyzer.py::AnalysisResult",label:"calls"},
  {source:"rune/analyzer.py::merge_results",target:"rune/analyzer.py::AnalysisResult",label:"calls"},
  {source:"rune/analyzer.py::extract_symbols",target:"rune/analyzer.py::resolve_references",label:"calls"},
  {source:"rune/analyzer.py::AnalysisResult",target:"rune/analyzer.py::to_dict",label:"calls"},
  // ── Intra-file: rune/cache.py ──
  {source:"rune/cache.py::AnalysisCache",target:"rune/cache.py::CacheKey",label:"calls"},
  {source:"rune/cache.py::get_cache",target:"rune/cache.py::build_key",label:"calls"},
  {source:"rune/cache.py::set_cache",target:"rune/cache.py::build_key",label:"calls"},
  {source:"rune/cache.py::invalidate",target:"rune/cache.py::build_key",label:"calls"},
  {source:"rune/cache.py::warm_cache",target:"rune/cache.py::get_cache",label:"calls"},
  {source:"rune/cache.py::warm_cache",target:"rune/cache.py::set_cache",label:"calls"},
  {source:"rune/cache.py::cache_stats",target:"rune/cache.py::AnalysisCache",label:"calls"},
  {source:"rune/cache.py::CacheKey",target:"rune/cache.py::build_key",label:"calls"},
  // ── Intra-file: rune/graph.py ──
  {source:"rune/graph.py::SymbolGraph",target:"rune/graph.py::GraphNode",label:"calls"},
  {source:"rune/graph.py::SymbolGraph",target:"rune/graph.py::add_node",label:"calls"},
  {source:"rune/graph.py::SymbolGraph",target:"rune/graph.py::add_edge",label:"calls"},
  {source:"rune/graph.py::compute_pagerank",target:"rune/graph.py::GraphNode",label:"calls"},
  {source:"rune/graph.py::resolve_edges",target:"rune/graph.py::add_edge",label:"calls"},
  {source:"rune/graph.py::get_connected_components",target:"rune/graph.py::GraphNode",label:"calls"},
  {source:"rune/graph.py::collapse_to_groups",target:"rune/graph.py::SymbolGraph",label:"calls"},
  {source:"rune/graph.py::collapse_to_groups",target:"rune/graph.py::serialize_graph",label:"calls"},
  {source:"rune/graph.py::filter_by_threshold",target:"rune/graph.py::SymbolGraph",label:"calls"},
  // ── Intra-file: rune/classifier.py ──
  {source:"rune/classifier.py::RoleClassifier",target:"rune/classifier.py::classify_role",label:"calls"},
  {source:"rune/classifier.py::classify_role",target:"rune/classifier.py::score_centrality",label:"calls"},
  {source:"rune/classifier.py::classify_role",target:"rune/classifier.py::apply_heuristics",label:"calls"},
  {source:"rune/classifier.py::classify_role",target:"rune/classifier.py::ClassificationResult",label:"calls"},
  {source:"rune/classifier.py::detect_entry_points",target:"rune/classifier.py::classify_role",label:"calls"},
  {source:"rune/classifier.py::merge_classifications",target:"rune/classifier.py::ClassificationResult",label:"calls"},
  // ── Intra-file: rune/traversal.py ──
  {source:"rune/traversal.py::walk_ast",target:"rune/traversal.py::ASTVisitor",label:"calls"},
  {source:"rune/traversal.py::ASTVisitor",target:"rune/traversal.py::visit_function_def",label:"calls"},
  {source:"rune/traversal.py::ASTVisitor",target:"rune/traversal.py::visit_class_def",label:"calls"},
  {source:"rune/traversal.py::collect_imports",target:"rune/traversal.py::ASTVisitor",label:"calls"},
  {source:"rune/traversal.py::extract_calls",target:"rune/traversal.py::ASTVisitor",label:"calls"},
  // ── Inter-file edges ──
  // routes/analyze.py → analyzer
  {source:"rune/routes/analyze.py::analyze_endpoint",target:"rune/analyzer.py::run_analysis",label:"calls"},
  {source:"rune/routes/analyze.py::analyze_endpoint",target:"rune/analyzer.py::validate_input",label:"calls"},
  {source:"rune/routes/analyze.py::analyze_endpoint",target:"rune/cache.py::get_cache",label:"calls"},
  {source:"rune/routes/analyze.py::stream_results",target:"rune/analyzer.py::run_analysis",label:"calls"},
  {source:"rune/routes/analyze.py::stream_results",target:"rune/cache.py::set_cache",label:"calls"},
  {source:"rune/routes/analyze.py::format_response",target:"rune/analyzer.py::to_dict",label:"calls"},
  {source:"rune/routes/analyze.py::validate_repo",target:"rune/utils.py::normalize_path",label:"calls"},
  // analyzer → cache
  {source:"rune/analyzer.py::run_analysis",target:"rune/cache.py::get_cache",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/cache.py::set_cache",label:"calls"},
  {source:"rune/analyzer.py::create_snapshot",target:"rune/cache.py::set_cache",label:"calls"},
  {source:"rune/analyzer.py::from_cache",target:"rune/cache.py::get_cache",label:"calls"},
  // analyzer → graph
  {source:"rune/analyzer.py::build_call_graph",target:"rune/graph.py::SymbolGraph",label:"calls"},
  {source:"rune/analyzer.py::build_call_graph",target:"rune/graph.py::add_node",label:"calls"},
  {source:"rune/analyzer.py::build_call_graph",target:"rune/graph.py::add_edge",label:"calls"},
  {source:"rune/analyzer.py::compute_importance",target:"rune/graph.py::compute_pagerank",label:"calls"},
  {source:"rune/analyzer.py::resolve_references",target:"rune/graph.py::resolve_edges",label:"calls"},
  // analyzer → traversal
  {source:"rune/analyzer.py::analyze_file",target:"rune/traversal.py::walk_ast",label:"calls"},
  {source:"rune/analyzer.py::SymbolExtractor",target:"rune/traversal.py::ASTVisitor",label:"calls"},
  {source:"rune/analyzer.py::extract_symbols",target:"rune/traversal.py::extract_calls",label:"calls"},
  // analyzer → models
  {source:"rune/analyzer.py::AnalysisResult",target:"rune/models.py::SymbolNode",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/models.py::Repository",label:"calls"},
  {source:"rune/analyzer.py::to_dict",target:"rune/models.py::serialize",label:"calls"},
  // analyzer → classifier
  {source:"rune/analyzer.py::run_analysis",target:"rune/classifier.py::RoleClassifier",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/classifier.py::classify_role",label:"calls"},
  // analyzer → utils
  {source:"rune/analyzer.py::analyze_file",target:"rune/utils.py::normalize_path",label:"calls"},
  {source:"rune/analyzer.py::run_analysis",target:"rune/utils.py::timer",label:"calls"},
  {source:"rune/analyzer.py::create_snapshot",target:"rune/utils.py::hash_content",label:"calls"},
  // graph → classifier
  {source:"rune/graph.py::compute_pagerank",target:"rune/classifier.py::score_centrality",label:"calls"},
  // graph → models
  {source:"rune/graph.py::SymbolGraph",target:"rune/models.py::SymbolNode",label:"calls"},
  {source:"rune/graph.py::SymbolGraph",target:"rune/models.py::EdgeRecord",label:"calls"},
  {source:"rune/graph.py::serialize_graph",target:"rune/models.py::serialize",label:"calls"},
  {source:"rune/graph.py::collapse_to_groups",target:"rune/models.py::GroupRecord",label:"calls"},
  // classifier → graph
  {source:"rune/classifier.py::score_centrality",target:"rune/graph.py::SymbolGraph",label:"calls"},
  {source:"rune/classifier.py::detect_entry_points",target:"rune/graph.py::SymbolGraph",label:"calls"},
  // classifier → models
  {source:"rune/classifier.py::classify_role",target:"rune/models.py::SymbolNode",label:"calls"},
  // traversal → models
  {source:"rune/traversal.py::walk_ast",target:"rune/models.py::SymbolNode",label:"calls"},
  {source:"rune/traversal.py::visit_function_def",target:"rune/models.py::SymbolNode",label:"calls"},
  {source:"rune/traversal.py::visit_class_def",target:"rune/models.py::SymbolNode",label:"calls"},
  // cache → models, utils
  {source:"rune/cache.py::warm_cache",target:"rune/models.py::Repository",label:"calls"},
  {source:"rune/cache.py::build_key",target:"rune/utils.py::hash_content",label:"calls"},
  // Inheritance edges
  {source:"rune/analyzer.py::SymbolExtractor",target:"rune/traversal.py::ASTVisitor",label:"inherits"},
  {source:"rune/classifier.py::ClassificationResult",target:"rune/models.py::SymbolNode",label:"inherits"},
  {source:"rune/graph.py::GraphNode",target:"rune/models.py::SymbolNode",label:"inherits"},
],

// ═══════════════════════════════════════════════════════════════════
// OPTIONAL LLM OVERLAY — concepts grounded in real symbols
// ═══════════════════════════════════════════════════════════════════

concepts: {
  entities: [
    {id:"entity:analysis-pipeline",name:"Analysis Pipeline",summary:"Orchestrates the full repo analysis: clone, parse, resolve, rank, cache.",symbols:["rune/analyzer.py::AnalysisEngine","rune/analyzer.py::run_analysis","rune/analyzer.py::analyze_file","rune/analyzer.py::merge_results","rune/analyzer.py::create_snapshot"],files:["rune/analyzer.py","rune/traversal.py"]},
    {id:"entity:caching-layer",name:"Caching Layer",summary:"Redis-backed persistence so a second visit costs nothing.",symbols:["rune/cache.py::AnalysisCache","rune/cache.py::get_cache","rune/cache.py::set_cache","rune/cache.py::warm_cache"],files:["rune/cache.py","rune/storage/redis_store.py"]},
    {id:"entity:symbol-resolution",name:"Symbol Resolution",summary:"Matches call sites to definitions and builds the call graph.",symbols:["rune/graph.py::SymbolGraph","rune/graph.py::resolve_edges","rune/graph.py::compute_pagerank","rune/analyzer.py::resolve_references","rune/analyzer.py::build_call_graph"],files:["rune/graph.py","rune/analyzer.py","rune/indexer.py"]},
    {id:"entity:code-parsing",name:"Code Parsing",summary:"Language-specific AST extraction via tree-sitter wrappers.",symbols:["rune/traversal.py::walk_ast","rune/traversal.py::ASTVisitor","rune/traversal.py::extract_calls"],files:["rune/traversal.py","rune/parsers/python_parser.py","rune/parsers/js_parser.py","rune/parsers/tree_sitter.py","rune/parsers/base_parser.py"]},
    {id:"entity:api-surface",name:"API Surface",summary:"HTTP endpoints exposing analysis and visualization to clients.",symbols:["rune/routes/analyze.py::analyze_endpoint","rune/routes/analyze.py::stream_results"],files:["rune/routes/analyze.py","rune/routes/visualize.py","rune/routes/health.py"]},
    {id:"entity:llm-integration",name:"LLM Integration",summary:"Optional AI enrichment: role classification and concept extraction.",symbols:["rune/classifier.py::RoleClassifier","rune/classifier.py::classify_role"],files:["rune/llm/client.py","rune/llm/prompts.py","rune/llm/embeddings.py","rune/classifier.py"]},
    {id:"entity:data-models",name:"Data Models",summary:"Core domain types shared across the entire codebase.",symbols:["rune/models.py::Repository","rune/models.py::SymbolNode","rune/models.py::EdgeRecord","rune/models.py::GroupRecord"],files:["rune/models.py","rune/schema.py"]},
    {id:"entity:repository-mgmt",name:"Repository Management",summary:"Git operations and storage for cloned source repositories.",symbols:["rune/utils.py::hash_content","rune/utils.py::normalize_path"],files:["rune/storage/git_ops.py","rune/storage/redis_store.py","rune/config.py"]},
  ],
  relations: [
    {source:"entity:api-surface",target:"entity:analysis-pipeline",label:"triggers"},
    {source:"entity:analysis-pipeline",target:"entity:code-parsing",label:"uses"},
    {source:"entity:analysis-pipeline",target:"entity:symbol-resolution",label:"produces"},
    {source:"entity:analysis-pipeline",target:"entity:caching-layer",label:"persists to"},
    {source:"entity:code-parsing",target:"entity:data-models",label:"emits"},
    {source:"entity:symbol-resolution",target:"entity:data-models",label:"consumes"},
    {source:"entity:llm-integration",target:"entity:symbol-resolution",label:"enriches"},
    {source:"entity:llm-integration",target:"entity:caching-layer",label:"caches in"},
    {source:"entity:repository-mgmt",target:"entity:analysis-pipeline",label:"provides"},
    {source:"entity:caching-layer",target:"entity:repository-mgmt",label:"delegates to"},
  ],
  metadata: {
    is_llm_enriched: true,
    chunks: 6,
    dropped_ungrounded: 3,
    fallback_reason: null
  }
},

// ═══════════════════════════════════════════════════════════════════
// METADATA & DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════

metadata: {
  total_symbols: 665,
  total_groups: 47,
  drawn_groups: 25,
  group_selection: "adaptive",
  resolved_calls: 806,
  unresolved_calls: 291,
  is_truncated: true,
  truncated_count: 515,
  unsupported_languages: ["Go","Ruby"]
},

diagnostics: {
  node_count: 150,
  edge_count: 806,
  group_count: 25,
  group_edge_count: 88,
  resolution_rate: 0.735,
  unsupported_languages: ["Go","Ruby"]
}

};

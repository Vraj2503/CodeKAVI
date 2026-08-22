import json
import random

files = [
    "codekavi/main.py", "codekavi/cli.py", "codekavi/config.py",
    "codekavi/routes/api.py", "codekavi/routes/web.py", "codekavi/routes/auth.py",
    "codekavi/models/user.py", "codekavi/models/graph.py", "codekavi/models/node.py",
    "codekavi/models/edge.py", "codekavi/models/db.py",
    "tests/test_main.py", "tests/test_graph.py", "tests/test_parser.py",
    "tests/test_cli.py", "tests/test_utils.py",
    "codekavi/utils/fs.py", "codekavi/utils/logger.py", "codekavi/utils/helpers.py",
    "codekavi/utils/metrics.py", "codekavi/utils/strings.py",
    "codekavi/graph/builder.py", "codekavi/graph/layout.py", "codekavi/graph/traversal.py",
    "codekavi/graph/export.py", "codekavi/graph/optimize.py",
    "codekavi/analyzer/pipeline.py", "codekavi/analyzer/parser.py", "codekavi/analyzer/resolver.py",
    "codekavi/analyzer/visitor.py", "codekavi/analyzer/scope.py",
    "codekavi/indexer/store.py", "codekavi/indexer/cache.py", "codekavi/indexer/query.py",
    "codekavi/indexer/search.py", "codekavi/indexer/sync.py",
    "codekavi/plugins/base.py", "codekavi/plugins/manager.py"
]

nodes = []
kinds = ['function']*106 + ['method']*26 + ['class']*18
roles = ['leaf']*76 + ['internal_helper']*21 + ['test']*16 + ['core_module']*13 + ['shared_utility']*24
random.shuffle(kinds)
random.shuffle(roles)

for i in range(150):
    kind = kinds[i]
    role = roles[i]
    file = random.choice(files)
    if 'tests/' in file:
        role = 'test'
    if kind == 'class':
        name = f"Class{i}"
    elif kind == 'method':
        name = f"Class{i % 18}.method{i}"
    else:
        name = f"function_{i}"
    
    importance = random.uniform(3.0, 15.0)
    if random.random() < 0.1:
        importance = random.uniform(30.0, 52.71)
        
    nodes.append({
        "id": f"n{i}",
        "name": name,
        "kind": kind,
        "role": role,
        "file": file,
        "importance": importance
    })

edges = []
for i in range(117):
    source = random.choice(nodes)['id']
    target = random.choice(nodes)['id']
    while target == source:
        target = random.choice(nodes)['id']
    edges.append({"source": source, "target": target, "type": "call"})

class_nodes = [n for n in nodes if n['kind'] == 'class']
if len(class_nodes) >= 2:
    for i in range(3):
        source = random.choice(class_nodes)['id']
        target = random.choice(class_nodes)['id']
        while target == source:
            target = random.choice(class_nodes)['id']
        edges.append({"source": source, "target": target, "type": "inherits"})


html_content = f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mockup A: File-Clustered Node-Link</title>
    <style>
        :root {{
            --background: 40 30% 96.5%;
            --foreground: 24 14% 10%;
            --card: 42 42% 99%;
            --card-foreground: 24 14% 10%;
            --muted: 38 20% 92.5%;
            --muted-foreground: 28 7% 42%;
            --border: 33 16% 86%;
            --signal: 26 90% 46%;
            --destructive: 0 68% 45%;
            --success: 148 55% 32%;
            --viz-highlight: 26 90% 46%;
            --viz-cat-1: 212 88% 45%;
            --viz-cat-2: 129 54% 30%;
            --viz-cat-3: 266 60% 52%;
            --viz-cat-4: 26 84% 42%;
            --viz-cat-5: 328 66% 46%;
            --viz-cat-6: 209 84% 42%;
            --viz-cat-7: 126 50% 29%;
            --viz-cat-8: 267 52% 50%;
            --viz-cat-ink: 0 0% 100%;
            --viz-surface: 42 42% 99%;
            --viz-ink: 24 14% 10%;
            --viz-ink-dim: 28 7% 42%;
            --viz-edge: 33 16% 86%;
            --radius: 0.5rem;
        }}

        [data-theme="dark"] {{
            --background: 30 9% 6%;
            --foreground: 40 18% 94%;
            --card: 30 8% 9%;
            --card-foreground: 40 18% 94%;
            --muted: 30 6% 14%;
            --muted-foreground: 36 8% 62%;
            --border: 32 7% 19%;
            --signal: 34 96% 56%;
            --destructive: 2 72% 58%;
            --success: 148 52% 52%;
            --viz-highlight: 34 96% 56%;
            --viz-cat-1: 212 100% 67%;
            --viz-cat-2: 129 49% 49%;
            --viz-cat-3: 266 100% 77%;
            --viz-cat-4: 26 85% 59%;
            --viz-cat-5: 328 89% 72%;
            --viz-cat-6: 209 100% 74%;
            --viz-cat-7: 126 50% 45%;
            --viz-cat-8: 267 80% 70%;
            --viz-cat-ink: 0 0% 100%;
            --viz-surface: 30 8% 9%;
            --viz-ink: 40 18% 94%;
            --viz-ink-dim: 36 8% 62%;
            --viz-edge: 32 7% 19%;
        }}

        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }}

        body {{
            background-color: hsl(var(--background));
            color: hsl(var(--foreground));
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }}

        h1, h2, h3, h4 {{ font-weight: 600; }}

        .header {{
            padding: 1rem 1.5rem;
            border-bottom: 1px solid hsl(var(--border));
            background-color: hsl(var(--card));
            z-index: 10;
        }}

        .caption-block {{ margin-bottom: 1rem; }}
        .caption-title {{ font-size: 1.25rem; margin-bottom: 0.5rem; }}
        .caption-text {{ font-size: 0.875rem; color: hsl(var(--muted-foreground)); line-height: 1.5; }}
        
        .banners {{ display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }}
        
        .banner-resolution {{
            background-color: hsl(38 90% 90%);
            color: hsl(38 90% 20%);
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            font-size: 0.875rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        [data-theme="dark"] .banner-resolution {{
            background-color: hsl(38 90% 20%);
            color: hsl(38 90% 90%);
        }}

        .banner-truncation {{
            font-size: 0.875rem;
            color: hsl(var(--muted-foreground));
            padding-left: 0.25rem;
        }}

        .main-content {{ flex: 1; position: relative; display: flex; }}

        .graph-container {{
            flex: 1;
            position: relative;
            overflow: hidden;
            background-image: radial-gradient(hsl(var(--muted-foreground) / 0.3) 1px, transparent 1px);
            background-size: 20px 20px;
            cursor: grab;
        }}
        .graph-container:active {{ cursor: grabbing; }}
        .graph-content {{ position: absolute; transform-origin: 0 0; }}

        .empty-state {{
            display: none;
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: hsl(var(--background));
            z-index: 20;
        }}
        
        .empty-icon {{
            width: 64px; height: 64px; border-radius: 50%;
            background-color: hsl(var(--muted));
            display: flex; align-items: center; justify-content: center;
            margin-bottom: 1rem; color: hsl(var(--muted-foreground));
        }}

        .empty-title {{ font-size: 1.5rem; margin-bottom: 0.5rem; }}
        .empty-text {{ color: hsl(var(--muted-foreground)); max-width: 400px; text-align: center; margin-bottom: 1.5rem; line-height: 1.5; }}
        
        .empty-button {{
            padding: 0.5rem 1rem; background-color: hsl(var(--foreground));
            color: hsl(var(--background)); border: none; border-radius: var(--radius);
            font-weight: 500; cursor: pointer;
        }}

        .detail-panel {{
            position: absolute; top: 0; left: -300px; width: 300px; height: 100%;
            background-color: hsl(var(--card)); border-right: 1px solid hsl(var(--border));
            transition: left 0.3s ease; z-index: 100; padding: 1.5rem;
            box-shadow: 4px 0 15px rgba(0,0,0,0.05);
            display: flex; flex-direction: column; gap: 1rem;
        }}
        .detail-panel.open {{ left: 0; }}
        .panel-close {{ position: absolute; top: 1rem; right: 1rem; cursor: pointer; color: hsl(var(--muted-foreground)); }}
        .detail-item {{ display: flex; flex-direction: column; gap: 0.25rem; }}
        .detail-label {{ font-size: 0.75rem; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.05em; }}
        .detail-value {{ font-size: 0.875rem; }}

        .controls {{ position: absolute; bottom: 1.5rem; right: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem; z-index: 10; }}
        .control-btn {{
            width: 32px; height: 32px; background-color: hsl(var(--card));
            border: 1px solid hsl(var(--border)); border-radius: var(--radius);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: hsl(var(--foreground));
        }}
        .control-btn:hover {{ background-color: hsl(var(--muted)); }}

        .legend {{
            position: absolute; bottom: 1.5rem; left: 1.5rem; background-color: hsl(var(--card));
            border: 1px solid hsl(var(--border)); border-radius: var(--radius);
            padding: 1rem; z-index: 10; font-size: 0.75rem;
            display: flex; flex-direction: column; gap: 0.75rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }}
        .legend-row {{ display: flex; align-items: center; gap: 0.5rem; }}
        .legend-shape {{ width: 12px; height: 12px; background-color: hsl(var(--viz-ink-dim)); }}
        .legend-circle {{ border-radius: 50%; }}
        .legend-rect {{ border-radius: 2px; }}
        .legend-diamond {{ transform: rotate(45deg); width: 10px; height: 10px; margin: 0 1px; }}

        .top-actions {{ position: absolute; top: 1rem; right: 1.5rem; display: flex; gap: 1rem; z-index: 20; }}
        .action-btn {{
            padding: 0.5rem 1rem; background-color: hsl(var(--card)); border: 1px solid hsl(var(--border));
            border-radius: var(--radius); cursor: pointer; color: hsl(var(--foreground)); font-size: 0.875rem;
        }}
        .action-btn:hover {{ background-color: hsl(var(--muted)); }}

        .file-cluster {{ fill: hsl(var(--card) / 0.5); stroke: hsl(var(--border)); stroke-width: 2; stroke-dasharray: 4 4; rx: 8; ry: 8; }}
        .cluster-label {{ font-size: 10px; fill: hsl(var(--muted-foreground)); font-family: monospace; }}

        .node {{ fill: hsl(var(--viz-ink-dim)); stroke: hsl(var(--background)); stroke-width: 1.5; cursor: pointer; transition: fill 0.2s; }}
        .node:hover, .node.highlighted {{ fill: hsl(var(--viz-highlight)); }}

        .edge {{ stroke: hsl(var(--viz-edge)); fill: none; stroke-width: 1; transition: stroke 0.2s, stroke-width 0.2s; }}
        .edge.inherits {{ stroke-width: 3; stroke-dasharray: none; }}
        .edge.inherits-inner {{ stroke: hsl(var(--background)); stroke-width: 1; fill: none; }}
        .edge.highlighted {{ stroke: hsl(var(--viz-highlight)); stroke-width: 2; z-index: 10; }}
        .edge.inherits.highlighted {{ stroke: hsl(var(--viz-highlight)); stroke-width: 4; }}
        
        .faded {{ opacity: 0.15; transition: opacity 0.2s; }}
    </style>
</head>
<body>
    <div class="top-actions">
        <button class="action-btn" id="emptyStateToggle">Show Empty State</button>
        <button class="action-btn" id="themeToggle">Toggle Dark Mode</button>
    </div>

    <div class="header">
        <div class="caption-block">
            <h1 class="caption-title">Mockup A: File-Clustered Node-Link</h1>
            <p class="caption-text">
                <strong>Organizing idea:</strong> Nodes are grouped into file clusters. Each cluster shows the filename. Within clusters, nodes are positioned by a simple force simulation. Edges connect nodes across and within clusters.<br>
                <strong>Problems prioritized:</strong> 1. Layout (File clusters), 4. Encoding (Shape=kind, Size=importance, Color=neutral), 2. Resolution rate (Banner), 3. Truncation (Banner text), 5. Inheritance (Double-line edge).<br>
                <strong>React Flow compatibility:</strong> Renderable by ArchitectureGraph with modifications: file clusters as group nodes, symbol nodes as a new custom node type.
            </p>
        </div>
        <div class="banners">
            <div class="banner-resolution">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                29% of call sites resolved · 71% of calls could not be traced to a definition and are not shown
            </div>
            <div class="banner-truncation">
                Showing top 150 of 657 symbols by connectivity · 488 symbols with low connectivity are hidden
            </div>
        </div>
    </div>

    <div class="main-content">
        <div class="detail-panel" id="detailPanel">
            <div class="panel-close" id="closePanel">✕</div>
            <h3 id="panelName">Symbol Name</h3>
            <div class="detail-item">
                <span class="detail-label">Kind</span>
                <span class="detail-value" id="panelKind">function</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">File</span>
                <span class="detail-value" id="panelFile">file.py</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Role</span>
                <span class="detail-value" id="panelRole">leaf</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Importance</span>
                <span class="detail-value" id="panelImportance">10.5</span>
            </div>
        </div>

        <div class="empty-state" id="emptyState">
            <div class="empty-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </div>
            <h2 class="empty-title">No symbols to display</h2>
            <p class="empty-text">This repository uses languages that CodeKavi doesn't parse for symbol-level analysis yet. The file-level architecture view is still available.</p>
            <button class="empty-button">View Architecture →</button>
        </div>

        <div class="graph-container" id="graphContainer">
            <div class="graph-content" id="graphContent">
                <svg id="graphSvg" width="4000" height="4000">
                    <g id="edgeGroup"></g>
                    <g id="clusterGroup"></g>
                    <g id="nodeGroup"></g>
                </svg>
            </div>
        </div>

        <div class="legend">
            <div class="legend-row">
                <div class="legend-shape legend-circle"></div>
                <span>Function</span>
            </div>
            <div class="legend-row">
                <div class="legend-shape legend-rect"></div>
                <span>Class</span>
            </div>
            <div class="legend-row">
                <div class="legend-shape legend-diamond"></div>
                <span>Method</span>
            </div>
            <div class="legend-row">
                <span>Size = Importance</span>
            </div>
        </div>

        <div class="controls">
            <div class="control-btn" id="zoomIn">+</div>
            <div class="control-btn" id="zoomOut">-</div>
            <div class="control-btn" id="zoomFit">□</div>
        </div>
    </div>

    <script>
        const nodesData = {json.dumps(nodes)};
        const edgesData = {json.dumps(edges)};
        const files = {json.dumps(files)};
        
        const nodesByFile = {{}};
        files.forEach(f => nodesByFile[f] = []);
        nodesData.forEach(n => {{
            if(nodesByFile[n.file]) nodesByFile[n.file].push(n);
        }});
        
        const COLS = 6;
        const PADDING = 40;
        const clusterLayout = {{}};
        
        let currentX = 50;
        let currentY = 50;
        let maxRowH = 0;
        
        const sortedFiles = Object.keys(nodesByFile).sort((a, b) => {{
            const impA = nodesByFile[a].reduce((sum, n) => sum + n.importance, 0);
            const impB = nodesByFile[b].reduce((sum, n) => sum + n.importance, 0);
            return impB - impA;
        }});

        let colIdx = 0;
        sortedFiles.forEach(file => {{
            const fNodes = nodesByFile[file];
            if (fNodes.length === 0) return;
            
            const area = fNodes.length * 2000; 
            const side = Math.max(120, Math.sqrt(area));
            
            clusterLayout[file] = {{
                x: currentX,
                y: currentY,
                w: side,
                h: side
            }};
            
            fNodes.forEach(n => {{
                const r = 6 + ((n.importance - 3) / 50) * 18;
                n.r = Math.max(6, Math.min(24, r));
                n.x = currentX + 20 + Math.random() * (side - 40);
                n.y = currentY + 30 + Math.random() * (side - 60);
            }});
            
            currentX += side + PADDING;
            maxRowH = Math.max(maxRowH, side);
            
            colIdx++;
            if (colIdx >= COLS) {{
                colIdx = 0;
                currentX = 50;
                currentY += maxRowH + PADDING;
                maxRowH = 0;
            }}
        }});
        
        const svg = document.getElementById('graphSvg');
        const clusterGroup = document.getElementById('clusterGroup');
        const nodeGroup = document.getElementById('nodeGroup');
        const edgeGroup = document.getElementById('edgeGroup');
        
        Object.keys(clusterLayout).forEach(file => {{
            const layout = clusterLayout[file];
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute('x', layout.x);
            rect.setAttribute('y', layout.y);
            rect.setAttribute('width', layout.w);
            rect.setAttribute('height', layout.h);
            rect.setAttribute('class', 'file-cluster');
            
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute('x', layout.x + 10);
            text.setAttribute('y', layout.y + 20);
            text.setAttribute('class', 'cluster-label');
            text.textContent = file;

            const countText = document.createElementNS("http://www.w3.org/2000/svg", "text");
            countText.setAttribute('x', layout.x + layout.w - 10);
            countText.setAttribute('y', layout.y + 20);
            countText.setAttribute('class', 'cluster-label');
            countText.setAttribute('text-anchor', 'end');
            countText.textContent = nodesByFile[file].length;
            
            g.appendChild(rect);
            g.appendChild(text);
            g.appendChild(countText);
            clusterGroup.appendChild(g);
        }});
        
        const nodeMap = {{}};
        
        nodesData.forEach(n => {{
            if (!n.x) return;
            nodeMap[n.id] = n;
            
            const el = document.createElementNS("http://www.w3.org/2000/svg", 
                n.kind === 'function' ? 'circle' : (n.kind === 'class' ? 'rect' : 'polygon')
            );
            
            el.setAttribute('class', 'node');
            el.setAttribute('data-id', n.id);
            
            if (n.kind === 'function') {{
                el.setAttribute('cx', n.x);
                el.setAttribute('cy', n.y);
                el.setAttribute('r', n.r);
            }} else if (n.kind === 'class') {{
                el.setAttribute('x', n.x - n.r);
                el.setAttribute('y', n.y - n.r);
                el.setAttribute('width', n.r * 2);
                el.setAttribute('height', n.r * 2);
                el.setAttribute('rx', 4);
                el.setAttribute('ry', 4);
            }} else {{
                const s = n.r * 1.4;
                el.setAttribute('points', `${{n.x}},${{n.y - s}} ${{n.x + s}},${{n.y}} ${{n.x}},${{n.y + s}} ${{n.x - s}},${{n.y}}`);
            }}
            
            nodeGroup.appendChild(el);
            n.el = el;
        }});
        
        edgesData.forEach(e => {{
            const source = nodeMap[e.source];
            const target = nodeMap[e.target];
            if (!source || !target) return;
            
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute('class', `edge ${{e.type === 'inherits' ? 'inherits' : ''}}`);
            path.setAttribute('data-source', e.source);
            path.setAttribute('data-target', e.target);
            
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dr = Math.sqrt(dx * dx + dy * dy);
            
            const d = `M${{source.x}},${{source.y}} A${{dr}},${{dr}} 0 0,1 ${{target.x}},${{target.y}}`;
            path.setAttribute('d', d);
            
            edgeGroup.appendChild(path);
            e.el = path;

            if (e.type === 'inherits') {{
                const innerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                innerPath.setAttribute('class', 'edge inherits-inner');
                innerPath.setAttribute('d', d);
                edgeGroup.appendChild(innerPath);
                e.innerEl = innerPath;
            }}
        }});
        
        const detailPanel = document.getElementById('detailPanel');
        
        nodeGroup.addEventListener('mouseover', e => {{
            if (e.target.classList.contains('node')) {{
                const id = e.target.getAttribute('data-id');
                const relatedNodes = new Set([id]);
                
                edgesData.forEach(edge => {{
                    if (edge.source === id || edge.target === id) {{
                        relatedNodes.add(edge.source);
                        relatedNodes.add(edge.target);
                        if(edge.el) edge.el.classList.add('highlighted');
                        if(edge.innerEl) edge.innerEl.classList.add('highlighted');
                    }} else {{
                        if(edge.el) edge.el.classList.add('faded');
                        if(edge.innerEl) edge.innerEl.classList.add('faded');
                    }}
                }});
                
                nodesData.forEach(n => {{
                    if (n.el) {{
                        if (relatedNodes.has(n.id)) {{
                            n.el.classList.add('highlighted');
                            n.el.classList.remove('faded');
                        }} else {{
                            n.el.classList.add('faded');
                            n.el.classList.remove('highlighted');
                        }}
                    }}
                }});
                
                clusterGroup.classList.add('faded');
            }}
        }});
        
        nodeGroup.addEventListener('mouseout', e => {{
            if (e.target.classList.contains('node')) {{
                edgesData.forEach(edge => {{
                    if(edge.el) {{
                        edge.el.classList.remove('highlighted');
                        edge.el.classList.remove('faded');
                    }}
                    if(edge.innerEl) {{
                        edge.innerEl.classList.remove('highlighted');
                        edge.innerEl.classList.remove('faded');
                    }}
                }});
                nodesData.forEach(n => {{
                    if (n.el) {{
                        n.el.classList.remove('highlighted');
                        n.el.classList.remove('faded');
                    }}
                }});
                clusterGroup.classList.remove('faded');
            }}
        }});
        
        nodeGroup.addEventListener('click', e => {{
            if (e.target.classList.contains('node')) {{
                const id = e.target.getAttribute('data-id');
                const n = nodeMap[id];
                
                document.getElementById('panelName').textContent = n.name;
                document.getElementById('panelKind').textContent = n.kind;
                document.getElementById('panelFile').textContent = n.file;
                document.getElementById('panelRole').textContent = n.role;
                document.getElementById('panelImportance').textContent = n.importance.toFixed(2);
                
                detailPanel.classList.add('open');
            }}
        }});
        
        document.getElementById('closePanel').addEventListener('click', () => {{
            detailPanel.classList.remove('open');
        }});
        
        let scale = 1;
        let panX = 0;
        let panY = 0;
        let isDragging = false;
        let startX, startY;
        
        const graphContent = document.getElementById('graphContent');
        const container = document.getElementById('graphContainer');
        
        function updateTransform() {{
            graphContent.style.transform = `translate(${{panX}}px, ${{panY}}px) scale(${{scale}})`;
        }}
        
        container.addEventListener('mousedown', e => {{
            if(e.button !== 0) return;
            isDragging = true;
            startX = e.clientX - panX;
            startY = e.clientY - panY;
        }});
        
        window.addEventListener('mousemove', e => {{
            if (!isDragging) return;
            panX = e.clientX - startX;
            panY = e.clientY - startY;
            updateTransform();
        }});
        
        window.addEventListener('mouseup', () => {{
            isDragging = false;
        }});
        
        container.addEventListener('wheel', e => {{
            e.preventDefault();
            const xs = (e.clientX - panX) / scale;
            const ys = (e.clientY - panY) / scale;
            
            const delta = -e.deltaY;
            (delta > 0) ? (scale *= 1.1) : (scale /= 1.1);
            scale = Math.max(0.1, Math.min(scale, 10));
            
            panX = e.clientX - xs * scale;
            panY = e.clientY - ys * scale;
            
            updateTransform();
        }}, {{passive: false}});
        
        document.getElementById('zoomIn').addEventListener('click', () => {{
            scale *= 1.2;
            updateTransform();
        }});
        
        document.getElementById('zoomOut').addEventListener('click', () => {{
            scale /= 1.2;
            updateTransform();
        }});
        
        document.getElementById('zoomFit').addEventListener('click', () => {{
            scale = 0.5;
            panX = 100;
            panY = 100;
            updateTransform();
        }});
        
        document.getElementById('themeToggle').addEventListener('click', () => {{
            const html = document.documentElement;
            if (html.getAttribute('data-theme') === 'dark') {{
                html.setAttribute('data-theme', 'light');
            }} else {{
                html.setAttribute('data-theme', 'dark');
            }}
        }});
        
        const emptyState = document.getElementById('emptyState');
        let emptyStateVisible = false;
        document.getElementById('emptyStateToggle').addEventListener('click', (e) => {{
            emptyStateVisible = !emptyStateVisible;
            if(emptyStateVisible) {{
                emptyState.style.display = 'flex';
                e.target.textContent = 'Hide Empty State';
            }} else {{
                emptyState.style.display = 'none';
                e.target.textContent = 'Show Empty State';
            }}
        }});
        
        setTimeout(() => {{
            scale = 0.4;
            panX = 100;
            panY = 100;
            updateTransform();
        }}, 100);
    </script>
</body>
</html>
"""

with open("/Applications/Projects/CodeKavi/frontend/mockups/knowledge-graph-mockup-A.html", "w") as f:
    f.write(html_content)

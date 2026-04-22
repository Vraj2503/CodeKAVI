/**
 * CodeKavi — Frontend Logic
 *
 * Handles:
 *  1. Submitting a GitHub URL to the backend
 *  2. Tab switching (Overview / Dependency Graph / Module Graph)
 *  3. Rendering overview (file tree, language bars, role chips)
 *  4. Rendering interactive Cytoscape dependency graph
 *  5. Rendering module-level graph
 *  6. Cycle warning banner
 *  7. Node info sidebar
 */

const API_BASE = "http://localhost:8000/api";

// ── Role metadata (must match graph.py _ROLE_COLORS) ──
const ROLE_META = {
    entry_point:     { color: "#34d399", label: "Entry Point" },
    orchestrator:    { color: "#fbbf24", label: "Orchestrator" },
    core_module:     { color: "#a78bfa", label: "Core Module" },
    shared_utility:  { color: "#06b6d4", label: "Shared Utility" },
    internal_helper: { color: "#8b95a5", label: "Internal Helper" },
    router:          { color: "#f472b6", label: "Router" },
    config:          { color: "#fb923c", label: "Config" },
    test:            { color: "#94a3b8", label: "Test" },
    type_definition: { color: "#818cf8", label: "Type Definition" },
    leaf:            { color: "#64748b", label: "Leaf" },
    barrel:          { color: "#7dd3fc", label: "Barrel" },
    documentation:   { color: "#a1a1aa", label: "Documentation" },
    build:           { color: "#78716c", label: "Build" },
    data:            { color: "#d4d4d8", label: "Data" },
    unknown:         { color: "#475569", label: "Unknown" },
};

// ── State ──
let currentData = null;
let cyGraph = null;
let cyModule = null;
let cycleNodeIds = new Set();
let mermaidText = "";
let currentRepoId = null;

// ── DOM refs ──
const form       = document.getElementById("analyze-form");
const urlInput   = document.getElementById("github-url");
const analyzeBtn = document.getElementById("analyze-btn");
const btnText    = analyzeBtn.querySelector(".btn-text");
const btnLoader  = analyzeBtn.querySelector(".btn-loader");
const errorMsg   = document.getElementById("error-msg");
const resultsEl  = document.getElementById("results-section");


// ══════════════════════════════════════════
// FORM SUBMIT
// ══════════════════════════════════════════

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    setLoading(true);
    hideError();
    resultsEl.classList.add("hidden");
    destroyGraphs();

    try {
        const res = await fetch(`${API_BASE}/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ github_url: url }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.detail || data.error || "Analysis failed");

        currentData = data;
        currentRepoId = data.repo_id;
        renderResults(data);
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
});


// ══════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
    });
});

function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    const content = document.getElementById(`tab-content-${tab}`);
    if (content) content.classList.add("active");

    // Init graphs lazily when their tab is first opened
    if (tab === "dep-graph" && cyGraph === null && currentData) {
        initDependencyGraph(currentData);
    }
    if (tab === "module-graph" && cyModule === null && currentData) {
        initModuleGraph(currentData);
    }
}


// ══════════════════════════════════════════
// MAIN RENDER
// ══════════════════════════════════════════

function renderResults(data) {
    // Stats bar
    document.getElementById("stat-repo-name").textContent  = `${data.owner}/${data.repo_name}`;
    document.getElementById("stat-total-files").textContent = data.total_files;
    document.getElementById("stat-total-size").textContent  = data.total_size_formatted;
    document.getElementById("stat-languages").textContent   = Object.keys(data.languages || {}).length;

    const graphMeta = data.graph?.metadata || {};
    document.getElementById("stat-graph-edges").textContent = graphMeta.total_edges ?? "—";
    document.getElementById("tab-badge-nodes").textContent  = graphMeta.total_nodes  ?? "—";

    // Store mermaid for copy button
    mermaidText = data.mermaid?.file_level || "";

    // Overview tab content
    const fileTreeEl = document.getElementById("file-tree");
    fileTreeEl.innerHTML = "";
    renderTree(data.tree || [], fileTreeEl);
    renderLanguages(data.languages || {});
    renderRoleChips(data.file_profiles || []);

    // Cycle banner
    renderCycleBanner(data.cycles);

    // Switch to overview tab and show results
    switchTab("overview");
    resultsEl.classList.remove("hidden");
}


// ══════════════════════════════════════════
// OVERVIEW — File Tree
// ══════════════════════════════════════════

function renderTree(nodes, container) {
    nodes.forEach((node) => {
        if (node.type === "dir") {
            const toggle = document.createElement("div");
            toggle.className = "tree-toggle";
            toggle.innerHTML = `
                <div class="tree-item dir">
                    <span class="chevron">▼</span>
                    <span class="icon">📁</span>
                    <span class="name">${escapeHtml(node.name)}</span>
                </div>`;
            toggle.addEventListener("click", () => toggle.classList.toggle("collapsed"));

            const children = document.createElement("div");
            children.className = "tree-children";
            renderTree(node.children || [], children);

            container.appendChild(toggle);
            container.appendChild(children);
        } else {
            const item = document.createElement("div");
            item.className = "tree-item file";
            item.innerHTML = `
                <span class="icon">${fileIcon(node.language)}</span>
                <span class="name">${escapeHtml(node.name)}</span>
                <span class="size">${node.size_formatted}</span>`;
            container.appendChild(item);
        }
    });
}


// ══════════════════════════════════════════
// OVERVIEW — Language Bars
// ══════════════════════════════════════════

function renderLanguages(languages) {
    const el = document.getElementById("lang-bars");
    el.innerHTML = "";
    const max = Math.max(...Object.values(languages), 1);

    Object.entries(languages).forEach(([lang, count]) => {
        const pct = (count / max) * 100;
        const row = document.createElement("div");
        row.className = "lang-row";
        row.innerHTML = `
            <span class="lang-name" title="${lang}">${lang}</span>
            <div class="lang-bar-bg">
                <div class="lang-bar-fill" style="width: 0%"></div>
            </div>
            <span class="lang-count">${count}</span>`;
        el.appendChild(row);
        requestAnimationFrame(() => {
            row.querySelector(".lang-bar-fill").style.width = `${pct}%`;
        });
    });
}


// ══════════════════════════════════════════
// OVERVIEW — Role Chips
// ══════════════════════════════════════════

function renderRoleChips(profiles) {
    const el = document.getElementById("role-chips");
    el.innerHTML = "";

    const counts = {};
    profiles.forEach(p => {
        const role = p.role || "unknown";
        counts[role] = (counts[role] || 0) + 1;
    });

    Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([role, count]) => {
            const meta = ROLE_META[role] || ROLE_META.unknown;
            const chip = document.createElement("div");
            chip.className = "role-chip";
            chip.style.background = hexToRgba(meta.color, 0.12);
            chip.style.borderColor = hexToRgba(meta.color, 0.3);
            chip.style.color = meta.color;
            chip.innerHTML = `
                <span class="dot" style="background:${meta.color}"></span>
                ${meta.label} <strong style="opacity:0.7;font-size:0.68rem;margin-left:2px">${count}</strong>`;
            el.appendChild(chip);
        });
}


// ══════════════════════════════════════════
// CYCLE WARNING BANNER
// ══════════════════════════════════════════

function renderCycleBanner(cycles) {
    const banner = document.getElementById("cycle-banner");
    const text   = document.getElementById("cycle-banner-text");

    if (!cycles || !cycles.has_cycles) {
        banner.classList.add("hidden");
        return;
    }

    text.textContent = cycles.summary;
    banner.classList.remove("hidden");

    // Collect cycle node IDs for highlighting
    cycleNodeIds = new Set();
    (cycles.cycles || []).forEach(cycle => {
        cycle.forEach(node => cycleNodeIds.add(node));
    });

    document.getElementById("cycle-highlight-btn").onclick = () => {
        switchTab("dep-graph");
        setTimeout(() => highlightCycleNodes(), 300);
    };
}

function highlightCycleNodes() {
    if (!cyGraph) return;
    // Flash cycle nodes with a highlighted color
    cyGraph.nodes().forEach(node => {
        if (cycleNodeIds.has(node.id())) {
            node.animate({ style: { "border-width": 3, "border-color": "#fb7185", "border-style": "solid" } }, { duration: 200 });
        }
    });
    cyGraph.fit(cyGraph.nodes().filter(n => cycleNodeIds.has(n.id())), 80);
}


// ══════════════════════════════════════════
// DEPENDENCY GRAPH (Cytoscape)
// ══════════════════════════════════════════

function initDependencyGraph(data) {
    const nodes = data.graph?.nodes || [];
    const edges = data.graph?.edges || [];

    if (nodes.length === 0) {
        document.getElementById("cy-graph").innerHTML = '<div class="no-graph-msg">No local dependencies detected.</div>';
        return;
    }

    const elements = [];

    // Update stats badges
    document.getElementById("graph-node-count").textContent = `${nodes.length} nodes`;
    document.getElementById("graph-edge-count").textContent = `${edges.length} edges`;

    nodes.forEach(n => {
        const meta = ROLE_META[n.role] || ROLE_META.unknown;
        const size = importanceToSize(n.importance || 0);
        elements.push({
            data: {
                id: n.id,
                label: n.label,
                role: n.role,
                role_label: n.role_label,
                color: meta.color,
                size,
                importance: n.importance || 0,
                language: n.language || "Unknown",
                in_degree: n.in_degree || 0,
                out_degree: n.out_degree || 0,
                group: n.group,
                is_cycle_node: cycleNodeIds.has(n.id),
            }
        });
    });

    edges.forEach((e, i) => {
        elements.push({
            data: {
                id: `e${i}`,
                source: e.source,
                target: e.target,
                type: e.type || "import",
            }
        });
    });

    if (cyGraph) cyGraph.destroy();

    cyGraph = cytoscape({
        container: document.getElementById("cy-graph"),
        elements,
        style: cytoscapeStyles(),
        layout: dagreLayout(),
        minZoom: 0.1,
        maxZoom: 4,
        wheelSensitivity: 0.3,
    });

    // Node click → sidebar
    cyGraph.on("tap", "node", (evt) => {
        showNodeSidebar(evt.target, data.file_profiles || []);
    });
    // Click on bg → close sidebar
    cyGraph.on("tap", (evt) => {
        if (evt.target === cyGraph) hideSidebar();
    });

    // Build legend
    buildLegend(nodes);

    // Layout buttons
    document.getElementById("layout-dagre").addEventListener("click", () => {
        setActiveLayout("dagre");
        cyGraph.layout(dagreLayout()).run();
    });
    document.getElementById("layout-cose").addEventListener("click", () => {
        setActiveLayout("cose");
        cyGraph.layout(coseLayout()).run();
    });

    // Fit button
    document.getElementById("btn-fit").addEventListener("click", () => {
        cyGraph.fit(undefined, 40);
    });

    // Copy Mermaid button
    document.getElementById("btn-copy-mermaid").addEventListener("click", () => {
        if (!mermaidText) return;
        navigator.clipboard.writeText(mermaidText).then(() => {
            const btn = document.getElementById("btn-copy-mermaid");
            btn.textContent = "✓ Copied!";
            btn.classList.add("copied");
            setTimeout(() => {
                btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Mermaid`;
                btn.classList.remove("copied");
            }, 2000);
        });
    });
}

function cytoscapeStyles() {
    return [
        {
            selector: "node",
            style: {
                "label": "data(label)",
                "width": "data(size)",
                "height": "data(size)",
                "background-color": "data(color)",
                "color": "#ffffff",
                "font-size": 11,
                "font-family": "JetBrains Mono, monospace",
                "text-valign": "bottom",
                "text-halign": "center",
                "text-margin-y": 6,
                "text-outline-width": 2,
                "text-outline-color": "#0b0e14",
                "border-width": 0,
                "transition-property": "background-color, border-width, border-color, width, height",
                "transition-duration": "0.2s",
            }
        },
        {
            selector: "node[?is_cycle_node]",
            style: {
                "border-width": 2,
                "border-color": "#fb7185",
                "border-style": "dashed",
            }
        },
        {
            selector: "node:selected",
            style: {
                "border-width": 2.5,
                "border-color": "#ffffff",
                "border-style": "solid",
            }
        },
        {
            selector: "node:active",
            style: { "overlay-opacity": 0 }
        },
        {
            selector: "edge",
            style: {
                "width": 1.5,
                "line-color": "rgba(255,255,255,0.12)",
                "target-arrow-color": "rgba(255,255,255,0.2)",
                "target-arrow-shape": "triangle",
                "curve-style": "bezier",
                "arrow-scale": 0.8,
                "transition-property": "line-color, width",
                "transition-duration": "0.15s",
            }
        },
        {
            selector: "edge:selected",
            style: {
                "line-color": "rgba(167, 139, 250, 0.6)",
                "target-arrow-color": "rgba(167, 139, 250, 0.8)",
                "width": 2.5,
            }
        },
        // Dim non-neighbors on hover
        {
            selector: ".dimmed",
            style: { "opacity": 0.2 }
        },
        {
            selector: ".highlighted",
            style: { "opacity": 1 }
        }
    ];
}

// Hover: dim other nodes
function setupHoverBehavior(cy) {
    cy.on("mouseover", "node", (evt) => {
        const node = evt.target;
        const neighborhood = node.neighborhood().add(node);
        cy.elements().addClass("dimmed");
        neighborhood.removeClass("dimmed").addClass("highlighted");
    });
    cy.on("mouseout", "node", () => {
        cy.elements().removeClass("dimmed highlighted");
    });
}

function dagreLayout() {
    return {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 60,
        rankSep: 80,
        edgeSep: 10,
        animate: true,
        animationDuration: 400,
        fit: true,
        padding: 40,
    };
}

function coseLayout() {
    return {
        name: "cose",
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 40,
        nodeRepulsion: 8000,
        idealEdgeLength: 100,
        edgeElasticity: 100,
        gravity: 1,
        randomize: false,
    };
}

function setActiveLayout(name) {
    document.getElementById("layout-dagre").classList.toggle("active", name === "dagre");
    document.getElementById("layout-cose").classList.toggle("active", name === "cose");
}

function importanceToSize(score) {
    // Map 0–100 importance to 28–72px node diameter
    return Math.round(28 + (score / 100) * 44);
}

function buildLegend(nodes) {
    const legendEl = document.getElementById("legend-items");
    legendEl.innerHTML = "";

    const usedRoles = new Set(nodes.map(n => n.role).filter(Boolean));
    Object.entries(ROLE_META).forEach(([role, meta]) => {
        if (!usedRoles.has(role)) return;
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `
            <span class="legend-dot" style="background:${meta.color}"></span>
            <span>${meta.label}</span>`;
        legendEl.appendChild(item);
    });
}


// ══════════════════════════════════════════
// NODE SIDEBAR
// ══════════════════════════════════════════

function showNodeSidebar(node, fileProfiles) {
    const sidebar = document.getElementById("node-sidebar");
    const content = document.getElementById("sidebar-content");

    const id = node.id();
    const data = node.data();
    const meta = ROLE_META[data.role] || ROLE_META.unknown;

    // Find full profile for dep list
    const profile = fileProfiles.find(p => p.path === id) || {};
    const dependsOn = profile.depends_on || [];
    const usedBy    = profile.used_by    || [];

    const depListHtml = dependsOn.length
        ? dependsOn.map(d => `<li title="${escapeHtml(d)}">→ ${escapeHtml(d)}</li>`).join("")
        : `<li class="sidebar-empty">No outgoing dependencies</li>`;

    const usedByHtml = usedBy.length
        ? usedBy.map(u => `<li title="${escapeHtml(u)}">← ${escapeHtml(u)}</li>`).join("")
        : `<li class="sidebar-empty">Not imported by any file</li>`;

    content.innerHTML = `
        <div class="sidebar-file-name">${escapeHtml(id)}</div>

        <div class="sidebar-role-badge"
             style="background:${hexToRgba(meta.color, 0.15)};
                    border-color:${hexToRgba(meta.color, 0.35)};
                    color:${meta.color}">
            <span style="width:7px;height:7px;border-radius:50%;background:${meta.color};display:inline-block"></span>
            ${escapeHtml(meta.label)}
        </div>

        <div class="sidebar-section">
            <div class="sidebar-section-title">Language</div>
            <div style="font-size:0.8rem;color:var(--text-secondary)">${escapeHtml(data.language)}</div>
        </div>

        <div class="sidebar-section">
            <div class="sidebar-section-title">Importance</div>
            <div class="sidebar-importance">
                <div class="importance-bar-bg">
                    <div class="importance-bar-fill" style="width:${data.importance}%"></div>
                </div>
                <span class="importance-value">${data.importance}/100</span>
            </div>
        </div>

        <div class="sidebar-section">
            <div class="sidebar-section-title">Connectivity</div>
            <div style="font-size:0.78rem;color:var(--text-muted);display:flex;gap:1rem;margin-top:4px">
                <span>↑ In: <strong style="color:var(--text-secondary)">${data.in_degree}</strong></span>
                <span>↓ Out: <strong style="color:var(--text-secondary)">${data.out_degree}</strong></span>
            </div>
        </div>

        <div class="sidebar-section">
            <div class="sidebar-section-title">Depends on (${dependsOn.length})</div>
            <ul class="sidebar-dep-list">${depListHtml}</ul>
        </div>

        <div class="sidebar-section">
            <div class="sidebar-section-title">Used by (${usedBy.length})</div>
            <ul class="sidebar-dep-list">${usedByHtml}</ul>
        </div>`;

    sidebar.classList.remove("hidden");
}

function hideSidebar() {
    document.getElementById("node-sidebar").classList.add("hidden");
}

document.getElementById("sidebar-close").addEventListener("click", hideSidebar);


// ══════════════════════════════════════════
// MODULE GRAPH (Cytoscape)
// ══════════════════════════════════════════

function initModuleGraph(data) {
    const json = data.module_graph?.graph_json || { nodes: [], edges: [] };
    const nodes = json.nodes || [];
    const edges = json.edges || [];

    if (nodes.length === 0) {
        document.getElementById("cy-module").innerHTML = '<div class="no-graph-msg">No modules detected.</div>';
        return;
    }

    const elements = [];

    nodes.forEach(mod => {
        const maxFiles = Math.max(...nodes.map(m => m.file_count), 1);
        const size = 50 + (mod.file_count / maxFiles) * 60;
        elements.push({
            data: {
                id: mod.name,
                label: mod.name,
                file_count: mod.file_count,
                importance: mod.importance || 0,
                size,
                primary_lang: Object.keys(mod.languages || {})[0] || "Unknown",
            }
        });
    });

    connections.forEach((conn, i) => {
        elements.push({
            data: {
                id: `me${i}`,
                source: conn.source,
                target: conn.target,
                weight: conn.weight,
                label: conn.weight > 1 ? `${conn.weight}` : "",
            }
        });
    });

    if (cyModule) cyModule.destroy();

    cyModule = cytoscape({
        container: document.getElementById("cy-module"),
        elements,
        style: moduleStyles(),
        layout: {
            name: modules.length > 6 ? "cose" : "dagre",
            rankDir: "LR",
            nodeSep: 80,
            rankSep: 120,
            fit: true,
            padding: 50,
            animate: true,
            animationDuration: 400,
        },
        minZoom: 0.2,
        maxZoom: 4,
        wheelSensitivity: 0.3,
    });

    document.getElementById("btn-fit-module").addEventListener("click", () => {
        cyModule.fit(undefined, 50);
    });

    // Module cards below graph
    renderModuleCards(modules);
}

function moduleStyles() {
    return [
        {
            selector: "node",
            style: {
                "label": "data(label)",
                "width": "data(size)",
                "height": "data(size)",
                "background-color": "#1e293b",
                "background-opacity": 0.9,
                "border-width": 2,
                "border-color": "rgba(6, 182, 212, 0.5)",
                "color": "#e4e8ee",
                "font-size": 12,
                "font-family": "JetBrains Mono, monospace",
                "font-weight": 600,
                "text-valign": "center",
                "text-halign": "center",
                "text-wrap": "wrap",
                "text-max-width": 90,
                "transition-property": "border-color, border-width",
                "transition-duration": "0.2s",
            }
        },
        {
            selector: "node:selected",
            style: {
                "border-color": "#06b6d4",
                "border-width": 3,
            }
        },
        {
            selector: "edge",
            style: {
                "width": "mapData(weight, 1, 10, 1.5, 5)",
                "line-color": "rgba(167, 139, 250, 0.35)",
                "target-arrow-color": "rgba(167, 139, 250, 0.5)",
                "target-arrow-shape": "triangle",
                "curve-style": "bezier",
                "label": "data(label)",
                "font-size": 10,
                "font-family": "JetBrains Mono, monospace",
                "color": "rgba(139, 149, 165, 0.9)",
                "text-background-color": "#0b0e14",
                "text-background-opacity": 0.8,
                "text-background-padding": "2px",
            }
        },
    ];
}

function renderModuleCards(modules) {
    const listEl = document.getElementById("module-list");
    listEl.innerHTML = "";

    modules.forEach(mod => {
        const langStr = Object.entries(mod.languages || {})
            .map(([l, c]) => `${l} (${c})`)
            .join(", ") || "—";

        const card = document.createElement("div");
        card.className = "module-card";
        card.innerHTML = `
            <div class="module-card-name">📁 ${escapeHtml(mod.name)}/</div>
            <div class="module-card-meta">
                <span>${mod.file_count} file${mod.file_count !== 1 ? "s" : ""}</span>
                <span>Importance: ${mod.importance}</span>
                <span>${escapeHtml(langStr)}</span>
            </div>`;
        listEl.appendChild(card);
    });
}


// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

function destroyGraphs() {
    if (cyGraph)   { cyGraph.destroy();   cyGraph = null; }
    if (cyModule)  { cyModule.destroy();  cyModule = null; }
}

function setLoading(loading) {
    analyzeBtn.disabled = loading;
    btnText.classList.toggle("hidden", loading);
    btnLoader.classList.toggle("hidden", !loading);
    urlInput.disabled = loading;
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove("hidden");
}
function hideError() {
    errorMsg.classList.add("hidden");
    errorMsg.textContent = "";
}

function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

function hexToRgba(hex, alpha) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return hex;
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fileIcon(language) {
   const icons = {
        "Python": "🐍", "JavaScript": "📜", "JavaScript (React)": "⚛️",
        "TypeScript": "🔷", "TypeScript (React)": "⚛️", "HTML": "🌐",
        "CSS": "🎨", "SCSS": "🎨", "JSON": "📋", "YAML": "📋",
        "Markdown": "📝", "Shell": "🐚", "Bash": "🐚", "Go": "🐹",
        "Rust": "🦀", "Java": "☕", "C": "⚙️", "C++": "⚙️",
        "Ruby": "💎", "Dockerfile": "🐳", "Docker Compose": "🐳",
        "Git Config": "📎", "Text": "📄",
    };
    return icons[language] || "📄";
}

// ══════════════════════════════════════════
// RAG CHAT LOGIC
// ══════════════════════════════════════════

const chatForm = document.getElementById("chat-input-form");
const chatInput = document.getElementById("chat-input-box");
const chatMessages = document.getElementById("chat-messages");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatSourcesPanel = document.getElementById("chat-sources-panel");
const chatSourcesList = document.getElementById("chat-sources-list");

function appendChatMessage(role, content) {
    const el = document.createElement("div");
    el.className = `chat-message ${role}`;
    
    // Simple markdown parsing for code backticks
    const htmlContent = escapeHtml(content)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\\n/g, '<br>');

    el.innerHTML = `
        <div class="msg-avatar">${role === 'assistant' ? 'AI' : 'U'}</div>
        <div class="msg-bubble">${htmlContent}</div>
    `;
    
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateSources(sources) {
    chatSourcesList.innerHTML = "";
    if (!sources || sources.length === 0) {
        chatSourcesList.innerHTML = '<div class="no-sources">No sources retrieved.</div>';
        return;
    }
    
    sources.forEach(src => {
        const item = document.createElement("div");
        item.className = "source-item";
        item.innerHTML = `
            <div class="source-path">${escapeHtml(src.file_path)}</div>
            <div class="source-score-badge">Score: ${src.score ? src.score.toFixed(3) : 'N/A'}</div>
        `;
        chatSourcesList.appendChild(item);
    });
}

chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query || !currentRepoId) return;

    // UI state
    appendChatMessage('user', query);
    chatInput.value = "";
    chatSendBtn.disabled = true;
    chatInput.disabled = true;

    // Loading indicator
    const loadingId = "msg-" + Date.now();
    const loadingEl = document.createElement("div");
    loadingEl.className = "chat-message assistant";
    loadingEl.id = loadingId;
    loadingEl.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-bubble" style="opacity: 0.7;">Searching codebase... <span class="spinner"></span></div>
    `;
    chatMessages.appendChild(loadingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await fetch(`${API_BASE}/chat/${currentRepoId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query })
        });

        const data = await response.json();
        
        // Remove loading
        document.getElementById(loadingId)?.remove();

        if (response.ok && data.success) {
            appendChatMessage('assistant', data.answer);
            updateSources(data.sources);
        } else {
            appendChatMessage('assistant', `⚠️ Error: ${data.detail || data.error || 'Failed to get answer'}`);
        }
        
    } catch (err) {
        document.getElementById(loadingId)?.remove();
        appendChatMessage('assistant', `⚠️ Connection error: ${err.message}`);
    } finally {
        chatSendBtn.disabled = false;
        chatInput.disabled = false;
        chatInput.focus();
    }
});

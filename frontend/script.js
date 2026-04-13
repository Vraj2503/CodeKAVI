/**
 * CodeKavi — Frontend Logic (Step 1)
 *
 * Handles:
 *  1. Submitting a GitHub URL to the backend
 *  2. Rendering the file tree, language stats, and file table
 */

const API_BASE = "http://localhost:8000/api";

// ── DOM refs ──
const form        = document.getElementById("analyze-form");
const urlInput    = document.getElementById("github-url");
const analyzeBtn  = document.getElementById("analyze-btn");
const btnText     = analyzeBtn.querySelector(".btn-text");
const btnLoader   = analyzeBtn.querySelector(".btn-loader");
const errorMsg    = document.getElementById("error-msg");
const resultsEl   = document.getElementById("results-section");

// stat slots
const statRepoName  = document.getElementById("stat-repo-name");
const statFiles     = document.getElementById("stat-total-files");
const statSize      = document.getElementById("stat-total-size");
const statLangs     = document.getElementById("stat-languages");

// panels
const fileTreeEl   = document.getElementById("file-tree");
const langBarsEl   = document.getElementById("lang-bars");
const filesTbody   = document.getElementById("files-tbody");


// ── Form submit ──
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    setLoading(true);
    hideError();
    resultsEl.classList.add("hidden");

    try {
        const res = await fetch(`${API_BASE}/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ github_url: url }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || "Unknown error");
        }

        renderResults(data);
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
});


// ── Render everything ──
function renderResults(data) {
    // Stats
    statRepoName.textContent = `${data.owner}/${data.repo_name}`;
    statFiles.textContent    = data.total_files;
    statSize.textContent     = data.total_size_formatted;
    statLangs.textContent    = Object.keys(data.languages).length;

    // File tree
    fileTreeEl.innerHTML = "";
    renderTree(data.tree, fileTreeEl);

    // Language bars
    renderLanguages(data.languages, data.total_files);

    // File table
    renderFileTable(data.files);

    // Show
    resultsEl.classList.remove("hidden");
}


// ── File tree (recursive) ──
function renderTree(nodes, container) {
    nodes.forEach((node) => {
        if (node.type === "dir") {
            // Toggle wrapper
            const toggle = document.createElement("div");
            toggle.className = "tree-toggle";
            toggle.innerHTML = `
                <div class="tree-item dir">
                    <span class="chevron">▼</span>
                    <span class="icon">📁</span>
                    <span class="name">${escapeHtml(node.name)}</span>
                </div>`;
            toggle.addEventListener("click", () => {
                toggle.classList.toggle("collapsed");
            });

            const children = document.createElement("div");
            children.className = "tree-children";
            renderTree(node.children, children);

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


// ── Language bars ──
function renderLanguages(languages, totalFiles) {
    langBarsEl.innerHTML = "";
    const max = Math.max(...Object.values(languages));

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
        langBarsEl.appendChild(row);

        // Animate bar in
        requestAnimationFrame(() => {
            row.querySelector(".lang-bar-fill").style.width = `${pct}%`;
        });
    });
}


// ── File table ──
function renderFileTable(files) {
    filesTbody.innerHTML = "";
    files.forEach((f) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</td>
            <td>${escapeHtml(f.language)}</td>
            <td>${f.size_formatted}</td>`;
        filesTbody.appendChild(tr);
    });
}


// ── Helpers ──
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
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function fileIcon(language) {
    const icons = {
        "Python":           "🐍",
        "JavaScript":       "📜",
        "JavaScript (React)":"⚛️",
        "TypeScript":       "🔷",
        "TypeScript (React)":"⚛️",
        "HTML":             "🌐",
        "CSS":              "🎨",
        "SCSS":             "🎨",
        "JSON":             "📋",
        "YAML":             "📋",
        "Markdown":         "📝",
        "Shell":            "🐚",
        "Bash":             "🐚",
        "Go":               "🐹",
        "Rust":             "🦀",
        "Java":             "☕",
        "C":                "⚙️",
        "C++":              "⚙️",
        "Ruby":             "💎",
        "Dockerfile":       "🐳",
        "Docker Compose":   "🐳",
        "Git Config":       "📎",
        "Text":             "📄",
    };
    return icons[language] || "📄";
}

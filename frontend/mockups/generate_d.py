import json
import os

def build_html():
    with open('/Applications/Projects/CodeKavi/frontend/mockups/v3-shared-data.js', 'r') as f:
        data_js = f.read()

    # We won't use f-strings for the whole HTML to avoid curly brace conflicts in CSS/JS
    html_content = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeKavi Knowledge Graph - Layered Accordion</title>
<style>
:root {
  --background: 30 9% 6%;
  --foreground: 40 18% 94%;
  --card: 30 8% 9%;
  --muted: 30 6% 14%;
  --muted-foreground: 36 8% 62%;
  --border: 32 7% 19%;
  --signal: 34 96% 56%;
  --destructive: 2 72% 58%;
  --success: 148 52% 52%;
  --viz-cat-1: 212 100% 67%;
  --viz-cat-2: 129 49% 49%;
  --viz-cat-3: 266 100% 77%;
  --viz-cat-4: 26 85% 59%;
  --viz-cat-5: 328 89% 72%;
  --viz-cat-6: 209 100% 74%;
  --viz-cat-7: 126 50% 45%;
  --viz-cat-8: 267 80% 70%;
  --viz-edge: 32 7% 19%;
  --radius: 0.5rem;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: system-ui, -apple-system, sans-serif;
  height: 100vh;
  display: flex;
  overflow: hidden;
}
header {
  height: 48px;
  border-bottom: 1px solid hsl(var(--border));
  display: flex;
  align-items: center;
  padding: 0 16px;
  justify-content: space-between;
  background: hsl(var(--background));
}
.header-stats {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.enrich-btn {
  background: transparent;
  color: hsl(var(--signal));
  border: 1px solid hsl(var(--signal));
  padding: 4px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
}
.enrich-btn.active {
  background: hsl(var(--signal) / 0.1);
}
.sidebar {
  width: 260px;
  border-right: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
  background: hsl(var(--card));
  transition: width 0.3s;
}
.sidebar.collapsed { width: 0; border: none; overflow: hidden; }
.sidebar-header {
  padding: 12px;
  border-bottom: 1px solid hsl(var(--border));
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.sidebar-search {
  width: 100%;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  color: hsl(var(--foreground));
  padding: 6px 12px;
  border-radius: var(--radius);
  margin-top: 8px;
  font-size: 13px;
}
.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-size: 13px;
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
}
.sidebar-item:hover { background: hsl(var(--muted)); }
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
}
.viewport {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  position: relative;
}
.tier {
  margin-bottom: 32px;
  position: relative;
  z-index: 2;
}
.tier-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 12px;
  border-bottom: 1px solid hsl(var(--border));
  padding-bottom: 4px;
}
.group-row {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
}
.group-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 16px;
}
.group-header:hover { background: hsl(var(--muted) / 0.5); }
.group-label { font-weight: 500; font-size: 14px; flex: 1; }
.group-role {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}
.group-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.importance-bar {
  width: 40px;
  height: 4px;
  background: hsl(var(--muted));
  border-radius: 2px;
  overflow: hidden;
}
.importance-fill { height: 100%; background: hsl(var(--signal)); }
.group-content {
  display: none;
  padding: 16px;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  overflow-x: auto;
}
.group-row.expanded .group-content {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.symbol-card {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 12px;
  min-width: 200px;
  cursor: pointer;
  position: relative;
  z-index: 3;
}
.symbol-card:hover { border-color: hsl(var(--muted-foreground)); }
.symbol-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}
.symbol-name { font-size: 13px; font-weight: 500; font-family: monospace; word-break: break-all; }
.symbol-type {
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 2px;
  background: hsl(var(--viz-cat-1) / 0.2);
  color: hsl(var(--viz-cat-1));
}
.symbol-meta {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  display: flex;
  justify-content: space-between;
}
.inspector {
  display: none;
  width: 100%;
  background: hsl(var(--muted) / 0.3);
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 16px;
  margin-top: 16px;
  font-size: 13px;
}
.group-row.expanded .inspector.active {
  display: block;
}
.inspector h4 { margin-bottom: 8px; font-weight: 500; }
.inspector pre {
  background: hsl(var(--background));
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: monospace;
  font-size: 12px;
  margin-bottom: 12px;
  border: 1px solid hsl(var(--border));
}
svg.edges {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  pointer-events: none;
  z-index: 1;
}
path.edge {
  fill: none;
  stroke: hsl(var(--viz-edge));
  stroke-width: 1.5;
  opacity: 0.4;
}
path.edge.upward { stroke-dasharray: 4 4; }
path.edge.inter-symbol {
  stroke: hsl(var(--signal));
  stroke-dasharray: 4 4;
  stroke-width: 2;
  opacity: 0.8;
  z-index: 10;
}
.concept-bracket {
  position: absolute;
  left: -20px;
  width: 16px;
  border-left: 3px solid;
  border-top: 3px solid;
  border-bottom: 3px solid;
  border-radius: 4px 0 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 0;
  cursor: pointer;
}
.concept-label {
  transform: rotate(-90deg);
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.concept-legend {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 12px;
  font-size: 12px;
  display: none;
  z-index: 100;
}
.concept-legend.active { display: block; }
</style>
</head>
<body>

<script>
__DATA_JS_PLACEHOLDER__
</script>

<div class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div id="sidebar-count">25 of 47 shown</div>
    <input type="text" class="sidebar-search" placeholder="Filter files..." id="sidebar-search">
  </div>
  <div class="sidebar-list" id="sidebar-list"></div>
</div>

<div class="main-content">
  <header>
    <div style="display: flex; align-items: center; gap: 12px;">
      <button id="toggle-sidebar" style="background: none; border: 1px solid hsl(var(--border)); color: inherit; padding: 4px 8px; border-radius: 4px; cursor: pointer;">☰</button>
      <div class="header-stats" id="header-stats">
        ▸ <span id="stat-short">73.5% resolved · 515 symbols hidden</span>
        <span id="stat-full" style="display: none;"></span>
      </div>
    </div>
    <div>
      <button class="enrich-btn active" id="enrich-btn">✦ Enrich with AI</button>
    </div>
  </header>
  
  <div class="viewport" id="viewport">
    <svg class="edges" id="edges-svg"></svg>
    <div id="tiers-container"></div>
  </div>
</div>

<div class="concept-legend" id="concept-legend">
  <h4 style="margin-bottom: 8px;">Concepts</h4>
  <div id="concept-list"></div>
</div>

<script>
const tiers = [
  { id: 'entry', label: 'Entry & Routing', roles: ['entry_point', 'router'] },
  { id: 'orchestrator', label: 'Orchestration', roles: ['orchestrator'] },
  { id: 'core', label: 'Core Logic', roles: ['core_module'] },
  { id: 'shared', label: 'Shared Utilities', roles: ['shared_utility'] },
  { id: 'internal', label: 'Internal Helpers', roles: ['internal_helper'] },
  { id: 'leaf', label: 'Leaf & Config', roles: ['leaf', 'config', 'test'] }
];

let expandedGroups = new Set();
let conceptsActive = true;
let currentInspector = null;

function init() {
  renderSidebar();
  renderTiers();
  updateStats();
  setupEventListeners();
  if (conceptsActive) renderConcepts();
  setTimeout(drawGroupEdges, 100);
}

function renderSidebar() {
  const list = document.getElementById('sidebar-list');
  list.innerHTML = '';
  DATA.groups.forEach(g => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.innerHTML = `<span style="font-size: 16px;">${g.drawn ? '☑' : '☐'}</span> ${g.file}`;
    item.onclick = () => {
      g.drawn = !g.drawn;
      renderSidebar();
      renderTiers();
      if (conceptsActive) renderConcepts();
      setTimeout(drawGroupEdges, 100);
    };
    list.appendChild(item);
  });
}

function renderTiers() {
  const container = document.getElementById('tiers-container');
  container.innerHTML = '';
  
  tiers.forEach(tier => {
    const tierGroups = DATA.groups.filter(g => g.drawn && tier.roles.includes(g.role));
    if (tierGroups.length === 0) return;
    
    tierGroups.sort((a,b) => b.importance - a.importance);
    
    const tierEl = document.createElement('div');
    tierEl.className = 'tier';
    tierEl.id = `tier-${tier.id}`;
    tierEl.innerHTML = `<div class="tier-label">${tier.label}</div>`;
    
    const groupsContainer = document.createElement('div');
    groupsContainer.style.position = 'relative';
    
    tierGroups.forEach(g => {
      const row = document.createElement('div');
      row.className = 'group-row';
      if (expandedGroups.has(g.id)) row.classList.add('expanded');
      row.id = `group-${g.id.replace(/[^a-zA-Z0-9]/g, '-')}`;
      row.dataset.id = g.id;
      
      let effectsHtml = g.effects.map(e => `<span style="color: hsl(var(--viz-cat-2));">■ ${e}</span>`).join(' ');
      
      row.innerHTML = `
        <div class="group-header" onclick="toggleGroup('${g.id}')">
          <div class="group-label">${g.file}</div>
          <div class="group-role">${g.role}</div>
          <div class="group-stats">
            <div>${g.symbol_count} sym</div>
            <div class="importance-bar"><div class="importance-fill" style="width: ${g.importance}%"></div></div>
            <div style="font-size: 10px;">${effectsHtml}</div>
            <div style="margin-left: 8px;">▾</div>
          </div>
        </div>
        <div class="group-content" id="content-${g.id.replace(/[^a-zA-Z0-9]/g, '-')}">
          <!-- symbols injected here -->
        </div>
        <div class="inspector" id="inspector-${g.id.replace(/[^a-zA-Z0-9]/g, '-')}"></div>
      `;
      groupsContainer.appendChild(row);
      
      if (expandedGroups.has(g.id)) {
        renderSymbols(g.id, row.querySelector('.group-content'));
      }
    });
    
    tierEl.appendChild(groupsContainer);
    container.appendChild(tierEl);
  });
}

function toggleGroup(id) {
  if (expandedGroups.has(id)) {
    expandedGroups.delete(id);
  } else {
    expandedGroups.add(id);
  }
  renderTiers();
  if (conceptsActive) renderConcepts();
  setTimeout(drawGroupEdges, 100);
}

function renderSymbols(groupId, container) {
  const symbols = DATA.nodes.filter(n => n.file === groupId);
  symbols.sort((a,b) => b.importance - a.importance);
  container.innerHTML = '';
  
  const scrollWrapper = document.createElement('div');
  scrollWrapper.style.display = 'flex';
  scrollWrapper.style.gap = '16px';
  
  symbols.forEach(s => {
    const card = document.createElement('div');
    card.className = 'symbol-card';
    card.id = `sym-${s.id.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    let typeColor = 'var(--viz-cat-1)';
    if(s.type === 'class') typeColor = 'var(--viz-cat-3)';
    if(s.type === 'method') typeColor = 'var(--viz-cat-4)';
    
    card.innerHTML = `
      <div class="symbol-header">
        <div class="symbol-name">${s.label}</div>
        <div class="symbol-type" style="color: hsl(${typeColor}); background: hsl(${typeColor} / 0.1)">${s.type.substring(0,3).toUpperCase()}</div>
      </div>
      <div class="symbol-meta">
        <div>${s.in_degree}↓ ${s.out_degree}↑</div>
        <div class="importance-bar" style="width: 24px;"><div class="importance-fill" style="width: ${s.importance}%"></div></div>
      </div>
    `;
    
    card.onclick = (e) => {
      e.stopPropagation();
      showInspector(s);
    };
    
    scrollWrapper.appendChild(card);
  });
  container.appendChild(scrollWrapper);
}

function showInspector(symbol) {
  const groupId = symbol.file;
  const inspectorId = `inspector-${groupId.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const inspector = document.getElementById(inspectorId);
  
  if (currentInspector === symbol.id) {
    inspector.classList.remove('active');
    currentInspector = null;
    return;
  }
  
  document.querySelectorAll('.inspector').forEach(el => el.classList.remove('active'));
  
  let eff = symbol.effects.map(e => `<span style="padding: 2px 6px; background: hsl(var(--muted)); border-radius: 4px; font-size: 11px;">${e}</span>`).join(' ');
  
  inspector.innerHTML = `
    <h4>${symbol.label}</h4>
    <pre>def ${symbol.label}${symbol.signature}</pre>
    ${symbol.doc ? `<div style="color: hsl(var(--muted-foreground)); margin-bottom: 12px; font-style: italic;">"${symbol.doc}"</div>` : ''}
    <div style="margin-bottom: 12px; display: flex; gap: 8px;">
      ${symbol.http ? `<span style="color: hsl(var(--signal)); border: 1px solid hsl(var(--signal)); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${symbol.http}</span>` : ''}
      ${symbol.is_async ? `<span style="color: hsl(var(--viz-cat-6)); border: 1px solid hsl(var(--viz-cat-6)); padding: 2px 6px; border-radius: 4px; font-size: 11px;">async</span>` : ''}
      ${eff}
    </div>
    <div style="display: flex; gap: 24px;">
      <div style="flex: 1;">
        <div style="color: hsl(var(--muted-foreground)); margin-bottom: 4px;">External Calls</div>
        ${symbol.external_calls.join(', ') || 'None'}
      </div>
    </div>
  `;
  inspector.classList.add('active');
  currentInspector = symbol.id;
}

function drawGroupEdges() {
  const svg = document.getElementById('edges-svg');
  svg.innerHTML = '';
  
  const viewport = document.getElementById('viewport');
  const scrollY = viewport.scrollTop;
  const rect = viewport.getBoundingClientRect();
  
  // Draw group edges
  DATA.group_edges.forEach(edge => {
    const src = document.getElementById(`group-${edge.source.replace(/[^a-zA-Z0-9]/g, '-')}`);
    const tgt = document.getElementById(`group-${edge.target.replace(/[^a-zA-Z0-9]/g, '-')}`);
    
    if (src && tgt && !expandedGroups.has(edge.source) && !expandedGroups.has(edge.target)) {
      const r1 = src.getBoundingClientRect();
      const r2 = tgt.getBoundingClientRect();
      
      const y1 = r1.top - rect.top + scrollY + r1.height/2;
      const y2 = r2.top - rect.top + scrollY + r2.height/2;
      const x1 = r1.left - rect.left + 20; 
      const x2 = r2.left - rect.left + 20;
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'edge' + (y2 < y1 ? ' upward' : ''));
      path.setAttribute('d', `M ${x1} ${y1} C ${x1-30} ${y1}, ${x2-30} ${y2}, ${x2} ${y2}`);
      svg.appendChild(path);
    }
  });
  
  // Draw inter-symbol edges if multiple groups expanded
  if (expandedGroups.size > 1) {
    DATA.edges.forEach(edge => {
      const srcNode = DATA.nodes.find(n => n.id === edge.source);
      const tgtNode = DATA.nodes.find(n => n.id === edge.target);
      if (srcNode && tgtNode && expandedGroups.has(srcNode.file) && expandedGroups.has(tgtNode.file) && srcNode.file !== tgtNode.file) {
        
        const sEl = document.getElementById(`sym-${edge.source.replace(/[^a-zA-Z0-9]/g, '-')}`);
        const tEl = document.getElementById(`sym-${edge.target.replace(/[^a-zA-Z0-9]/g, '-')}`);
        
        if (sEl && tEl) {
          const sr = sEl.getBoundingClientRect();
          const tr = tEl.getBoundingClientRect();
          
          const x1 = sr.left - rect.left + sr.width/2;
          const y1 = sr.bottom - rect.top + scrollY;
          const x2 = tr.left - rect.left + tr.width/2;
          const y2 = tr.top - rect.top + scrollY;
          
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('class', 'edge inter-symbol');
          path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${y1+30}, ${x2} ${y2-30}, ${x2} ${y2}`);
          svg.appendChild(path);
        }
      }
    });
  }
}

function renderConcepts() {
  document.querySelectorAll('.concept-bracket').forEach(el => el.remove());
  if (!conceptsActive) return;
  
  const colors = ['var(--viz-cat-1)', 'var(--viz-cat-3)', 'var(--viz-cat-5)', 'var(--viz-cat-7)'];
  const legend = document.getElementById('concept-list');
  legend.innerHTML = '';
  document.getElementById('concept-legend').classList.add('active');
  
  const viewport = document.getElementById('viewport');
  const scrollY = viewport.scrollTop;
  const rect = viewport.getBoundingClientRect();
  
  DATA.concepts.entities.forEach((c, idx) => {
    const color = colors[idx % colors.length];
    
    // Legend item
    const legItem = document.createElement('div');
    legItem.style.color = `hsl(${color})`;
    legItem.style.marginBottom = '4px';
    legItem.innerText = `■ ${c.name}`;
    legend.appendChild(legItem);
    
    // Find min/max Y for bracket
    let minY = Infinity;
    let maxY = -Infinity;
    
    c.files.forEach(f => {
      const el = document.getElementById(`group-${f.replace(/[^a-zA-Z0-9]/g, '-')}`);
      if (el) {
        const r = el.getBoundingClientRect();
        const top = r.top - rect.top + scrollY;
        const bottom = r.bottom - rect.top + scrollY;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
      }
    });
    
    if (minY !== Infinity && maxY !== -Infinity) {
      const bracket = document.createElement('div');
      bracket.className = 'concept-bracket';
      bracket.style.top = `${minY}px`;
      bracket.style.height = `${maxY - minY}px`;
      bracket.style.borderColor = `hsl(${color})`;
      bracket.style.color = `hsl(${color})`;
      bracket.style.left = `${24 + (idx * 24)}px`; // stagger
      
      bracket.innerHTML = `<div class="concept-label">${c.name}</div>`;
      viewport.appendChild(bracket);
    }
  });
}

function updateStats() {
  const meta = DATA.metadata;
  const diag = DATA.diagnostics;
  
  document.getElementById('stat-short').innerText = `▸ ${(diag.resolution_rate*100).toFixed(1)}% resolved · ${meta.truncated_count} symbols hidden`;
  document.getElementById('stat-full').innerText = `▾ ${diag.node_count} of ${meta.total_symbols} symbols shown · ${meta.resolved_calls} calls resolved (${(diag.resolution_rate*100).toFixed(1)}%) · ${meta.unresolved_calls} unresolved · ${meta.unsupported_languages.join(', ')} not parsed`;
  
  document.getElementById('header-stats').onclick = () => {
    const short = document.getElementById('stat-short');
    const full = document.getElementById('stat-full');
    if (short.style.display === 'none') {
      short.style.display = 'inline';
      full.style.display = 'none';
    } else {
      short.style.display = 'none';
      full.style.display = 'inline';
    }
  };
}

function setupEventListeners() {
  document.getElementById('toggle-sidebar').onclick = () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  };
  
  document.getElementById('enrich-btn').onclick = (e) => {
    conceptsActive = !conceptsActive;
    if (conceptsActive) {
      e.target.classList.add('active');
      e.target.innerText = '✦ AI Active';
      document.getElementById('concept-legend').classList.add('active');
      renderConcepts();
    } else {
      e.target.classList.remove('active');
      e.target.innerText = '✦ Enrich with AI';
      document.getElementById('concept-legend').classList.remove('active');
      document.querySelectorAll('.concept-bracket').forEach(el => el.remove());
    }
  };
  
  document.getElementById('viewport').addEventListener('scroll', drawGroupEdges);
  window.addEventListener('resize', drawGroupEdges);
}

init();
</script>
</body>
</html>
"""
    
    html_content = html_content.replace('__DATA_JS_PLACEHOLDER__', data_js)

    with open('/Applications/Projects/CodeKavi/frontend/mockups/knowledge-graph-v3-D.html', 'w') as f:
        f.write(html_content)

if __name__ == "__main__":
    build_html()

(function (root) {
  'use strict';

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const list = (value) => (Array.isArray(value) ? value : []).map((item) => String(item == null ? '' : item).trim()).filter(Boolean);
  const cleanLabel = (value) => String(value == null ? '' : value).replace(/\s*\[\[edge:[^\]]+\]\]/gi, '').replace(/\s+/g, ' ').trim();
  const key = (value) => cleanLabel(value).toLocaleLowerCase();
  const stableId = (node, index) => String(node && node.id != null ? node.id : `node-${index}`).slice(0, 180);
  let workspaceSerial = 0;

  function collect(data) {
    const nodes = [];
    const roots = Array.isArray(data && data.nodes) ? data.nodes : [];
    const visit = (items, parent, depth) => {
      items.forEach((node, index) => {
        if (!node || typeof node !== 'object') return;
        const entry = {
          node,
          id: stableId(node, nodes.length),
          parent,
          depth,
          index: nodes.length,
          label: cleanLabel(node.label || node.title || node.name || `Узел ${nodes.length + 1}`),
          children: []
        };
        nodes.push(entry);
        if (parent) parent.children.push(entry);
        const children = Array.isArray(node.children) ? node.children : [];
        visit(children, entry, depth + 1);
      });
    };
    visit(roots, null, 0);
    const byLabel = new Map();
    nodes.forEach((entry) => {
      const normalized = key(entry.label);
      if (normalized && !byLabel.has(normalized)) byLabel.set(normalized, entry);
    });
    const edges = [];
    const seen = new Set();
    nodes.forEach((entry) => {
      const sources = [entry.node.description, ...list(entry.node.insights), ...list(entry.node.evidence), ...list(entry.node.questions)];
      sources.forEach((source) => {
        String(source == null ? '' : source).replace(/\[\[edge:([^\]]+)\]\]/gi, (_match, label) => {
          const target = byLabel.get(key(label));
          if (target && target !== entry) {
            const pair = `${Math.min(entry.index, target.index)}:${Math.max(entry.index, target.index)}`;
            if (!seen.has(pair)) {
              seen.add(pair);
              edges.push({ from: entry, to: target, label: cleanLabel(label) });
            }
          }
          return '';
        });
      });
    });
    return { nodes, roots: nodes.filter((entry) => !entry.parent), edges };
  }

  function wrap(text, limit, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((word) => {
      while (word.length > limit) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, limit));
        word = word.slice(limit);
      }
      if (!word) return;
      if (!line) line = word;
      else if ((line + ' ' + word).length <= limit) line += ` ${word}`;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(1, limit - 1))}…`;
    }
    return lines.length ? lines : [''];
  }

  function treePositions(graph) {
    const gapY = 126;
    let cursor = 0;
    const place = (entry) => {
      const first = cursor;
      if (entry.children.length) entry.children.forEach(place);
      else cursor += 1;
      entry.y = (entry.children.length ? (first + cursor - 1) / 2 : cursor - 1) * gapY + 56;
      entry.x = 128 + entry.depth * 218;
    };
    graph.roots.forEach(place);
    const maxDepth = graph.nodes.reduce((max, node) => Math.max(max, node.depth), 0);
    return { width: Math.max(360, 260 + maxDepth * 218), height: Math.max(150, cursor * gapY + 30) };
  }

  function radialPositions(graph) {
    const levels = [];
    graph.nodes.forEach((entry) => (levels[entry.depth] || (levels[entry.depth] = [])).push(entry));
    const maxDepth = Math.max(0, levels.length - 1);
    const radii = [];
    const ringGap = 208;
    const cardW = 164;
    let outer = 0;
    for (let depth = 0; depth <= maxDepth; depth++) {
      const count = (levels[depth] || []).length;
      const required = count > 1 ? (count * 190) / (Math.PI * 2) : 0;
      const previousRing = depth ? radii[depth - 1] + ringGap : 0;
      radii[depth] = depth === 0 && count === 1 ? 0 : Math.max(depth * ringGap, previousRing, required + 80);
      outer = Math.max(outer, radii[depth]);
    }
    const center = outer + cardW / 2 + 32;
    for (let depth = 0; depth <= maxDepth; depth++) {
      const entries = levels[depth] || [];
      entries.forEach((entry, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(entries.length, 1);
        entry.x = center + Math.cos(angle) * radii[depth];
        entry.y = center + Math.sin(angle) * radii[depth];
      });
    }
    const extent = center * 2;
    return { width: Math.max(320, extent), height: Math.max(260, extent) };
  }

  function renderSvg(graph, mode) {
    const size = mode === 'mindweb' ? radialPositions(graph) : treePositions(graph);
    const cardW = 164;
    const cardH = 96;
    const boundary = (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const scale = 1 / Math.max(Math.abs(dx) / (cardW / 2), Math.abs(dy) / (cardH / 2), 0.001);
      return { x: from.x + dx * scale, y: from.y + dy * scale };
    };
    const link = (a, b, extra) => {
      const start = boundary(a, b);
      const end = boundary(b, a);
      if (mode === 'mindweb') return `<path class="wm-link${extra || ''}" d="M ${start.x} ${start.y} L ${end.x} ${end.y}" fill="none"/>`;
      const mid = (start.x + end.x) / 2;
      return `<path class="wm-link${extra || ''}" d="M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}" fill="none"/>`;
    };
    const hierarchy = graph.nodes.filter((entry) => entry.parent).map((entry) => link(entry.parent, entry, '')).join('');
    const refs = graph.edges.map((edge) => `${link(edge.from, edge.to, ' wm-link-ref').replace('/>', '')}<title>${esc(edge.label)}</title></path>`).join('');
    const items = graph.nodes.map((entry) => {
      const lines = wrap(entry.label, 21, 6);
      const start = entry.y - ((lines.length - 1) * 8);
      return `<g class="wm-svg-node" data-wm-node="${entry.index}" role="button" tabindex="0" aria-label="${esc(entry.label)}" transform="translate(${entry.x - cardW / 2} ${entry.y - cardH / 2})"><rect width="${cardW}" height="${cardH}" rx="12"/><text x="${cardW / 2}" y="${start - entry.y + cardH / 2 + 4}" text-anchor="middle">${lines.map((line, index) => `<tspan x="${cardW / 2}" dy="${index ? 16 : 0}">${esc(line)}</tspan>`).join('')}</text><title>${esc(entry.label)}${entry.node.kind ? ` · ${esc(entry.node.kind)}` : ''}</title></g>`;
    }).join('');
    return `<div class="wm-canvas" role="region" aria-label="${mode === 'mindweb' ? 'Mindweb, интерактивная сеть' : 'Карта связей'}"><svg class="wm-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}" role="group" aria-label="${mode === 'mindweb' ? 'Mindweb' : 'Иерархическая карта'}"><style>.wm-link{stroke:#b9c9c1;stroke-width:1.7}.wm-link-ref{stroke:#d18b51;stroke-width:1.8;stroke-dasharray:5 5}.wm-svg-node rect{fill:#fff;stroke:#ccdad3;stroke-width:1.2}.wm-svg-node text{fill:#283b37;font:600 11px monospace}</style><g class="wm-links">${hierarchy}${refs}</g><g class="wm-nodes">${items}</g></svg></div>`;
  }

  function renderTree(graph, idPrefix) {
    const visit = (entry) => `<li class="wm-tree-item"><div class="wm-tree-row">${entry.children.length ? `<button class="wm-fold" type="button" data-wm-fold="${entry.index}" aria-expanded="true" aria-controls="${idPrefix}-children-${entry.index}" aria-label="Свернуть ветку ${esc(entry.label)}">−</button>` : '<span class="wm-fold-spacer" aria-hidden="true"></span>'}<button class="wm-tree-node" type="button" data-wm-node="${entry.index}">${esc(entry.label)}${entry.node.kind ? `<small>${esc(entry.node.kind)}</small>` : ''}</button></div>${entry.children.length ? `<ul class="wm-tree-children" id="${idPrefix}-children-${entry.index}">${entry.children.map(visit).join('')}</ul>` : ''}</li>`;
    return `<ul class="wm-tree" aria-label="Дерево карты">${graph.roots.map(visit).join('')}</ul>`;
  }

  function renderDetails(entry) {
    if (!entry) return '<p class="wm-detail-empty">Выберите узел на карте или в дереве — здесь появятся его описание и исходные сигналы.</p>';
    const node = entry.node;
    const section = (title, values, className) => {
      const items = list(values);
      if (!items.length) return '';
      return `<section class="wm-detail-section ${className}"><h4>${title}</h4><ul>${items.map((item) => `<li>${esc(item.replace(/\[\[edge:([^\]]+)\]\]/gi, '→ $1'))}</li>`).join('')}</ul></section>`;
    };
    const desc = String(node.description || '').trim();
    const refsText = [String(node.description || ''), ...list(node.insights), ...list(node.evidence), ...list(node.questions)].join(' ');
    const uniqueRefs = [...new Set(Array.from(refsText.matchAll(/\[\[edge:([^\]]+)\]\]/gi), (match) => cleanLabel(match[1])).filter(Boolean))];
    return `<h3>${esc(entry.label)}</h3><p class="wm-detail-meta">${esc(node.kind || 'узел')}${node.group ? ` · ${esc(node.group)}` : ''}</p>${desc ? `<p class="wm-detail-description">${esc(cleanLabel(desc))}</p>` : ''}${section('Инсайты', node.insights, 'wm-insights')}${section('Сигналы', node.evidence, 'wm-evidence')}${section('Вопросы', node.questions, 'wm-questions')}${uniqueRefs.length ? `<p class="wm-detail-refs">Явные связи: ${uniqueRefs.map(esc).join(' · ')}</p>` : ''}`;
  }

  function render(data) {
    const graph = collect(data || {});
    const title = String(data && data.title || 'Карта').trim() || 'Карта';
    const count = graph.nodes.length;
    const workspaceId = `wm-${++workspaceSerial}`;
    const outline = renderTree(graph, workspaceId);
    const initial = graph.nodes[0];
    return `<section class="wm-workspace" data-wm-workspace data-wm-fitted="true"><header class="wm-head"><div><h2>${esc(title)}</h2><p>${count} ${count === 1 ? 'узел' : 'узлов'} · иерархия и только отмеченные связи</p></div><div class="wm-mode" role="group" aria-label="Вид карты"><button type="button" data-wm-mode="tree" aria-pressed="true">Карта</button><button type="button" data-wm-mode="mindweb" aria-pressed="false">Mindweb</button></div></header><div class="wm-body"><div class="wm-visual"><div class="wm-local-controls"><button type="button" data-wm-outline aria-expanded="false" aria-controls="${workspaceId}-outline-view">Показать дерево</button><button type="button" data-wm-fit aria-pressed="true" title="Показать граф целиком или увеличить узлы для чтения">Крупнее</button></div><div class="wm-map-view" data-wm-view="tree" role="region" aria-label="Карта связей" tabindex="0">${renderSvg(graph, 'tree')}</div><div class="wm-map-view" data-wm-view="mindweb" role="region" aria-label="Mindweb" tabindex="0" hidden>${renderSvg(graph, 'mindweb')}</div><div class="wm-tree-view" id="${workspaceId}-outline-view" data-wm-view="outline" role="region" aria-label="Дерево карты" tabindex="0" hidden>${outline}</div><div class="wm-detail" aria-live="polite" data-wm-detail>${renderDetails(initial)}</div></div></div></section>`;
  }
  
  

  function bind(container, data) {
    if (!container) return null;
    const rootEl = container.matches && container.matches('[data-wm-workspace]') ? container : container.querySelector('[data-wm-workspace]');
    if (!rootEl) return null;
    const graph = collect(data || {});
    const detail = rootEl.querySelector('[data-wm-detail]');
    const entries = graph.nodes;
    let currentMode = 'tree';
    const outlineButton = rootEl.querySelector('[data-wm-outline]');
    const showView = (mode) => {
      rootEl.querySelectorAll('[data-wm-view]').forEach((view) => { view.hidden = view.dataset.wmView !== mode; });
      const showingOutline = mode === 'outline';
      outlineButton.setAttribute('aria-expanded', String(showingOutline));
      outlineButton.textContent = showingOutline ? 'Скрыть дерево' : 'Показать дерево';
    };
    const select = (index) => {
      const entry = entries[Number(index)];
      if (!entry) return;
      detail.innerHTML = renderDetails(entry);
      rootEl.querySelectorAll('.wm-is-selected').forEach((el) => el.classList.remove('wm-is-selected'));
      rootEl.querySelectorAll(`[data-wm-node="${entry.index}"]`).forEach((el) => el.classList.add('wm-is-selected'));
    };
    rootEl.addEventListener('click', (event) => {
      const fitButton = event.target.closest('[data-wm-fit]');
      if (fitButton && rootEl.contains(fitButton)) {
        const fitted = rootEl.dataset.wmFitted !== 'true';
        rootEl.dataset.wmFitted = String(fitted);
        fitButton.setAttribute('aria-pressed', String(fitted));
        fitButton.textContent = fitted ? 'Крупнее' : 'Вписать';
        return;
      }
      const outlineToggle = event.target.closest('[data-wm-outline]');
      if (outlineToggle && rootEl.contains(outlineToggle)) {
        showView(outlineToggle.getAttribute('aria-expanded') === 'true' ? currentMode : 'outline');
        return;
      }
      const modeButton = event.target.closest('[data-wm-mode]');
      if (modeButton && rootEl.contains(modeButton)) {
        currentMode = modeButton.dataset.wmMode;
        rootEl.querySelectorAll('[data-wm-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button === modeButton)));
        showView(currentMode);
        return;
      }
      const fold = event.target.closest('[data-wm-fold]');
      if (fold && rootEl.contains(fold)) {
        const expanded = fold.getAttribute('aria-expanded') === 'true';
        const listEl = fold.closest('.wm-tree-item').querySelector(':scope > .wm-tree-children');
        if (listEl) listEl.hidden = expanded;
        fold.setAttribute('aria-expanded', String(!expanded));
        fold.textContent = expanded ? '+' : '−';
        fold.setAttribute('aria-label', `${expanded ? 'Развернуть' : 'Свернуть'} ветку ${entries[Number(fold.dataset.wmFold)]?.label || ''}`);
        return;
      }
      const node = event.target.closest('[data-wm-node]');
      if (node && rootEl.contains(node)) select(node.dataset.wmNode);
    });
    rootEl.addEventListener('keydown', (event) => {
      const node = event.target.closest('.wm-svg-node');
      if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(node.dataset.wmNode); }
    });
    return { select };
  }

  root.ROX_WORKSPACE_MAP = { render, bind };
})(globalThis);

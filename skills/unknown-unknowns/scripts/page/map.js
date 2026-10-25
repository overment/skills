// The live mind map. It gets the map from the server over Server-Sent Events, lays it out with
// layout.mjs and draws it as SVG. Pan, zoom, the selection, the marks, the open panel and the
// lightbox survive every update. nav.mjs holds the logic behind the keys.

import { GEOMETRY, fanPaths, layout, linkPath } from './layout.mjs';
import { renderMarkdown, renderText } from './markdown.mjs';
import { MAX_MARKS, findNodes, journeyOf, lineage, move, pathOf, recency, stepJourney, toggleMark } from './nav.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SANS = '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MOVE_MS = 250; // nodes and edges slide to a new place
const PAN_MS = 320; // the view moves to a far node, or fits the map
const STEP_MS = 200; // the view follows the selection, or zooms by one step
const ENTER_MS = 340; // a new edge fades in on its own, then joins the path of its parent
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
const FIT_MAX = 1.4; // a small map does not grow past this zoom
const FIT_PAD = 72;
const LABEL_FONT = `450 13px ${SANS}`;
const CURRENT_FONT = `560 13px ${SANS}`;
const ROOT_FONT = `600 15px ${SANS}`;
const RING = 6.75; // radius of the ring around the current dot
const ROOT_RING = 8;
const MARK_PAD = { dot: 6, text: 8 }; // the selection mark goes this far past the dot and the label
const PANEL_GAP = 32; // the least space between the open panel and the labels next to it
const NEAR_Y = 160; // labels this close above or below the open node stay clear of the panel too
const VIEW_MARGIN = 48; // the selected node stays this far inside the window
const TRAY_SPACE = 56; // the bar of marked nodes covers this much of the bottom
const LIMIT_MS = 1600; // how long the bar says that no more nodes can be marked
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads';
const TYPE_NAMES = { html: 'HTML', image: 'Image', pdf: 'PDF', markdown: 'Markdown', text: 'Text', other: 'File', link: 'Link ↗' };
const STATES = ['suggested', 'visited', 'current'];
const SETTINGS_KEY = 'unknown-unknowns-map:settings'; // theme.js reads it too
const SETTINGS = {
  highlight: ['path', 'journey', 'none'],
  links: ['selected', 'always', 'never'],
  focus: ['off', 'on'],
  theme: ['system', 'light', 'dark'],
};
const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const world = $('world');
const layers = { edgesDim: $('edges-dim'), edges: $('edges'), path: $('path'), links: $('links'), nodes: $('nodes') };
const journeyLine = $('journey');
const panel = $('panel');
const panelTitle = $('panel-title');
const panelState = $('panel-state');
const panelNote = $('panel-note');
const panelFiles = $('panel-files');
const panelFilesList = $('panel-files-list');
const panelRelated = $('panel-related');
const panelRelatedList = $('panel-related-list');
const panelBody = panel.querySelector('.panel-body');
const find = $('find');
const findInput = $('find-input');
const findList = $('find-list');
const tray = $('tray');
const trayCount = $('tray-count');
const sheet = $('sheet');
const settingsBox = $('settings');
const compare = $('compare');
const compareBody = $('compare-body');
const lightbox = $('lightbox');
const lightboxTitle = $('lightbox-title');
const lightboxOpen = $('lightbox-open');
const lightboxBody = $('lightbox-body');
const status = $('status');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const easeOut = (t) => 1 - (1 - t) ** 4; // close to cubic-bezier(0.23, 1, 0.32, 1)
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 100) / 100;

let map = null;
let byId = new Map();
let target = new Map(); // id → box from the last layout
let bounds = null;
const view = { x: 0, y: 0, k: 1 };
const shown = new Map(); // id → drawn node: { el, mark, hit, dot, ring, label, pos, from, box }
const edges = new Map(); // child id → { from, d, el }; el only while the edge fades in
const fans = new Map(); // parent id → { el, dim }: the settled edges of that parent, bright and dimmed
const paths = new Map(); // child id → the darker copy of an edge on the path to the current node
const links = new Map(); // "a b" → { el, a, b }
let slide = null; // { start } while nodes slide
let pan = null; // { start, ms, from, to } while the view moves
let frameId = 0;
let fitted = false;
let follow = true; // the view keeps the whole map in the window, until the user pans or zooms
let drag = null;
let hoverId = null;
let selectedId = null; // the node the user looks at; the agent's node is the current one
let panelOpen = false;
let marks = []; // ids marked for compare, in the order they were marked
let dim = new Set(); // ids drawn faint: the nodes that are not marked, or off the focused branch
const history = []; // the ids the user selected, oldest first
let journeyIndex = -1;
let limitTimer = 0;
let panelSource = { note: null, files: null, related: null };
let compareSource = '';
let lightboxItem = null;
let settings = loadSettings();

// ── Settings ──────────────────────────────────────────────────────────

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') ?? {}; } catch {}
  return Object.fromEntries(Object.entries(SETTINGS).map(([name, values]) => [name, values.includes(saved[name]) ? saved[name] : values[0]]));
}

function applySettings() {
  const root = document.documentElement;
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  canvas.dataset.highlight = settings.highlight;
  canvas.dataset.links = settings.links;
  for (const input of settingsBox.querySelectorAll('input')) input.checked = settings[input.name] === input.value;
  if (map) { refresh(); drawJourney(); }
}

settingsBox.addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (!SETTINGS[name]?.includes(value)) return;
  settings = { ...settings, [name]: value };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  applySettings();
});

addEventListener('storage', (e) => {
  if (e.key !== SETTINGS_KEY) return;
  settings = loadSettings();
  applySettings();
});

applySettings();

// ── Measuring labels ──────────────────────────────────────────────────

const measureContext = document.createElement('canvas').getContext('2d');
const widths = new Map();

// Each label is measured at the weight it is drawn with, so every edge leaves its label at the
// same gap.
function measure(label, { root, state }) {
  const font = root ? ROOT_FONT : state === 'current' ? CURRENT_FONT : LABEL_FONT;
  const key = `${font}\u0000${label}`;
  if (!widths.has(key)) {
    measureContext.font = font;
    widths.set(key, round(measureContext.measureText(label).width));
  }
  return widths.get(key);
}

async function loadFonts(next) {
  const text = next.nodes.map((n) => n.label).join(' ');
  const loads = [LABEL_FONT, CURRENT_FONT, ROOT_FONT].map((font) => document.fonts.load(font, text));
  await Promise.race([Promise.all(loads).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

document.fonts.addEventListener('loadingdone', () => {
  widths.clear();
  if (map) apply(map);
});

// ── Drawing ───────────────────────────────────────────────────────────

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

function enter(el) {
  el.classList.add('is-entering');
  el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
}

function leave(el) {
  el.classList.remove('is-entering');
  el.classList.add('is-leaving');
  el.removeAttribute('tabindex');
  setTimeout(() => el.remove(), 260);
}

function createNode(box) {
  const el = svg('g', { class: 'node', tabindex: '0', role: 'button', 'data-id': box.id });
  const mark = svg('rect', { class: 'mark', rx: '7', y: String(-GEOMETRY.row / 2), height: String(GEOMETRY.row) });
  const hit = svg('rect', { class: 'hit', rx: '7', y: String(-GEOMETRY.row / 2), height: String(GEOMETRY.row) });
  const ring = svg('circle', { class: 'ring' });
  const dot = svg('circle', { class: 'dot' });
  const label = svg('text', { class: 'label', dy: '0.35em' });
  el.append(mark, hit, ring, dot, label);
  enter(el);
  layers.nodes.append(el);
  return { el, mark, hit, dot, ring, label, pos: { x: box.x, y: box.y, labelX: box.labelX }, box };
}

function styleNode(item, node) {
  const root = node.id === 'goal';
  const { classList } = item.el;
  classList.toggle('is-root', root);
  for (const state of STATES) classList.toggle(`is-${state}`, node.state === state);
  classList.toggle('is-left', item.box.side < 0);
  if (item.label.textContent !== node.label) item.label.textContent = node.label;
  item.dot.setAttribute('r', root ? GEOMETRY.rootDot : GEOMETRY.dot);
  item.ring.setAttribute('r', root ? ROOT_RING : RING);
  item.el.setAttribute('aria-label', `${node.label}. ${stateLine(node)}.${marks.includes(node.id) ? ' Marked.' : ''}`);
}

const currentId = () => map?.nodes.find((n) => n.state === 'current')?.id ?? null;

/** The ids on the tree path from the goal to the current node. */
function pathToCurrent() {
  const ids = new Set();
  let node = byId.get(currentId());
  while (node && !ids.has(node.id)) {
    ids.add(node.id);
    node = byId.get(node.parent);
  }
  return ids;
}

/** Take a new map: lay it out, then add, change, slide and remove what is drawn. */
function apply(next) {
  const previousCurrent = currentId();
  map = next;
  byId = new Map(map.nodes.map((n) => [n.id, n]));
  document.title = byId.get('goal')?.label ?? 'Map';

  const result = layout(map, measure);
  target = new Map(result.nodes.map((box) => [box.id, box]));
  bounds = result.bounds;
  marks = marks.filter((id) => target.has(id));
  if (selectedId && !target.has(selectedId)) {
    selectedId = null;
    closePanel();
  }

  for (const box of result.nodes) {
    const item = shown.get(box.id) ?? createNode(box);
    shown.set(box.id, item);
    item.from = { ...item.pos };
    item.box = box;
    styleNode(item, byId.get(box.id));
  }
  for (const [id, item] of shown) {
    if (!target.has(id)) { leave(item.el); shown.delete(id); }
  }

  updateEdges(result.edges);

  const linkKeys = new Set(result.links.map((l) => `${l.a} ${l.b}`));
  for (const l of result.links) {
    const key = `${l.a} ${l.b}`;
    if (links.has(key)) continue;
    const el = svg('path', { class: 'link' });
    enter(el);
    layers.links.append(el);
    links.set(key, { el, a: l.a, b: l.b });
  }
  for (const [key, item] of links) {
    if (!linkKeys.has(key)) { leave(item.el); links.delete(key); }
  }
  refresh();
  if (findOpen) renderResults();
  if (compareOpen()) {
    if (marks.length) renderCompare(false);
    else closeCompare();
  }

  if (!fitted) {
    fitted = true;
    for (const item of shown.values()) item.pos = toPos(item.box);
    Object.assign(view, fitView());
    drawNodes();
    drawView();
    if (panelOpen) renderPanel(false);
    return;
  }
  if (reduceMotion.matches) {
    for (const item of shown.values()) item.pos = toPos(item.box);
    drawNodes();
  } else {
    slide = { start: performance.now() };
    requestFrame();
  }

  // While the view follows, it fits the map again only when the map grows out of the window, so
  // the nodes that keep their place also keep it on the screen.
  const current = currentId();
  if (follow && !drag && !inView(bounds)) moveView(fitView());
  else if (current && previousCurrent && current !== previousCurrent && !selectedId) bringIntoView(current);
  if (panelOpen) renderPanel(false);
}

/**
 * Match the drawn edges to the layout. The settled edges of one parent are one path, so the stem
 * and the fork that they share are drawn once and look as thin as the rest. A new edge fades in as
 * a path of its own, then joins the path of its parent.
 */
function updateEdges(list) {
  const ids = new Set(list.map((e) => e.to));
  for (const e of list) {
    const item = edges.get(e.to);
    if (item) { item.from = e.from; continue; }
    const added = { from: e.from, d: '', el: null };
    if (fitted) {
      added.el = svg('path', { class: 'edge' });
      enter(added.el);
      layers.edges.append(added.el);
      setTimeout(() => {
        if (!added.el || edges.get(e.to) !== added) return;
        added.el.remove();
        added.el = null;
        drawEdges();
      }, ENTER_MS);
    }
    edges.set(e.to, added);
  }
  for (const [id, item] of edges) {
    if (ids.has(id)) continue;
    edges.delete(id);
    const el = item.el ?? svg('path', { class: 'edge', d: item.d });
    if (!item.el) layers.edges.append(el);
    item.el = null;
    leave(el);
  }

  // A parent has two paths: the edges to its bright children, and the edges to the dimmed ones
  // under them, so a stem that both share stays bright.
  const parents = new Set(list.map((e) => e.from));
  for (const id of parents) {
    if (fans.has(id)) continue;
    fans.set(id, {
      el: layers.edges.insertBefore(svg('path', { class: 'edge' }), layers.edges.firstChild),
      dim: layers.edgesDim.appendChild(svg('path', { class: 'edge is-dim' })),
    });
  }
  for (const [id, fan] of fans) {
    if (parents.has(id)) continue;
    fan.el.remove();
    fan.dim.remove();
    fans.delete(id);
  }

  const onPath = pathToCurrent();
  for (const id of ids) {
    if (!onPath.has(id) || paths.has(id)) continue;
    const el = svg('path', { class: 'edge is-path' });
    enter(el);
    layers.path.append(el);
    paths.set(id, el);
  }
  for (const [id, el] of paths) {
    if (!onPath.has(id) || !ids.has(id)) { leave(el); paths.delete(id); }
  }
}

function drawEdges() {
  const drawn = new Map([...shown].map(([id, item]) => [id, drawnBox(item)]));
  for (const [id, fan] of fans) {
    const parent = drawn.get(id);
    const kids = (parent?.children ?? []).filter((k) => drawn.has(k) && edges.has(k)).map((k) => drawn.get(k));
    const bright = [];
    const faint = [];
    fanPaths(parent, kids).forEach((d, i) => {
      const kid = kids[i].id;
      const item = edges.get(kid);
      item.d = d;
      if (item.el) {
        item.el.setAttribute('d', d);
        item.el.classList.toggle('is-dim', dim.has(kid));
      } else {
        (dim.has(kid) ? faint : bright).push(d);
      }
      paths.get(kid)?.setAttribute('d', d);
    });
    fan.el.setAttribute('d', bright.join(''));
    fan.dim.setAttribute('d', faint.join(''));
  }
}

/** The journey setting: a thin line through the visited nodes in visit order. */
function drawJourney() {
  let d = '';
  if (settings.highlight === 'journey' && map) {
    const points = journeyList().map((v) => shown.get(v.id)?.pos).filter(Boolean);
    for (let i = 1; i < points.length; i++) d += linkPath(points[i - 1], points[i]);
  }
  journeyLine.setAttribute('d', d);
}

const journeyList = () => journeyOf(map?.visits, (id) => target.has(id));

/** Whether the whole map is inside the part of the window that the panel does not cover. */
function inView(box) {
  const area = visibleArea();
  const margin = 24;
  return view.x + box.x * view.k >= area.left + margin
    && view.x + (box.x + box.width) * view.k <= area.right - margin
    && view.y + box.y * view.k >= area.top + margin
    && view.y + (box.y + box.height) * view.k <= area.bottom - margin;
}

const toPos = (box) => ({ x: box.x, y: box.y, labelX: box.labelX });
const drawnBox = (item) => ({ ...item.box, ...item.pos });

function drawNodes() {
  const g = GEOMETRY;
  for (const item of shown.values()) {
    const { x, y, labelX } = item.pos;
    const { width, side } = item.box;
    const dot = side === 0 ? g.rootDot : g.dot;
    const left = Math.min(-dot, labelX) - 6;
    const right = Math.max(dot, labelX + width) + 8;
    item.el.setAttribute('transform', `translate(${round(x)} ${round(y)})`);
    // A label on the left side ends at the dot gap, so both sides keep the same gap at any weight.
    item.label.setAttribute('x', round(side < 0 ? labelX + width : labelX));
    item.hit.setAttribute('x', round(left));
    item.hit.setAttribute('width', round(right - left));
    const markLeft = side < 0 ? labelX - MARK_PAD.text : -dot - MARK_PAD.dot;
    const markRight = side < 0 ? dot + MARK_PAD.dot : labelX + width + MARK_PAD.text;
    item.mark.setAttribute('x', round(markLeft));
    item.mark.setAttribute('width', round(markRight - markLeft));
  }
  drawEdges();
  for (const item of links.values()) {
    const a = shown.get(item.a);
    const b = shown.get(item.b);
    if (a && b) item.el.setAttribute('d', linkPath(a.pos, b.pos));
  }
  drawJourney();
}

/**
 * The nodes that draw faint: while nodes are marked, all the others; with focus on, the branches
 * away from the selected node, or from the current one. The selected node never draws faint.
 */
function dimmed() {
  if (marks.length) return new Set([...target.keys()].filter((id) => !marks.includes(id) && id !== selectedId));
  const at = selectedId ?? currentId();
  if (settings.focus !== 'on' || !target.has(at)) return new Set();
  const keep = lineage(target, at);
  return new Set([...target.keys()].filter((id) => !keep.has(id)));
}

/** Show the selection, the marks and the dimmed nodes, and the links and the bar that go with them. */
function refresh() {
  dim = dimmed();
  for (const [id, item] of shown) {
    const { classList } = item.el;
    const marked = marks.includes(id);
    if (classList.contains('is-marked') !== marked) styleNode(item, byId.get(id));
    classList.toggle('is-selected', id === selectedId);
    classList.toggle('is-marked', marked);
    classList.toggle('is-dim', dim.has(id));
  }
  for (const [id, el] of paths) el.classList.toggle('is-dim', dim.has(id));
  showLinks();
  drawEdges();
  updateTray();
}

/** Cross links show for the hovered and the selected node, or always, or never, as set. */
function showLinks() {
  for (const item of links.values()) {
    const on = settings.links !== 'never' && [item.a, item.b].some((id) => id === hoverId || id === selectedId);
    item.el.classList.toggle('is-shown', on);
    item.el.classList.toggle('is-dim', dim.has(item.a) || dim.has(item.b));
  }
}

function drawView() {
  world.setAttribute('transform', `translate(${round(view.x)} ${round(view.y)}) scale(${view.k.toFixed(4)})`);
}

function requestFrame() {
  if (!frameId) frameId = requestAnimationFrame(frame);
}

function frame(now) {
  frameId = 0;
  if (slide) {
    const t = Math.min(1, (now - slide.start) / MOVE_MS);
    const e = easeOut(t);
    for (const item of shown.values()) {
      const to = item.box;
      item.pos = { x: lerp(item.from.x, to.x, e), y: lerp(item.from.y, to.y, e), labelX: lerp(item.from.labelX, to.labelX, e) };
    }
    if (t >= 1) slide = null;
    drawNodes();
  }
  if (pan) {
    const t = Math.min(1, (now - pan.start) / pan.ms);
    const e = easeOut(t);
    view.x = lerp(pan.from.x, pan.to.x, e);
    view.y = lerp(pan.from.y, pan.to.y, e);
    view.k = lerp(pan.from.k, pan.to.k, e);
    if (t >= 1) pan = null;
    drawView();
  }
  if (slide || pan) requestFrame();
}

// ── The view ──────────────────────────────────────────────────────────

/** Where the view is going: the end of the running move, or where it is. */
const viewTarget = () => (pan ? pan.to : view);

/** The part of the window that the panel does not cover. */
function visibleArea() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  let right = width;
  if (panelOpen) right = Math.max(width * 0.4, panel.offsetLeft - 12); // offsetLeft ignores the slide-in offset
  return { left: 0, top: 0, right, bottom: height };
}

/** The part of the window where a selected node is in clear view: inside the margins, left of the panel, above the bar. */
function freeArea(margin = VIEW_MARGIN) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const right = panelOpen ? Math.max(width * 0.4, panel.offsetLeft - Math.max(margin, PANEL_GAP)) : width - margin;
  return { left: margin, top: margin, right, bottom: height - margin - (marks.length ? TRAY_SPACE : 0) };
}

function fitView() {
  const area = visibleArea();
  const w = area.right - area.left;
  const h = area.bottom - area.top;
  const k = clamp(Math.min((w - 2 * FIT_PAD) / (bounds.width || 1), (h - 2 * FIT_PAD) / (bounds.height || 1)), ZOOM_MIN, FIT_MAX);
  return {
    k,
    x: area.left + w / 2 - (bounds.x + bounds.width / 2) * k,
    y: area.top + h / 2 - (bounds.y + bounds.height / 2) * k,
  };
}

function moveView(to, ms = PAN_MS) {
  if (reduceMotion.matches) {
    pan = null;
    Object.assign(view, to);
    drawView();
    return;
  }
  pan = { start: performance.now(), ms, from: { ...view }, to };
  requestFrame();
}

function fit() {
  if (!bounds) return;
  follow = true;
  moveView(fitView());
}

/** Where a node, its dot and its label with the selection mark around them, is in the window at a view. */
function screenRect(box, v = view) {
  const pad = GEOMETRY.dot + MARK_PAD.dot;
  return {
    left: v.x + (box.x + Math.min(box.labelX - MARK_PAD.text, -pad)) * v.k,
    right: v.x + (box.x + Math.max(box.labelX + box.width + MARK_PAD.text, pad)) * v.k,
    top: v.y + (box.y - GEOMETRY.row / 2) * v.k,
    bottom: v.y + (box.y + GEOMETRY.row / 2) * v.k,
  };
}

/**
 * Pan a node into clear view when it is out of the window, near its edge or under the panel. A
 * short way goes by the shortest move; a long way puts the node in the middle.
 */
function bringIntoView(id) {
  const box = target.get(id);
  if (!box || drag?.moved) return;
  const v = viewTarget();
  const r = screenRect(box, v);
  const area = freeArea();
  let dx = 0;
  let dy = 0;
  if (r.left < area.left || r.right - r.left > area.right - area.left) dx = area.left - r.left;
  else if (r.right > area.right) dx = area.right - r.right;
  if (r.top < area.top) dy = area.top - r.top;
  else if (r.bottom > area.bottom) dy = area.bottom - r.bottom;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  const far = Math.abs(dx) > (area.right - area.left) / 3 || Math.abs(dy) > (area.bottom - area.top) / 3;
  if (!far) {
    moveView({ k: v.k, x: v.x + dx, y: v.y + dy }, STEP_MS);
    return;
  }
  const middle = box.x + (Math.min(box.labelX, -GEOMETRY.dot) + Math.max(box.labelX + box.width, GEOMETRY.dot)) / 2;
  moveView({
    k: v.k,
    x: (area.left + area.right) / 2 - middle * v.k,
    y: (area.top + area.bottom) / 2 - box.y * v.k,
  });
}

function zoomAt(clientX, clientY, k) {
  const next = clamp(k, ZOOM_MIN, ZOOM_MAX);
  pan = null;
  follow = false;
  view.x = clientX - (clientX - view.x) * (next / view.k);
  view.y = clientY - (clientY - view.y) * (next / view.k);
  view.k = next;
  drawView();
}

/** Zoom by keys, around the selected node when it is in view, else around the middle of the free area. */
function zoomTo(k) {
  const v = viewTarget();
  const next = clamp(k, ZOOM_MIN, ZOOM_MAX);
  const area = freeArea(0);
  let anchor = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  const box = target.get(selectedId);
  if (box) {
    const at = { x: v.x + box.x * v.k, y: v.y + box.y * v.k };
    if (at.x > area.left && at.x < area.right && at.y > area.top && at.y < area.bottom) anchor = at;
  }
  follow = false;
  moveView({ k: next, x: anchor.x - (anchor.x - v.x) * (next / v.k), y: anchor.y - (anchor.y - v.y) * (next / v.k) }, STEP_MS);
}

// A pinch on a trackpad sends wheel events with ctrlKey, and so does Ctrl with a mouse wheel: they
// zoom. Any other wheel pans: two fingers on a trackpad, or a mouse wheel (with Shift, sideways).
let gesture = null; // Safari sends pinch as gesture events
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (gesture) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  if (e.ctrlKey) {
    zoomAt(e.clientX, e.clientY, view.k * Math.exp(-clamp(e.deltaY * unit, -25, 25) * 0.01));
    return;
  }
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  pan = null;
  follow = false;
  view.x -= dx;
  view.y -= dy;
  drawView();
}, { passive: false });

canvas.addEventListener('gesturestart', (e) => { e.preventDefault(); gesture = { k: view.k }; });
canvas.addEventListener('gesturechange', (e) => { e.preventDefault(); if (gesture) zoomAt(e.clientX, e.clientY, gesture.k * e.scale); });
canvas.addEventListener('gestureend', (e) => { e.preventDefault(); gesture = null; });

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag) return;
  pan = null;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, node: e.target.closest('.node')?.dataset.id ?? null };
  try { canvas.setPointerCapture(e.pointerId); } catch {} // a synthetic event has no live pointer
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    follow = false;
    canvas.classList.add('is-panning');
  }
  view.x = drag.vx + dx;
  view.y = drag.vy + dy;
  drawView();
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const { moved, node } = drag;
  drag = null;
  canvas.classList.remove('is-panning');
  if (cancelled || moved) return;
  if (node && byId.has(node)) {
    if (e.shiftKey) toggleMarkOf(node);
    else openPanel(node, { focus: true });
  } else if (!e.shiftKey) {
    closePanel();
    select(null);
  }
}

canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

// A touch has no hover. While the map pans, the canvas holds the pointer, so no node is hovered.
canvas.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'touch') setHover(e.target.closest?.('.node')?.dataset.id ?? null);
});
canvas.addEventListener('pointerleave', () => setHover(null));

function setHover(id) {
  if (hoverId === id) return;
  hoverId = id;
  showLinks();
}

// Tab moves the focus from node to node. The focused node is the selected one, and the selection
// mark is its focus mark. A press on a node selects it when the pointer goes up, not here.
canvas.addEventListener('focusin', (e) => {
  const id = e.target.closest?.('.node')?.dataset.id;
  if (id && !drag && id !== selectedId) select(id);
});

// ── Selection ─────────────────────────────────────────────────────────

/**
 * Select a node, or nothing with null. The open panel follows the selection. With focus, the
 * keyboard focus goes to the node too. With reveal, the view pans to the node when it needs to.
 */
function select(id, { focus = false, reveal = true } = {}) {
  if (id !== null && !target.has(id)) return;
  if (id !== selectedId) {
    selectedId = id;
    if (id) {
      history.push(id);
      if (history.length > 200) history.shift();
    }
    refresh();
    if (panelOpen) {
      if (id) renderPanel(true);
      else closePanel();
    }
  }
  if (id === null) {
    if (document.activeElement?.closest?.('.node')) document.activeElement.blur();
    return;
  }
  if (focus) shown.get(id)?.el.focus({ preventScroll: true });
  if (reveal) bringIntoView(id);
}

function arrow(key) {
  if (!selectedId) {
    select(currentId() ?? 'goal', { focus: true });
    return;
  }
  const next = move(target, selectedId, key, recency(map.visits, history));
  if (next) select(next, { focus: true });
}

function jump(id) {
  if (id && target.has(id)) select(id, { focus: true });
}

function stepThroughJourney(delta) {
  const next = stepJourney(journeyList(), selectedId, journeyIndex, delta);
  if (!next) return;
  journeyIndex = next.index;
  select(next.id, { focus: true });
}

// ── Marks and compare ─────────────────────────────────────────────────

function toggleMarkOf(id) {
  const result = toggleMark(marks, id);
  if (!result.changed) {
    clearTimeout(limitTimer);
    limitTimer = setTimeout(() => { limitTimer = 0; updateTray(); }, LIMIT_MS);
    updateTray();
    return;
  }
  marks = result.marks;
  refresh();
}

function clearMarks() {
  if (!marks.length) return;
  marks = [];
  refresh();
}

function updateTray() {
  const count = marks.length;
  if (count) trayCount.textContent = limitTimer ? `Up to ${MAX_MARKS} nodes` : `${count} marked`;
  tray.classList.toggle('is-shown', count > 0);
  tray.inert = count === 0;
}

$('tray-compare').addEventListener('click', () => openCompare());
$('tray-clear').addEventListener('click', clearMarks);

const compareOpen = () => compare.open;

function openCompare() {
  if (!marks.length) return;
  renderCompare(true);
  if (!compare.open) compare.showModal();
}

function closeCompare() {
  if (compare.open) compare.close();
}

/** One column for each marked node. A live update keeps the scroll position. */
function renderCompare(fresh) {
  const nodes = marks.map((id) => byId.get(id)).filter(Boolean);
  const source = JSON.stringify(nodes.map((n) => [n, stateLine(n), pathOf(target, n.id)]));
  if (!fresh && source === compareSource) return;
  compareSource = source;
  const { scrollLeft, scrollTop } = compareBody;
  compareBody.replaceChildren(...nodes.map(compareColumn));
  if (fresh) compareBody.scrollTo(0, 0);
  else compareBody.scrollTo(scrollLeft, scrollTop);
}

function compareColumn(node) {
  const col = element('article', 'compare-col');
  const head = element('header', 'compare-head');
  head.append(
    element('h3', 'compare-label', node.label),
    element('p', 'compare-meta', stateLine(node)),
    element('p', 'compare-meta compare-path', pathOf(target, node.id).map((id) => byId.get(id)?.label).join(' › ')),
  );
  const note = element('div', 'prose');
  note.innerHTML = renderMarkdown(node.note);
  col.append(head, note);
  if (node.attachments.length) {
    const section = element('section', 'section');
    const list = element('ul', 'section-list');
    list.append(...node.attachments.map(fileRow));
    section.append(element('h4', 'section-title', 'Attachments'), list);
    col.append(section);
  }
  return col;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

$('compare-close').addEventListener('click', closeCompare);

// ── Find ──────────────────────────────────────────────────────────────

let findOpen = false;
let results = [];
let active = 0;

function openFind() {
  findOpen = true;
  find.hidden = false;
  findInput.value = '';
  active = 0;
  renderResults();
  findInput.focus();
}

function closeFind({ restore = true } = {}) {
  if (!findOpen) return;
  findOpen = false;
  find.hidden = true;
  results = [];
  findList.replaceChildren();
  if (restore && selectedId) shown.get(selectedId)?.el.focus({ preventScroll: true });
}

function renderResults() {
  const query = findInput.value;
  results = findNodes(map.nodes.filter((n) => target.has(n.id)), query);
  active = clamp(active, 0, Math.max(0, results.length - 1));
  const items = results.map((r, i) => {
    const li = element('li', 'find-item');
    li.id = `find-${i}`;
    li.setAttribute('role', 'option');
    li.append(element('span', 'find-label', r.label));
    if (r.snippet) li.append(element('span', 'find-snippet', r.snippet));
    li.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus in the field
    li.addEventListener('click', () => jumpTo(r.id));
    li.addEventListener('pointermove', () => { if (active !== i) { active = i; showActive(); } });
    return li;
  });
  if (query.trim() && !results.length) {
    const none = element('li', 'find-none', 'No node matches.');
    none.setAttribute('role', 'presentation');
    items.push(none);
  }
  findList.replaceChildren(...items);
  findInput.setAttribute('aria-expanded', String(results.length > 0));
  showActive();
}

function showActive() {
  findList.querySelectorAll('.find-item').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
  if (results.length) findInput.setAttribute('aria-activedescendant', `find-${active}`);
  else findInput.removeAttribute('aria-activedescendant');
}

function jumpTo(id) {
  closeFind({ restore: false });
  jump(id);
}

findInput.addEventListener('input', () => { active = 0; renderResults(); });
findInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    showActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (results[active]) jumpTo(results[active].id);
  }
});
findInput.addEventListener('blur', () => closeFind({ restore: false }));

// ── Sheet ─────────────────────────────────────────────────────────────

function openSheet() {
  if (sheet.open) return;
  sheet.showModal();
  sheet.focus(); // the sheet, not its first option, so no option shows a focus ring at first
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

$('sheet-button').addEventListener('click', () => (sheet.open ? closeSheet() : openSheet()));
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // a click outside the sheet

// ── Side panel ────────────────────────────────────────────────────────

function stateLine(node) {
  const steps = (map?.visits ?? []).filter((v) => v.id === node.id).map((v) => v.step);
  const parts = [];
  if (node.id === 'goal') parts.push('Goal');
  parts.push(node.state[0].toUpperCase() + node.state.slice(1));
  if (steps.length) parts.push(`${steps.length === 1 ? 'step' : 'steps'} ${steps.join(', ')}`);
  return parts.join(' · ');
}

/** Select a node and open the panel on it. */
function openPanel(id, { focus = false } = {}) {
  if (!target.has(id)) return;
  select(id, { focus, reveal: false });
  if (!panelOpen) {
    panelOpen = true;
    renderPanel(true);
    panel.inert = false;
    panel.classList.add('is-open');
    document.body.classList.add('has-panel');
  }
  clearPanel(id);
}

/** Open a related node from the panel and pan to it. */
function openRelated(id) {
  select(id);
  panelTitle.focus({ preventScroll: true }); // the list that held the focus is new
}

/**
 * When the open node is under the panel, too close to it or out of the window, pan by the shortest
 * move that puts it in the free area left of the panel, with the labels just above and below it
 * that the panel covers. A node that is clear of the panel does not move the map.
 */
function clearPanel(id) {
  const box = target.get(id);
  if (!box || drag?.moved) return;
  const v = viewTarget();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const cover = { // the panel and the gap around it; offsetLeft ignores the slide-in offset
    left: panel.offsetLeft - PANEL_GAP,
    top: panel.offsetTop - PANEL_GAP,
    bottom: panel.offsetTop + panel.offsetHeight + PANEL_GAP,
  };
  const under = (r) => r.right > cover.left && r.bottom > cover.top && r.top < cover.bottom;
  const node = screenRect(box, v);
  const outside = node.left < 0 || node.right > width || node.top < 0 || node.bottom > height;
  if (!under(node) && !outside) return;

  const free = { left: PANEL_GAP, right: Math.max(width * 0.4, cover.left), top: PANEL_GAP, bottom: height - PANEL_GAP };
  const middle = (node.top + node.bottom) / 2;
  let right = node.right;
  for (const other of target.values()) {
    const r = screenRect(other, v);
    if (Math.abs((r.top + r.bottom) / 2 - middle) <= NEAR_Y && under(r)) right = Math.max(right, r.right);
  }
  // The node itself always ends up in the free area. The labels near it go as far as that allows.
  const dx = clamp(Math.min(0, free.right - right), free.left - node.left, free.right - node.right);
  const dy = clamp(0, free.top - node.top, free.bottom - node.bottom);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  moveView({ k: v.k, x: v.x + dx, y: v.y + dy });
}

function closePanel() {
  if (!panelOpen) return;
  if (panel.contains(document.activeElement)) shown.get(selectedId)?.el.focus({ preventScroll: true });
  panelOpen = false;
  panel.classList.remove('is-open');
  panel.inert = true;
  document.body.classList.remove('has-panel');
}

/** Fill the panel. A live update changes only what changed and keeps the scroll position. */
function renderPanel(fresh) {
  const node = byId.get(selectedId);
  if (!node) { closePanel(); return; }
  panelTitle.textContent = node.label;
  panelState.textContent = stateLine(node);
  if (fresh || panelSource.note !== node.note) {
    panelNote.innerHTML = renderMarkdown(node.note);
    panelSource.note = node.note;
  }
  const files = JSON.stringify(node.attachments);
  if (fresh || panelSource.files !== files) {
    panelFiles.hidden = node.attachments.length === 0;
    panelFilesList.replaceChildren(...node.attachments.map(fileRow));
    panelSource.files = files;
  }
  const related = relatedOf(node.id);
  const relatedKey = JSON.stringify(related.map((n) => [n.id, n.label]));
  if (fresh || panelSource.related !== relatedKey) {
    renderRelated(related);
    panelSource.related = relatedKey;
  }
  if (fresh) panelBody.scrollTop = 0;
}

/** The nodes that a cross link joins to a node, in the order the links were made. */
function relatedOf(id) {
  const found = [];
  for (const [a, b] of map.links ?? []) {
    const other = byId.get(a === id ? b : b === id ? a : null);
    if (other && target.has(other.id) && !found.includes(other)) found.push(other);
  }
  return found;
}

function renderRelated(nodes) {
  panelRelated.hidden = nodes.length === 0;
  panelRelatedList.replaceChildren(...nodes.map((node) => {
    const li = document.createElement('li');
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'row';
    control.addEventListener('click', () => openRelated(node.id));
    control.append(element('span', 'row-title', node.label));
    li.append(control);
    return li;
  }));
}

/** One attachment as a row: a link opens in a new tab, a file in the lightbox. */
function fileRow(item) {
  const li = document.createElement('li');
  let control;
  if (item.type === 'link') {
    control = document.createElement('a');
    if (/^https?:\/\//i.test(item.url)) control.href = item.url;
    control.target = '_blank';
    control.rel = 'noopener noreferrer';
  } else {
    control = document.createElement('button');
    control.type = 'button';
    control.addEventListener('click', () => openLightbox(item));
  }
  control.className = 'row';
  control.append(
    element('span', 'row-title', item.title || item.url || item.file),
    element('span', 'row-meta', TYPE_NAMES[item.type] ?? 'File'),
  );
  li.append(control);
  return li;
}

$('panel-close').addEventListener('click', closePanel);

// ── Lightbox ──────────────────────────────────────────────────────────

const fileUrl = (file) => `/${String(file).split('/').map(encodeURIComponent).join('/')}`;
const fileName = (file) => String(file ?? '').split('/').pop();

function openLightbox(item) {
  lightboxItem = item;
  lightboxTitle.textContent = item.title || fileName(item.file);
  lightboxOpen.href = fileUrl(item.file);
  lightbox.classList.remove('is-closing');
  fillLightbox(false);
  if (!lightbox.open) lightbox.showModal();
  $('lightbox-close').focus();
}

function closeLightbox() {
  if (!lightbox.open || !lightboxItem) return;
  lightboxItem = null;
  lightbox.classList.add('is-closing');
  setTimeout(() => {
    if (lightboxItem) return; // opened again meanwhile
    lightbox.close();
    lightbox.classList.remove('is-closing');
    lightboxBody.replaceChildren();
  }, 180);
}

function lightboxMessage(text) {
  lightboxBody.replaceChildren(element('p', 'lightbox-note', text));
}

/** Show the attachment. With reload, load it again from disk and keep what can be kept. */
async function fillLightbox(reload) {
  const item = lightboxItem;
  if (!item) return;
  const url = fileUrl(item.file) + (reload ? `?v=${Date.now()}` : '');

  if (item.type === 'html' || item.type === 'pdf') {
    let frame = lightboxBody.querySelector('iframe');
    if (!frame || !reload) {
      frame = document.createElement('iframe');
      frame.title = item.title || fileName(item.file);
      if (item.type === 'html') frame.setAttribute('sandbox', SANDBOX); // Chrome shows no PDF in a sandbox
      lightboxBody.replaceChildren(frame);
    }
    frame.src = url;
    return;
  }

  if (item.type === 'image') {
    const img = new Image();
    img.alt = item.title || '';
    img.src = url;
    try { await img.decode(); } catch { if (lightboxItem === item) lightboxMessage('The image does not load. The file can be missing.'); return; }
    if (lightboxItem !== item) return;
    const wrap = element('div', 'lightbox-media');
    wrap.append(img);
    lightboxBody.replaceChildren(wrap);
    return;
  }

  if (item.type === 'markdown' || item.type === 'text') {
    let text;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      text = await res.text();
    } catch {
      if (lightboxItem === item) lightboxMessage('The file does not load. It can be missing.');
      return;
    }
    if (lightboxItem !== item) return;
    let doc = reload ? lightboxBody.querySelector('.lightbox-doc') : null;
    const scroll = doc?.scrollTop ?? 0;
    if (!doc) {
      doc = element('div', 'lightbox-doc');
      doc.append(element('div', 'prose'));
      lightboxBody.replaceChildren(doc);
    }
    doc.firstElementChild.innerHTML = item.type === 'markdown' ? renderMarkdown(text) : renderText(text);
    doc.scrollTop = scroll;
    return;
  }

  lightboxMessage('This file type has no preview. Use Open in new tab.');
}

function onFileChange(name) {
  if (lightboxItem?.file && fileName(lightboxItem.file) === name) fillLightbox(true);
}

$('lightbox-close').addEventListener('click', closeLightbox);

// ── Keys ──────────────────────────────────────────────────────────────

/** Close the top layer: the lightbox, the sheet, find, compare, the panel, then the selection. */
function closeTop() {
  if (lightboxItem) closeLightbox();
  else if (sheet.open) closeSheet();
  else if (findOpen) closeFind();
  else if (compareOpen()) closeCompare();
  else if (panelOpen) closePanel();
  else if (selectedId) select(null);
  else return false;
  return true;
}

// Esc is handled on keydown. A dialog that gets a close request in another way, such as the back
// gesture on a phone, closes the top layer too.
let escapeAt = -Infinity;
for (const dialog of [lightbox, sheet, compare]) {
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (performance.now() - escapeAt > 200) closeTop();
  });
}

const typing = (el) => Boolean(el?.closest?.('textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="radio"], [type="checkbox"], [type="button"], [type="submit"], [type="reset"])'));
const onMap = (el) => el === document.body || el === document.documentElement || canvas.contains(el);
const REPEATS = new Set(['[', ']', '+', '=', '-', '_']);

/** The action of a key on the map, or null. */
function command(e) {
  const { key } = e;
  const letter = key.length === 1 ? key.toLowerCase() : '';
  if (ARROWS[key]) return () => arrow(ARROWS[key]);
  if (e.repeat && !REPEATS.has(key)) return null;
  if (key === 'Enter' || key === ' ') return onMap(e.target) ? () => openPanel(selectedId ?? currentId() ?? 'goal', { focus: true }) : null;
  if (key === '[' || key === ']') return () => stepThroughJourney(key === '[' ? -1 : 1);
  if (key === '.') return () => jump(currentId());
  if (letter === 'g') return () => jump('goal');
  if (key === '/') return openFind;
  if (letter === 'f') return fit;
  if (key === '+' || key === '=') return () => zoomTo(viewTarget().k * ZOOM_STEP);
  if (key === '-' || key === '_') return () => zoomTo(viewTarget().k / ZOOM_STEP);
  if (key === '0') return () => zoomTo(1);
  if (letter === 'x') return e.shiftKey ? clearMarks : () => { if (selectedId) toggleMarkOf(selectedId); };
  if (letter === 'v') return marks.length ? openCompare : null;
  if (key === '?') return openSheet;
  return null;
}

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.defaultPrevented) return;
  if (e.key === 'Escape') {
    escapeAt = performance.now();
    if (closeTop()) e.preventDefault();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || lightboxItem || !map) return;
  if (sheet.open) {
    if (e.key === '?') { e.preventDefault(); closeSheet(); }
    return;
  }
  if (compareOpen()) {
    if (e.key === '?') { e.preventDefault(); openSheet(); } else if (e.key.toLowerCase() === 'v' && !e.repeat) { e.preventDefault(); closeCompare(); }
    return;
  }
  const action = command(e);
  if (!action) return;
  e.preventDefault();
  action();
});

addEventListener('resize', () => {
  if (!follow || !bounds) return;
  pan = null;
  Object.assign(view, fitView());
  drawView();
});

// ── Connection ────────────────────────────────────────────────────────

let disconnected = false;
let mapError = '';
let statusTimer = 0;
let retries = 0;

function showStatus() {
  const text = disconnected ? 'Disconnected. Reconnecting.'
    : mapError ? 'map.json is invalid. The map shows the last good version.' : '';
  if (text) status.textContent = text;
  status.classList.toggle('is-shown', Boolean(text));
}

let pending = null;
let busy = false;
async function receive(next) {
  pending = next;
  if (busy) return;
  busy = true;
  while (pending) {
    const latest = pending;
    pending = null;
    await loadFonts(latest);
    apply(latest);
  }
  busy = false;
}

function connect() {
  const source = new EventSource('/events');
  source.addEventListener('open', () => {
    retries = 0;
    clearTimeout(statusTimer);
    statusTimer = 0;
    disconnected = false;
    showStatus();
  });
  source.addEventListener('map', (e) => {
    mapError = '';
    showStatus();
    receive(JSON.parse(e.data));
  });
  source.addEventListener('map-error', (e) => {
    mapError = JSON.parse(e.data).message;
    showStatus();
  });
  source.addEventListener('file', (e) => onFileChange(JSON.parse(e.data).name));
  source.addEventListener('error', () => {
    source.close();
    if (!disconnected && !statusTimer) {
      statusTimer = setTimeout(() => { statusTimer = 0; disconnected = true; showStatus(); }, 600);
    }
    setTimeout(connect, Math.min(8000, 400 * 1.6 ** retries++));
  });
}

connect();

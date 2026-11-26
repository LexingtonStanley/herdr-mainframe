// Mainframe Grid: every agent on one screen, as a night city. Each computer is a tower, each
// space a room in it, each agent its character (cast.js) standing in its room with what it
// is doing: status, model, effort, context used, task. A screen to stay on: click an agent and
// its session opens in the dock beside the towers, a live terminal to type in; double-click goes
// to it at the desk. Right-click gives it another character. Esc closes the dock, then returns
// to the desk, as do the Back button and the key (mainframe-grid.toggle).
// With the keyboard: arrows pick an agent (left/right the next one, up/down the next room),
// Enter opens it in the dock to type in, Space opens it there and stays on the towers,
// Shift+Enter goes to it at the desk, C changes its character.
// Agents an agent started (on this computer or another) are its family: they share a colour,
// say who started them, and light up together when one is picked, hovered or open.
// What an agent started that has no pane of its own is its crew, in bunks beside it: the agents
// and programs it ran in a terminal (hc run) and its own sub-agents (Claude's Agent tool). Each
// has a card to click: a terminal opens in the dock, a sub-agent's transcript opens there, live.
// N, W and D (or a click on a count in the bar) go round the agents that need you, work, are done.
//
// Every colour is the theme's (skin, below): the Grid is the desk's other screen, not another
// product. Only the characters keep their own colours: they are pictures.
//
// One mod, seven views, picked by the layout with props.view:
//   "bar"    the strip across the top (a window_drag block): title, counts, Back, window buttons
//   "scene"  the towers
//   "dock"   the header over the dock's terminal: who it is, its family, Open at desk, close
//   "keys"   nothing to see: a 0px block that is always shown, so the key works on both screens
//            (a mod only gets its key commands while shown)
//   "picker" the character picker (a dialog this mod opens)
//   "help"   the Grid's mouse and keys, on one card (a dialog this mod opens)
//   "blank"  an empty block (see init)
// The layout's root holds a stack "deck" with two children: "desktop" (Over9k) and "grid". The
// grid is the bar over a row: the scene, and the dock (DOCK, below).
// Model, effort and context come from the sidebar (mainframe-side shares "mainframe.info").
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, spaces, machines, terminals, theme, run, shared, setShared, layout, props, nextCommand, checking, exec, readTextFile, writeTextFile, appHome, window, openOverlay, closeOverlay, focused, fonts, home, settings } from "herdr";
import { casting, recast, face, body, ROSTER } from "./cast.js";
import { agentTask, isCodex, clean } from "./agent-name.js";
import { Reader } from "./reader.js";

const MOD = "mainframe-grid", BRAND = "MAINFRAME";
const DECK = "deck";
// This layout's own options (the options dialog writes them): `backdrop` the skyline behind the
// towers, `spaceColors` "theme" (a space's colour is the theme's ansi colour) or "vivid" (the
// sidebar's fixed strong colours, the same in every theme).
const OPTIONS = "mainframe.options";
const options = () => ({ backdrop: true, spaceColors: "theme", ...(shared(OPTIONS) ?? {}) });

// Colours. `mix`: k of a over b, opaque; `fade`: c at alpha 0..1 (theme colours may carry
// their own alpha, e.g. border: it is replaced).
const rgb = (c) => { const h = String(c).replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0); };
const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => hex(y[i] + (v - y[i]) * k)).join("")}`; };
const fade = (c, a) => `#${String(c).replace("#", "").slice(0, 6)}${hex(a * 255)}`;
// The scene's colours, from the theme: `ink` the night, `bar` the strip, `room` a room (a
// terminal card's colour), `wall` walls, slabs and masts (opaque: rooms sit on it), `line`
// tracks and rules, `far`/`near` the skyline. Set at each render (render()).
let C = {};
function skin(t) {
  const bg = t.background, fg = t.foreground;
  return { ink: t.canvas, bar: t.chrome, panel: t.popover, room: bg, wall: mix(fg, bg, 0.17), line: mix(fg, bg, 0.24),
    text: fg, dim: t.muted, faint: t.dim, accent: t.accent, on: bg, border: t.border, hover: t.hover, selected: t.selected,
    second: t.ansi5 ?? t.accent, far: mix(fg, t.canvas, 0.05), near: mix(fg, t.canvas, 0.095), lit: fade(t.accent, 0.4) };
}
// A space's sign: the colour its name has in the sidebar (shared "space.colors": an ansi name,
// or a hex), else the accent. "vivid": the sidebar's fixed colours. ansi1 is red in most themes,
// which here means "needs you": the theme's bright magenta stands in for it.
const VIVID = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function hueOf(key, t) {
  if (!key) return t.accent;
  if (key.startsWith("#")) return key;
  if (options().spaceColors === "vivid") return VIVID[key] ?? t[key] ?? t.accent;
  return (key === "ansi1" ? t.ansi13 : t[key]) ?? t.accent;
}

const ROOM_PAD = 8, SIGN_H = 30, SLAB = 8, WALL = 4, ROOF = 78, STREET = 26, PAD = 28, GAP = 36;
// How many of an agent's crew share one bunk (a bunk takes a station's place in the room).
const BUNK = 3;
// Sizes for a character drawn at `cell` px a cell (it is 14 × 24 cells): 4, 5 or 6, the biggest
// that lets every tower fit the window (plan). `up` is how many steps past the smallest.
function metrics(cell) {
  const sw = 14 * cell, sh = 24 * cell, up = cell - 4;
  const stationW = sw + 166 + up * 14, stationH = sh + 26;
  // A bunk is a station's size: a heading and BUNK crew cards, one above the other.
  const bunkHead = 14 + up * 2, card = Math.floor((stationH - bunkHead - (BUNK - 1) * 3 - 2) / BUNK);
  // unit: a tower is this much wider for each station across.
  return { cell, up, sw, sh, stationW, stationH, bunkHead, card, unit: stationW + 2 * ROOM_PAD + WALL };
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const showing = () => find(layout(), DECK)?.active ?? "desktop";
function show(child) {
  run("layout.select", { stack: DECK, child });
  // Back at the desk, the keyboard goes back to the terminal it was in.
  if (child === "desktop") { const f = focused(); if (f) run("pane.focus", f.pane ? { pane: f.pane } : { terminal: f.terminal }); }
}
function goTo(a, active) {
  run("layout.select", { stack: DECK, child: "desktop" });
  if (a.space !== active) run("space.select", { id: a.space });
  run("tab.select", { id: a.tab });
  run("pane.focus", { pane: a.pane });
}

// The dock: a column beside the scene ("grid-dock") with a header (this mod, view "dock") over a
// terminal block ("grid-term"): an agent's session, live, typed in as at the desk. The desk behind
// the Grid stays where it was. Which agent is shared ("mainframe.dock") so the header and the
// scene agree. A layout from before the dock: a click goes to the agent at the desk, as it used to.
const DOCK = "grid-dock", DOCK_TERM = "grid-term", DOCKED = "mainframe.dock";
const VIEW = "mainframe.dock.view";
const hasDock = () => Boolean(find(layout(), DOCK));
const dockOpen = () => { const d = find(layout(), DOCK); return Boolean(d && !d.hidden); };
const docked = () => (dockOpen() ? shared(DOCKED) ?? null : null);
// The dock's terminal block as the layout ships it. Herdr takes a terminal block out of the layout
// file when its terminal ends (only a block showing the focused agent stays), so after a docked
// session ends the dock has no block until this one is put back: first in the display stack, or
// after the dock's header in a layout from before the stack. Null when the dock isn't there.
const DOCK_BLOCK = { id: DOCK_TERM, type: "block", content: { agent: "focused" }, background: "background",
  border: { width: 1, color: "border" }, radius: 10, focus: { border: { width: 1, color: "accent" } } };
function restoreDockBlock(tree) {
  const display = find(tree, "grid-display"), dock = find(tree, DOCK), parent = display ?? dock;
  if (!Array.isArray(parent?.children)) return null;
  const block = JSON.parse(JSON.stringify(DOCK_BLOCK));
  const at = display ? 0 : parent.children.findIndex((c) => c.id === "grid-dock-head") + 1;
  parent.children.splice(at, 0, block);
  return block;
}
// The dock's stack shows the terminal block, once there is one (asked for a child it doesn't have,
// Herdr says so in a toast).
function selectDockTerm() {
  const l = layout(), display = find(l, "grid-display");
  if (display && display.children?.some((c) => c.id === DOCK_TERM)) run("layout.select", { stack: "grid-display", child: DOCK_TERM });
}
// Puts `address` in the dock's terminal block. A block names its terminal, so this writes it into
// the layout's file (only that block's content changes; Herdr reloads the layout and keeps your
// clicks). Not layout.set: Herdr refuses a tree nested as deep as this layout. False when the
// layout has no dock to put a block in.
// A write that finds the file changed since it was read (two quick clicks) reads it again, once.
async function dockTerminal(address, again = true) {
  const name = shared("layout"), path = name ? `${appHome()}/layouts/${name}.json` : null;
  const text = path ? await readTextFile(path) : null;
  let tree = null;
  try { tree = text ? JSON.parse(text) : null; } catch {}
  if (!tree || shared(DOCKED) !== address) return false;
  const term = find(tree, DOCK_TERM) ?? restoreDockBlock(tree);
  if (!term) return false;
  if (term.content?.terminal === address) return true;
  term.content = { terminal: address };
  try { await writeTextFile(path, `${JSON.stringify(tree, null, 2)}\n`, text); } catch (e) { if (again) return dockTerminal(address, false); throw e; }
  return true;
}
// `keyboard`: typing goes to it. pane.focus {terminal} picks a shown terminal block over the
// desk's pane, so it waits until the dock shows it: asked sooner it would focus the desk's pane
// behind the Grid, where typing can't be seen. Not there within a second: the keyboard stays put.
function openDock(address, keyboard, cx) {
  setShared(DOCKED, address);
  setShared(VIEW, null);
  selectDockTerm();
  cx.spawn(async (cx) => {
    // No terminal block to set (a layout whose dock has an agent block): agent.focus picks for it.
    const block = await dockTerminal(address).catch(() => false);
    if (shared(DOCKED) !== address || showing() !== "grid") return;
    if (!block) run("agent.focus", { terminal: address });
    run("layout.show", { id: DOCK });
    // Once Herdr has reloaded the file with the block showing this terminal: the stack shows it
    // (it may have been put back just now), and with `keyboard` typing goes there.
    for (let i = 0; block && i < 20; i++) {
      if (shared(DOCKED) !== address || showing() !== "grid") break;
      if (dockOpen() && find(layout(), DOCK_TERM)?.content?.terminal === address) {
        selectDockTerm();
        if (!keyboard) break;
        await cx.sleep(40);
        if (shared(DOCKED) === address && dockOpen() && showing() === "grid") run("pane.focus", { terminal: address });
        break;
      }
      await cx.sleep(50);
    }
    cx.notify();
  });
}
const closeDock = () => { run("layout.hide", { id: DOCK }); setShared(DOCKED, null); setShared(VIEW, null); };

// Who started whom. Herdr's core records the terminal an agent was started from (hc run: an
// agent's helpers and the agents it hands work to), on this computer or another: terminals()'
// `parent`. An agent with all the agents it started, and theirs, is a family, with a colour of
// its own (the theme's, in a fixed order, so it stays put). What it started that isn't an agent
// (a dev server, a watcher) is in `procs`: part of its crew, not of the family's colours.
// A terminal is an agent's when its program is one, or it reports a status (OSC 7501).
const isAgentTerm = (k) => Boolean(k?.program?.agent || k?.report || (typeof k?.status === "string" && k.status));
// Terminals that are somebody's tool, not somebody's work: this mod's and the sidebar's
// transcript viewers, herdr-nvim's helpers.
const isTool = (k) => Boolean(k?.labels?.mainframe === "view" || k?.labels?.over9k === "view" || /^herdr-nvim/.test(`${k?.name ?? ""}`) || k?.agent === "herdr-nvim");
function families(t) {
  const live = terminals().filter((k) => k.state === "live");
  const by = new Map(live.map((k) => [k.address, k]));
  const parent = new Map(), kids = new Map(), procs = new Map();
  for (const k of live) {
    if (!k.parent || !by.has(k.parent) || isTool(k)) continue;
    if (!isAgentTerm(k)) { procs.set(k.parent, [...(procs.get(k.parent) ?? []), k]); continue; }
    parent.set(k.address, k.parent);
    kids.set(k.parent, [...(kids.get(k.parent) ?? []), k]);
  }
  const rootOf = (a) => { let r = a; for (let i = 0; i < 16 && parent.has(r); i++) r = parent.get(r); return r; };
  const roots = [...new Set([...parent.keys()].map(rootOf))].sort();
  const hues = [t.ansi5, t.ansi6, t.ansi3, t.ansi4, t.ansi2, t.ansi13, t.ansi14, t.ansi11].filter(Boolean);
  const inFamily = (a) => parent.has(a) || kids.has(a);
  const colorOf = (a) => (inFamily(a) && hues.length ? hues[roots.indexOf(rootOf(a)) % hues.length] : null);
  // Everyone in `a`'s family: from its root down.
  const members = (a) => {
    const out = new Set();
    if (!a || !inFamily(a)) return out;
    const walk = (x, depth) => { out.add(x); if (depth < 16) for (const k of kids.get(x) ?? []) walk(k.address, depth + 1); };
    walk(rootOf(a), 0);
    return out;
  };
  return { by, parent, kids, procs, colorOf, members };
}
// An agent's crew: what it started that has no station of its own (`stationed`: the addresses
// that have one), oldest first: agents (and what they started in turn, right after them), then
// programs, then its own sub-agents (`inner`, from the sidebar: no terminal, a transcript).
// Each: { kind: "agent" | "proc" | "sub", key, k (its terminal) or x (the sub-agent), via }.
function crewOf(address, fam, stationed, info) {
  const out = [], age = (a, b) => (a.created_ms ?? 0) - (b.created_ms ?? 0);
  const walk = (from, depth, via) => {
    for (const k of [...(fam.kids.get(from) ?? [])].sort(age)) {
      if (stationed.has(k.address)) continue; // it has a station: its own crew stands by it
      out.push({ kind: "agent", key: k.address, k, via });
      if (depth < 8) walk(k.address, depth + 1, k);
    }
    for (const k of [...(fam.procs.get(from) ?? [])].sort(age)) if (!stationed.has(k.address)) out.push({ kind: "proc", key: k.address, k, via });
    (info[from]?.inner ?? []).forEach((x, i) => out.push({ kind: "sub", key: `sub:${from}:${x.id ?? i}`, x, via, owner: from }));
  };
  walk(address, 0, null);
  return out;
}
// A room's places, in order: each agent's station, then its crew's bunks (BUNK cards each).
function slotsOf(list, crews) {
  const out = [];
  for (const a of list) {
    out.push({ a });
    const crew = crews.get(a.address) ?? [];
    for (let i = 0; i < crew.length; i += BUNK) out.push({ owner: a, crew: crew.slice(i, i + BUNK), from: i, total: crew.length });
  }
  return out;
}
// An agent the cast can give a character to, for a terminal with no pane.
const standIn = (k) => ({ address: k.address, pane: `t:${k.address}`, tab: null, program: k.program, title: k.title ?? "", app: k.report?.app ?? null, name: k.name ?? null });
// Every agent with no pane that another agent started, as stand-ins: with agents(), all the cast has to dress.
const standIns = (real) => terminals().filter((k) => k.state === "live" && k.parent && isAgentTerm(k) && !isTool(k) && !real.some((a) => a.address === k.address)).map(standIn);
// Whose family a pick lights up: its own, or (a sub-agent, a program) that of the agent it belongs to.
function familyOf(key, fam) {
  if (!key) return null;
  if (key.startsWith("sub:")) return key.slice(4, key.lastIndexOf(":"));
  return fam.parent.has(key) || fam.kids.has(key) ? key : fam.by.get(key)?.parent ?? key;
}
// A model named on a command line ("-m gpt-6.1-sol", "--model opus"), for an agent whose
// own files the sidebar doesn't read.
function argvModel(k) {
  const argv = k?.foreground?.argv ?? k?.argv ?? [], text = argv.join(" ");
  const m = /(?:^|\s)(?:-m|--model)[ =]([\w.:\-\[\]]+)/.exec(text);
  return m ? m[1] : null;
}
// A terminal as people know it: its agent's tab name or task (nameOf), else the name it was
// started with, else its program.
function termName(k, a, tabs) {
  if (a) return nameOf(a, tabs.get(a.tab));
  return k?.name || agentTask(standIn(k ?? {}), null) || k?.program?.name || k?.agent || k?.address || "?";
}
// What a crew member is called, and what it is doing.
function crewName(c) {
  if (c.kind === "sub") return c.x.desc || c.x.type || "sub-agent";
  if (c.kind === "proc") return c.k.name || c.k.program?.name || c.k.agent || c.k.address;
  return c.k.name || agentTask(standIn(c.k), null) || c.k.program?.name || c.k.address;
}
// What it is doing: a sub-agent's kind, model and tokens so far; a program's command line; an
// agent's task (its terminal's title: a Codex one's is "<task> | <folder>" until it has a model).
function crewDetail(c) {
  if (c.kind === "sub") return [c.x.type && c.x.type !== c.x.desc ? c.x.type : null, c.x.model, c.x.tokens ? `${Math.round(c.x.tokens / 1000)}k tokens` : null].filter(Boolean).join(" · ");
  if (c.kind === "proc") return (c.k.foreground?.argv ?? c.k.argv ?? []).join(" ");
  const who = standIn(c.k), task = agentTask(who, c.k.cwd) || (isCodex(who) ? clean(String(c.k.title ?? "").split(" | ")[0]) : "");
  return task && task !== c.k.name && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(task) ? task : "";
}
// "lexbox" for a terminal on another computer, null here.
const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : null);
// "3m", "2h", "1d" since a time (ms), or null.
function ago(at) {
  if (!at) return null;
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
// An agent's name, by the sidebar's rule: its tab's when someone named it, else its task, else the program.
function nameOf(a, tab) {
  if (tab && tab.name !== a.program?.name && !/^(\d+|t[0-9a-z]+)$/.test(tab.name)) return tab.name;
  return agentTask(a, null) || a.program?.name || a.address;
}
// A folder as you'd type it: ~ for its computer's home. That home is known when the sidebar has
// shared it; a folder outside it (someone else's) stays whole. Not known: the usual places.
function tilde(folder, home) {
  const d = folder || "~";
  if (home) return d === home || d.startsWith(`${home}/`) ? `~${d.slice(home.length)}` : d;
  return d.replace(/^\/(home|Users)\/[^/]+/, "~");
}
const WORD = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };
// A terminal's status (terminals(): a plain word, or an older core's report).
const statusOf = (k) => (typeof k?.status === "string" ? k.status : k?.status?.state ?? "idle");
const statusColor = (s, t) => (s === "working" ? t.working : s === "blocked" ? t.blocked : s === "done" ? t.done ?? t.accent : t.idle ?? C.faint);

// Rooms onto floors, `cols` stations across: wide rooms first, each on the first floor with
// room for it; a room with more agents than fit across takes a floor to itself (and more rows).
function pack(rooms, cols) {
  const items = rooms.map((r, i) => ({ r, i, w: Math.min(r.slots.length, cols), tall: r.slots.length > cols }));
  const floors = [];
  for (const it of [...items].sort((a, b) => b.w - a.w || a.i - b.i)) {
    let f = it.tall ? null : floors.find((x) => !x.tall && x.used + it.w <= cols);
    if (!f) { f = { used: 0, items: [], tall: it.tall }; floors.push(f); }
    f.items.push(it); f.used += it.w;
  }
  return floors;
}

const rowsOf = (f, cols) => (f.tall ? Math.ceil(f.items[0].r.slots.length / cols) : 1);
// How many stations across each tower gets at these sizes, and how tall that makes them: the
// window's width shared out by how many agents each has, at least one and no more than its
// agents. Too narrow for the towers side by side: `stacked`, one above the other.
function plan(towers, W, m) {
  const total = towers.reduce((sum, tw) => sum + tw.n, 0);
  const fit = Math.max(1, Math.floor((W - 2 * PAD - (towers.length - 1) * GAP - towers.length * 2 * WALL) / m.unit));
  const stacked = fit < towers.length;
  const cols = towers.map((tw) => (stacked ? Math.max(1, Math.min(tw.n, fit)) : Math.max(1, Math.min(tw.n, Math.round(fit * tw.n / total)))));
  const floorsOf = (i) => pack(towers[i].rooms, cols[i]).reduce((a, f) => a + rowsOf(f, cols[i]), 0);
  if (!stacked) {
    const used = () => cols.reduce((a, b) => a + b, 0);
    while (used() > fit) { const i = cols.indexOf(Math.max(...cols)); if (cols[i] <= 1) break; cols[i] -= 1; }
    // Width left over goes to the tower that would otherwise be tallest.
    while (used() < fit) {
      const open = towers.map((_tw, i) => i).filter((i) => cols[i] < towers[i].n).sort((a, b) => floorsOf(b) - floorsOf(a));
      if (!open.length) break;
      cols[open[0]] += 1;
    }
  }
  const heights = towers.map((tw, i) => {
    const floors = pack(tw.rooms, cols[i]);
    return ROOF + WALL + floors.reduce((a, f) => a + SIGN_H + rowsOf(f, cols[i]) * m.stationH + 7, 0) + (floors.length - 1) * SLAB;
  });
  return { cols, stacked, height: stacked ? heights.reduce((a, b) => a + b + GAP, 0) : Math.max(0, ...heights) };
}

export default class Grid extends View {
  init(_props, cx) {
    this.view = props()?.view ?? "scene";
    // "blank": an empty block. The layout's zero-size "screen" stack is made of four, so that
    // Flockbook's own screen switching has somewhere to land (mainframe-tabs shows the real one).
    if (this.view === "blank") return;
    if (this.view === "reader") {
      this.reader = new Reader();
      if (!checking()) cx.timer.every(1500, cx => {
        if (showing() === "grid" && dockOpen()) this.reader.refresh(shared(VIEW), cx);
      });
      return;
    }
    this.size = null;
    this.host = null;
    this.sel = null; // the agent the keyboard has picked (its address), in the scene
    this.hover = null; // the agent under the pointer, in the scene: its family lights up
    this.order = []; this.roomStarts = []; // the agents and crew as drawn (their keys), and where each room starts
    this.pickable = new Map(); // key -> what stands there: { a } an agent's station, or { c, owner } a crew card
    this.scroll = null; this.reveal = false; // the scene's scroll, and "bring the pick into view"
    this.font = fonts().includes("Pixelify Sans") ? "Pixelify Sans" : null;
    this.mono = settings().font_family ?? settings().font ?? null; // the terminals' font, for names
    if (this.view === "scene" || this.view === "picker" || this.view === "help") this.h = cx.focus_handle();
    if (this.view === "scene") this.scroll = ScrollHandle.new();
    if (checking()) return;
    // This computer's name for its tower's sign and the dock's header (Herdr calls it null).
    if (this.view === "scene" || this.view === "dock") cx.spawn(async (cx) => { try { this.host = (await exec("hostname", [])).stdout.trim() || null; } catch {} cx.notify(); });
    if (this.view === "scene") cx.timer.every(30000, (cx) => { if (showing() === "grid") cx.notify(); }); // "3m" ages
    if (this.view === "bar") cx.timer.every(20000, (cx) => { if (showing() === "grid") cx.notify(); }); // the clock
    if (this.view === "dock") {
      cx.timer.every(30000, (cx) => { if (showing() === "grid") cx.notify(); }); // "3m" ages
      // After a restart the dock's block is the file's again: the one open goes back in it.
      if (dockOpen() && shared(DOCKED) && !shared(VIEW)) dockTerminal(shared(DOCKED)).catch(() => null);
    }
    if (this.view === "picker" || this.view === "help") { this.h.focus(); return; }
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (this.view === "keys") {
          const to = c === "toggle" ? (showing() === "grid" ? "desktop" : "grid") : c === "open" ? "grid" : c === "close" ? "desktop" : null;
          if (to) show(to);
          // The scene takes the keyboard once it is up, so Esc leaves it (a mod can't focus while
          // it renders, and it only hears commands once shown: hence the short wait).
          if (to === "grid") cx.spawn(async (cx) => { await cx.sleep(80); run(`${MOD}.focus`); });
          // "pick": another character for the agent you are in, without going to the Grid.
          if (c === "pick") {
            const f = focused(), all = agents();
            const a = all.find((x) => x.pane === f?.pane) ?? all.find((x) => x.address === f?.agent) ?? all.find((x) => x.focused);
            if (a) this.pick(a.address);
          }
        } else if (this.view === "scene" && c === "focus") {
          this.h.focus();
          // The keyboard starts on the agent you came from.
          const all = agents();
          this.sel = (all.find((x) => x.focused) ?? all[0])?.address ?? null;
          this.reveal = true;
        } else if (this.view === "scene" && c.startsWith("jump-")) this.jump(c.slice(5), cx);
        else if (this.view === "scene" && (c === "dock-next" || c === "dock-prev")) this.step(c === "dock-next" ? 1 : -1, cx);
        cx.notify();
      }
    });
  }

  // The character picker, for one agent.
  pick(address) {
    openOverlay({ mod: MOD, kind: "dialog", width: 480, height: 452, props: { view: "picker", agent: address } });
  }
  // The Grid's mouse and keys, on one card.
  help() {
    openOverlay({ mod: MOD, kind: "dialog", width: 600, height: 512, props: { view: "help" } });
  }
  // A click on an agent: its session in the dock, to type in; a double-click goes to it at the desk.
  // Without a dock in the layout, a click goes to the desk.
  open(a, e, cx) {
    this.sel = a.address;
    if (!hasDock() || e?.click_count >= 2) return goTo(a, spaces().find((s) => s.active)?.id ?? null);
    openDock(a.address, true, cx);
  }
  // A click on a crew card. A terminal (an agent or a program with no pane): its session in the
  // dock; a double-click peeks at it over the desk's tab. A sub-agent: its transcript, live.
  openCrew(c, owner, e, cx, keyboard = true) {
    this.sel = c.key;
    if (c.kind === "sub") return this.openSub(owner, c, cx);
    if (!hasDock() || e?.click_count >= 2) { show("desktop"); run("terminal.peek", { terminal: c.k.address }); return; }
    openDock(c.k.address, keyboard, cx);
  }
  // No terminal to focus: switch the dock body to its read-only task and transcript.
  openSub(owner, c, cx) {
    const addr = c.owner ?? owner.address;
    const parent = terminals().find(term => term.address === addr);
    setShared(VIEW, { key: c.key, id: c.x.id, owner: addr, parentName: parent?.name || addr,
      on: machineOf(addr), title: crewName(c), detail: crewDetail(c), file: c.x.file ?? null });
    setShared(DOCKED, c.key);
    run("layout.select", { stack: "grid-display", child: "grid-reader" });
    run("layout.show", { id: DOCK });
    cx.notify();
  }
  // What the keyboard's pick is: { a } or { c, owner }.
  picked() { return this.pickable.get(this.sel) ?? null; }
  // Opens the pick in the dock; `keyboard`: typing goes to it.
  openPick(keyboard, cx) {
    const p = this.picked();
    if (!p) return;
    if (p.a) { if (hasDock()) openDock(p.a.address, keyboard, cx); else goTo(p.a, spaces().find((s) => s.active)?.id ?? null); }
    else this.openCrew(p.c, p.owner, null, cx, keyboard);
  }
  // The next agent with this status ("blocked", "working", "done", "idle") after the pick, round
  // and round: picked and opened in the dock, the keyboard still on the towers (N again: the next).
  jump(status, cx) {
    const keys = this.order.filter(key => {
      const p = this.pickable.get(key);
      if (p?.a) return (p.a.status ?? "idle") === status;
      if (p?.c?.kind === "sub") return status === "working";
      return p?.c?.kind === "agent" && statusOf(p.c.k) === status;
    });
    if (!keys.length) return;
    const at = keys.indexOf(this.sel);
    this.sel = keys[(at + 1) % keys.length];
    this.reveal = true;
    this.h.focus();
    this.openPick(false, cx);
    cx.notify();
  }
  // The dock's ‹ and ›: the one before or after what the dock shows, opened to type in.
  step(by, cx) {
    const order = this.order;
    if (!order.length) return;
    const key = docked();
    const at = order.indexOf(order.includes(key) ? key : this.sel);
    this.sel = order[(Math.max(at, 0) + by + order.length) % order.length];
    this.reveal = true;
    this.openPick(true, cx);
    cx.notify();
  }
  // The keyboard in the scene: arrows move the pick, Enter opens it in the dock to type in, Space
  // opens it and stays here, Shift+Enter goes to it at the desk, C recasts, N / W / D go round the
  // agents that need you / work / are done, ? shows all this. Esc closes the dock, then leaves.
  key(e, cx) {
    // The whole chord (e.keystroke): Ctrl+C and the like are not ours and go on their way.
    const k = e.keystroke ?? e.key, order = this.order, at = order.indexOf(this.sel);
    const to = (i) => { if (order.length) { this.sel = order[(i + order.length) % order.length]; this.reveal = true; cx.notify(); } };
    const p = at >= 0 ? this.picked() : null;
    if (k === "escape") { if (dockOpen()) closeDock(); else show("desktop"); }
    else if ((k === "enter" || k === "space") && p) this.openPick(k === "enter", cx);
    else if (k === "shift-enter" && p?.a) goTo(p.a, spaces().find((s) => s.active)?.id ?? null);
    else if (k === "shift-enter" && p?.c?.k) { show("desktop"); run("terminal.peek", { terminal: p.c.k.address }); }
    else if (k === "right" || k === "tab") to(at + 1);
    else if (k === "left" || k === "shift-tab") to(at < 0 ? 0 : at - 1);
    else if (k === "down" || k === "up") {
      // The next (or previous) room's first agent.
      const starts = this.roomStarts, room = starts.findLastIndex((s) => s <= Math.max(at, 0));
      to(starts[(room + (k === "down" ? 1 : -1) + starts.length) % starts.length] ?? 0);
    } else if (k === "c" && (p?.a || p?.c?.kind === "agent")) this.pick(this.sel);
    else if (k === "n") this.jump("blocked", cx);
    else if (k === "w") this.jump("working", cx);
    else if (k === "d") this.jump("done", cx);
    else if (k === "i") this.jump("idle", cx);
    else if (k === "?" || k === "shift-/" || k === "shift-?" || k === "h" || k === "f1") this.help();
    else return;
    cx.stop_propagation?.();
  }

  // Titles, in the pixel font (fonts/). Only for big text: small, its C closes up into an O.
  text(el, size, weight = 600) {
    return el.when(Boolean(this.font), (e) => e.font_family(this.font)).text_size(size).font_weight(weight);
  }
  // Names and signs: the terminals' font, bold, so every letter reads at a glance.
  label(el, size) {
    return el.when(Boolean(this.mono), (e) => e.font_family(this.mono)).text_size(size).font_bold();
  }

  // ── the strip across the top ────────────────────────────────────────────────────────
  bar(t) {
    const ag = agents(), w = window();
    const count = (s) => ag.filter((a) => a.status === s).length;
    const stop = (_e, cx) => cx.stop_propagation();
    // Agents with no pane, which the towers show as crew: the bar counts them too.
    const crew = terminals().filter((k) => k.state === "live" && k.parent && isAgentTerm(k) && !isTool(k) && !ag.some((a) => a.address === k.address));
    const subs = Object.values(shared("mainframe.info") ?? {}).reduce((sum, i) => sum + (Array.isArray(i?.inner) ? i.inner.length : 0), 0);
    // A count: lit in its colour while there are any, a quiet outline at none. A click goes to
    // the next agent in that state (and the next, round and round): the scene's `jump`.
    const chip = (label, n, color, status, letter) => h_flex().id(`count-${status}`).h(26).px(10).gap(7).flex_none().items_center().rounded(6)
      .when(n > 0, (el) => el.cursor_pointer().hover((s) => s.bg(fade(color, 0.22))))
      .on_mouse_down("left", stop).on_click(() => { if (n) run(`${MOD}.jump-${status}`); })
      .tooltip(n ? `Go to the next one (${letter}), round and round` : `Nobody is ${label.toLowerCase()}`)
      .border(1).border_color(n ? fade(color, 0.55) : C.border).bg(n ? fade(color, 0.1) : fade(color, 0))
      .child(div().size(7).rounded(4).bg(n ? color : C.faint).when(n > 0 && label !== "IDLE", (el) => el.loop("opacity", { from: 0.4, to: 1, period: label === "NEED YOU" ? 700 : 1500 })))
      .child(this.label(div(), 13).text_color(n ? C.text : C.faint).child(String(n)))
      .child(div().text_size(11).text_color(n ? color : C.faint).child(label));
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(C.faint)
      .hover((s) => s.bg(C.hover).text_color(C.text)).on_mouse_down("left", stop).on_click(action).child(label);
    const d = new Date(), clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return h_flex().size_full().px(14).gap(10).items_center().bg(C.bar).border_b(1).border_color(C.border)
      .child(h_flex().gap(8).flex_none().items_center()
        .child(this.text(div(), 19, 700).text_color(C.accent).child(BRAND))
        .child(this.text(div(), 19, 700).text_color(C.faint).child("//"))
        .child(this.text(div(), 19, 700).text_color(C.text).child("GRID")))
      .child(div().flex_none().ml(6).text_size(12).text_color(C.dim).child(`${ag.length} ${ag.length === 1 ? "agent" : "agents"} online`))
      .when(crew.length + subs > 0, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_size(12).text_color(C.second)
        .tooltip(`${crew.length} started by other agents, with no pane of their own\n${subs} sub-agent${subs === 1 ? "" : "s"} at work inside agents\nEach has a card in a bunk beside the agent that started it`)
        .child(svg(`mods/${MOD}/family.svg`).size(12).flex_none())
        .child(`${crew.length + subs} crew`)))
      .child(div().flex_1())
      .child(chip("WORKING", count("working") + crew.filter((k) => statusOf(k) === "working").length + subs, t.working, "working", "W"))
      .child(chip("NEED YOU", count("blocked") + crew.filter((k) => statusOf(k) === "blocked").length, t.blocked, "blocked", "N"))
      .child(chip("DONE", count("done") + crew.filter((k) => statusOf(k) === "done").length, t.done ?? t.accent, "done", "D"))
      .child(chip("IDLE", count("idle") + crew.filter((k) => statusOf(k) === "idle").length, C.dim, "idle", "I"))
      .child(div().flex_1())
      .child(this.label(div(), 13).flex_none().text_color(C.dim).child(clock))
      .child(div().id("grid-help").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_size(13).font_bold().text_color(C.dim)
        .border(1).border_color(C.border).hover((s) => s.bg(C.hover).text_color(C.text)).on_mouse_down("left", stop).on_click(() => this.help())
        .tooltip("The Grid's mouse and keys (?)").child("?"))
      .child(h_flex().id("grid-back").h(26).px(9).gap(7).flex_none().items_center().rounded(6).cursor_pointer()
        .border(1).border_color(fade(C.accent, 0.5)).bg(fade(C.accent, 0.08)).text_color(C.accent)
        .hover((s) => s.bg(fade(C.accent, 0.18))).on_mouse_down("left", stop).on_click(() => show("desktop"))
        .child(div().text_size(12).font_semibold().child("Back to desk"))
        .child(div().px(4).rounded(3).bg(fade(C.accent, 0.14)).text_size(10).child("Esc")))
      .when(w?.buttons, (el) => el
        .child(button("grid-min", "−", () => run("window.minimize")))
        .child(button("grid-max", "□", () => run("window.maximize")))
        .child(button("grid-close", svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }

  // ── one agent: its character, and what it is doing ──────────────────────────────────
  station(a, ctx, t) {
    const m = ctx.m, SPRITE_W = m.sw, SPRITE_H = m.sh, STATION_W = m.stationW, STATION_H = m.stationH, up = m.up;
    const who = ctx.cast.of(a), i = ctx.info[a.address] ?? {}, tab = ctx.tabs.get(a.tab);
    const st = a.status ?? "idle", color = statusColor(st, t), idle = st === "idle";
    const name = nameOf(a, tab), task = agentTask(a, null);
    const pct = i.context == null ? null : Math.max(0, Math.min(100, Math.round(i.context)));
    const pctColor = pct >= 80 ? t.ansi1 : pct >= 50 ? t.ansi3 : t.ansi2;
    const since = st === "working" ? ago(tab?.working_since) : ago(i.lastAt);
    const model = [i.model, i.effort === "medium" ? "med" : i.effort].filter(Boolean).join(" · ") || a.program?.name || "";
    // `here`: the agent the desk is on (the focused one, not every agent of a split tab).
    // `picked`: the keyboard's pick in this screen. `open`: its session is in the dock.
    // `lit`: in the family of the agent hovered, picked or open (ctx.lit).
    const here = a.focused && a.space === ctx.active && Boolean(tab?.active), picked = this.sel === a.address;
    const open = ctx.dockKey === a.address, link = ctx.fam.colorOf(a.address), lit = Boolean(link) && ctx.lit.has(a.address);
    // Its family: who started it, and what it started: agents with a station of their own
    // (`away`), and its crew (agents and programs with no pane, its own sub-agents), who have the
    // bunks beside it.
    const from = ctx.fam.parent.get(a.address), kids = ctx.fam.kids.get(a.address) ?? [];
    const fromAgent = from ? ctx.all.find((x) => x.address === from) : null;
    const fromName = from ? termName(ctx.fam.by.get(from), ctx.ag.find((x) => x.address === from), ctx.tabs) : null;
    const crew = ctx.crews.get(a.address) ?? [], away = kids.filter((k) => ctx.stationed.has(k.address));
    const started = crew.length + away.length, mark = link ?? C.second;
    // What it is waiting on you for, in its own words (the Asks engine reads it off its screen).
    const ask = st === "blocked" ? ctx.asks.get(a.address) ?? null : null;
    ctx.order.push(a.address); ctx.pick.set(a.address, { a });
    const boxH = STATION_H - 12, top = boxH - 8 - SPRITE_H; // the sprite's feet rest 8px above the box's floor
    const sprite = div().relative().flex_none().w(SPRITE_W + 10).h(boxH)
      // The pad under its feet: lit in its status colour, pulsing while it works or waits on you.
      .child(div().absolute().left(1).bottom(2).w(SPRITE_W + 8).h(5).rounded(3).bg(idle ? C.line : color)
        .when(st === "working" || st === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: st === "blocked" ? 700 : 1500 })))
      .child(image(body(who)).absolute().left(5).top(top).w(SPRITE_W).h(SPRITE_H).opacity(idle ? 0.82 : 1)
        .when(st === "working", (el) => el.loop("top", { from: top, to: top - 3, period: 640 })))
      .when(st === "blocked", (el) => el.child(div().text_size(13).font_bold().absolute().left(SPRITE_W - 6).top(0).w(18).h(18).rounded(5).bg(t.blocked).text_color(C.on)
        .flex().items_center().justify_center().child("!").loop("top", { from: 0, to: 5, period: 700 })))
      // Done: a tick, and a spark beside it until you have looked.
      .when(st === "done", (el) => el.child(div().text_size(12).font_bold().absolute().left(SPRITE_W - 6).top(2).w(18).h(18).rounded(5).bg(t.done ?? t.accent).text_color(C.on)
        .flex().items_center().justify_center().child("✓"))
        .child(div().absolute().left(SPRITE_W - 22).top(0).text_size(10 + up).text_color(t.done ?? t.accent).frames(["✦", "✧", "·", "✧"], 380)))
      // Asleep: over its shoulder, inside its own box (further right it would run into its name).
      .when(idle, (el) => el.child(div().absolute().left(SPRITE_W - 8 - up * 2).top(0).text_size(10 + up).font_semibold().text_color(C.faint).frames(["z", "zZ", "zZz", " "], 900)));
    const details = v_flex().flex_1().min_w(0).gap(4 + up).justify_center()
      .child(this.label(div(), 15 + up * 1.5).min_w(0).truncate().text_color(C.text).child(name))
      .child(h_flex().gap(5).items_center().text_size(11 + up)
        .child(div().flex_none().size(6).rounded(3).bg(color))
        .child(div().flex_none().font_semibold().text_color(idle ? C.dim : color).child(WORD[st] ?? st))
        .when(Boolean(since), (el) => el.child(div().flex_none().text_color(C.faint).child(since)))
        // Its crew, counted: they are in the bunks beside it (or, with a pane, at their own station).
        .when(started > 0, (el) => el.child(h_flex().flex_none().gap(3).px(4).items_center().rounded(3).bg(fade(mark, 0.16)).text_color(mark)
          .child(svg(`mods/${MOD}/family.svg`).size(10 + up).flex_none())
          .child(div().font_semibold().child(String(started))))))
      .child(h_flex().min_w(0).gap(5).items_center().text_size(12 + up)
        .child(div().min_w(0).truncate().text_color(C.dim).child(model))
        // Its prompt cache has run out: the next message re-reads the whole conversation.
        .when(Boolean(i.cold) && !idle, (el) => el.child(div().flex_none().text_size(10.5 + up).text_color(fade(t.blocked, 0.85)).child("exp."))))
      .when(pct != null, (el) => el.child(h_flex().gap(6).items_center()
        .child(div().relative().flex_1().h(4).rounded(2).bg(C.line)
          .when(pct > 0, (bar) => bar.child(div().absolute().left(0).top(0).h(4).rounded(2).bg(pctColor).w(`${pct}%`)
            // Nearly full: the bar beats, so a compaction doesn't come as a surprise.
            .when(pct >= 80, (fill) => fill.loop("opacity", { from: 0.45, to: 1, period: 900 })))))
        .child(div().flex_none().w(30 + up * 3).text_size(11 + up).text_color(pctColor).child(`${pct}%`))))
      // The last line, by what matters most: the question it is waiting on; else who started it
      // ("◂ FLARE", in the family's colour); else its task.
      .when(Boolean(ask), (el) => el.child(div().min_w(0).truncate().text_size(12 + up).text_color(t.blocked).child(`“${ask}”`)))
      .when(!ask && Boolean(from), (el) => el.child(h_flex().min_w(0).gap(3).items_center().text_size(11 + up).text_color(mark)
        .when(Boolean(fromAgent), (r) => r.child(image(face(ctx.cast.of(fromAgent))).size(13 + up).flex_none()))
        .child(div().min_w(0).truncate().font_semibold().child(`◂ ${String(fromName).toUpperCase()}`))))
      .when(!ask && !from && Boolean(task) && task !== name, (el) => el.child(div().min_w(0).truncate().text_size(12 + up).text_color(C.dim).child(task)));
    const family = [from ? `Started by ${fromName}${machineOf(from) !== machineOf(a.address) ? ` on ${machineOf(from) ?? (ctx.host ?? "this computer")}` : ""}` : null,
      away.length ? `Started (at a station of their own): ${away.map((k) => termName(k, ctx.ag.find((x) => x.address === k.address), ctx.tabs)).join(", ")}` : null,
      crew.length ? `Its crew, in the bunk${crew.length > BUNK ? "s" : ""} beside it: ${crew.map(crewName).join(", ")}` : null];
    const tip = [`${name}  ·  ${who.name}`, a.program?.name, model, pct != null ? `context ${pct}% used` : null, i.cold ? "prompt cache expired: its next message re-reads everything" : null,
      ask ? `Waiting on you: ${ask}` : null, task && task !== name ? task : null, ...family,
      hasDock() ? "Click: open its session here  ·  Double-click: go to it  ·  Right-click: change its character" : "Click: go to it  ·  Right-click: change its character"].filter(Boolean).join("\n");
    return h_flex().id(`st-${a.address}`).relative().flex_1().min_w(STATION_W).max_w(STATION_W + 90).h(STATION_H).px(8).gap(8).items_center().rounded(8).cursor_pointer()
      .border(1).border_color(open || picked ? C.accent : lit ? fade(link, 0.75) : here ? fade(C.accent, 0.5) : st === "blocked" ? fade(t.blocked, 0.55) : fade(C.accent, 0))
      .bg(open ? fade(C.accent, 0.16) : picked ? fade(C.accent, 0.13) : lit ? fade(link, 0.1) : here ? C.selected : st === "blocked" ? fade(t.blocked, 0.07) : fade(C.accent, 0))
      .hover((s) => s.bg(C.hover))
      .tooltip(tip)
      .on_hover((on, cx) => { if (on) this.hover = a.address; else if (this.hover === a.address) this.hover = null; cx.notify(); })
      .on_click((e, cx) => this.open(a, e, cx))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.pick(a.address); })
      // A family's tether: a bar in its colour down the station's left edge.
      .when(Boolean(link), (el) => el.child(div().absolute().left(2).top(12).bottom(12).w(3).rounded(2).bg(lit || open ? link : fade(link, 0.55))))
      // Open in the dock: a tag at its top right, pointing there.
      .when(open, (el) => el.child(div().absolute().right(6).top(5).px(5).rounded(3).bg(C.accent).text_color(C.on).text_size(9.5).font_bold().child("OPEN ▸")))
      .child(sprite).child(details);
  }

  // ── an agent's crew: what it started that has no pane, BUNK to a bunk ───────────────
  // A bunk takes a station's place, right after its agent's: a heading that says whose crew it
  // is, a rail in the family's colour, and a card for each one.
  bunk(slot, ctx, t) {
    const m = ctx.m, up = m.up, owner = slot.owner;
    const link = ctx.fam.colorOf(owner.address) ?? C.second, ownerName = nameOf(owner, ctx.tabs.get(owner.tab));
    const lit = ctx.lit.has(owner.address) || ctx.dockKey === owner.address || this.sel === owner.address;
    const range = slot.total <= BUNK ? String(slot.total) : slot.crew.length === 1 ? `${slot.from + 1} of ${slot.total}` : `${slot.from + 1}–${slot.from + slot.crew.length} of ${slot.total}`;
    return v_flex().id(`bunk-${owner.address}-${slot.from}`).relative().flex_1().min_w(m.stationW).max_w(m.stationW + 90).h(m.stationH).pl(12).pr(2).pt(1).gap(3)
      .child(div().absolute().left(4).top(Math.round(m.bunkHead / 2)).bottom(Math.round(m.card / 2) + (BUNK - slot.crew.length) * (m.card + 3) + 2).w(2).rounded(1).bg(fade(link, lit ? 0.95 : 0.45)))
      .child(h_flex().h(m.bunkHead).flex_none().gap(4).items_center().text_size(9.5 + up).text_color(link)
        .child(image(face(ctx.cast.of(owner))).size(11 + up * 2).flex_none())
        .child(div().min_w(0).truncate().font_bold().child(`${String(ownerName).toUpperCase()}’S CREW`))
        .child(div().flex_1())
        .child(div().flex_none().text_color(fade(link, 0.75)).child(range)))
      .children(slot.crew.map((c, n) => this.crewCard(c, owner, link, n, ctx, t)));
  }
  // One of a crew: an agent with no pane (its character's face), a program (a terminal glyph) or
  // a sub-agent (a drone). Name, where it runs when that is elsewhere, status, what it is doing.
  crewCard(c, owner, link, n, ctx, t) {
    const m = ctx.m, up = m.up, h = m.card, px = Math.min(h - 8, 24 + up * 6);
    const k = c.k ?? null, sub = c.kind === "sub", proc = c.kind === "proc";
    const st = sub ? "working" : proc ? "running" : statusOf(k);
    const color = proc ? C.dim : statusColor(st, t), word = proc ? "RUNNING" : WORD[st] ?? st;
    const name = crewName(c), detail = crewDetail(c), i = k ? ctx.info[k.address] ?? {} : {};
    const model = sub || proc ? null : [k.program?.name, i.model ?? argvModel(k), i.context != null ? `${Math.round(i.context)}%` : null].filter(Boolean).join(" · ");
    const away = k && machineOf(k.address) !== machineOf(owner.address) ? machineOf(k.address) ?? ctx.host ?? "here" : null;
    const since = sub ? ago(c.x.start ? c.x.start * 1000 : null) : st === "working" || proc ? null : ago(k.status_ms);
    const picked = this.sel === c.key, open = ctx.dockKey === c.key, lit = ctx.lit.has(k?.address ?? owner.address);
    const light = k && isAgentTerm(k) ? k.address : owner.address;
    ctx.order.push(c.key); ctx.pick.set(c.key, { c, owner });
    const icon = c.kind === "agent" ? image(face(ctx.cast.of(standIn(k)))).size(px).flex_none()
      : div().size(px).flex_none().flex().items_center().justify_center().rounded(5).bg(fade(link, 0.12))
        .child(svg(`mods/${MOD}/${sub ? "drone" : "proc"}.svg`).size(Math.round(px * 0.66)).flex_none().text_color(sub ? link : C.dim)
          .when(sub, (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1300 })));
    const tip = [`${name}  ·  ${sub ? "sub-agent" : proc ? "program" : `${ctx.cast.of(standIn(k)).name}`}`, model || null, detail || null,
      `Started by ${nameOf(owner, ctx.tabs.get(owner.tab))}${c.via ? `, through ${c.via.name || c.via.address}` : ""}${away ? `  ·  runs on ${away}` : ""}`,
      sub ? "Click: read its transcript here, live" : `Click: open its session here  ·  Double-click: peek at it over the desk${proc ? "" : "  ·  Right-click: change its character"}`].filter(Boolean).join("\n");
    return h_flex().id(`crew-${c.key}`).relative().h(h).flex_none().px(5).gap(6).items_center().rounded(6).cursor_pointer()
      .border(1).border_color(open || picked ? C.accent : st === "blocked" ? fade(t.blocked, 0.6) : fade(link, lit ? 0.7 : 0.28))
      .bg(open ? fade(C.accent, 0.16) : picked ? fade(C.accent, 0.13) : st === "blocked" ? fade(t.blocked, 0.08) : fade(link, lit ? 0.12 : 0.05))
      .hover((s) => s.bg(C.hover))
      .tooltip(tip)
      .on_hover((on, cx) => { if (on) this.hover = light; else if (this.hover === light) this.hover = null; cx.notify(); })
      .on_click((e, cx) => this.openCrew(c, owner, e, cx))
      .when(c.kind === "agent", (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.pick(k.address); }))
      // Its hook onto the bunk's rail.
      .child(div().absolute().left(-8).top(Math.round(h / 2) - 1).w(8).h(2).bg(fade(link, lit ? 0.95 : 0.45)))
      .child(icon)
      .child(v_flex().flex_1().min_w(0).justify_center()
        .child(h_flex().min_w(0).gap(5).items_center()
          .child(this.label(div(), 11 + up).min_w(0).truncate().text_color(C.text).child(name))
          .when(Boolean(away), (el) => el.child(div().flex_none().px(3).rounded(2).bg(fade(link, 0.16)).text_size(8.5 + up * 0.5).font_bold().text_color(link).child(String(away).toUpperCase())))
          .when(open, (el) => el.child(div().flex_none().text_size(9 + up).font_bold().text_color(C.accent).child("▸"))))
        .child(h_flex().min_w(0).gap(4).items_center().text_size(10 + up)
          .child(div().flex_none().size(5).rounded(3).bg(color).when(st === "working" || st === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: st === "blocked" ? 700 : 1500 })))
          .child(div().flex_none().font_semibold().text_color(st === "idle" || proc ? C.dim : color).child(word))
          .when(Boolean(since), (el) => el.child(div().flex_none().text_color(C.faint).child(since)))
          .child(div().min_w(0).truncate().text_color(C.faint).child(detail || model || ""))));
  }

  // ── a space: its sign, and its agents side by side ──────────────────────────────────
  room(r, px, cols, ctx, t) {
    const hue = hueOf(ctx.colors[r.space.id], t);
    ctx.rooms.push(ctx.order.length); // where this room's agents start in the keyboard's order
    const folder = tilde(r.space.folder, ctx.homes[r.space.machine ?? ""] ?? (r.space.machine ? null : ctx.home));
    const rows = [];
    for (let i = 0; i < r.slots.length; i += cols) rows.push(r.slots.slice(i, i + cols));
    const toSpace = () => { run("layout.select", { stack: DECK, child: "desktop" }); run("space.select", { id: r.space.id }); };
    const busy = r.agents.filter((a) => a.status === "working").length, need = r.agents.filter((a) => a.status === "blocked").length;
    return v_flex().w(px).flex_none().bg(C.room)
      .child(h_flex().h(SIGN_H).flex_none().px(ROOM_PAD).gap(8).items_center()
        // The sign: a tube in the space's colour.
        .child(this.label(div(), 11.5).id(`sign-${r.space.id}`).flex_none().max_w(px - 60).truncate().px(7).py(1).rounded(3).border(1).border_color(fade(hue, 0.6)).bg(fade(hue, 0.1)).text_color(hue)
          .cursor_pointer().hover((s) => s.bg(fade(hue, 0.28))).tooltip("Go to this space at the desk").on_click(toSpace).child(String(r.space.name).toUpperCase()))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(C.faint).child(folder))
        .when(need > 0, (el) => el.child(div().flex_none().size(7).rounded(4).bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 700 })))
        .when(busy > 0, (el) => el.child(div().flex_none().size(7).rounded(4).bg(t.working))))
      .child(v_flex().px(ROOM_PAD).pb(4)
        .children(rows.map((row) => h_flex().children([
          ...row.map((slot) => (slot.a ? this.station(slot.a, ctx, t) : this.bunk(slot, ctx, t))),
          // A short last row keeps its stations the size of the rows above.
          ...Array.from({ length: rows.length > 1 ? cols - row.length : 0 }, () => div().flex_1().min_w(ctx.m.stationW).max_w(ctx.m.stationW + 90)),
        ]))))
      // The floor of the room, lit in the sign's colour.
      .child(div().h(2).flex_none().bg(fade(hue, 0.45)));
  }

  // ── a computer: a tower of rooms ───────────────────────────────────────────────────
  tower(tw, ctx, t) {
    const m = ctx.m, width = tw.cols * m.unit - WALL + 2 * WALL;
    const floors = pack(tw.rooms, tw.cols).reverse(); // wide floors at the bottom
    const count = (s) => tw.rooms.reduce((sum, r) => sum + r.agents.filter((a) => a.status === s).length, 0);
    const busy = count("working"), need = count("blocked"), n = tw.count;
    const off = tw.state && tw.state !== "ready";
    // A floor is as wide as its rooms: a short one on top is a penthouse, centred on the floor below.
    const floor = (f, at) => {
      const across = Math.min(tw.cols, f.used), inner = across * m.unit - WALL;
      // Each room is as wide as its stations; what's left of the floor is shared out by size.
      const base = f.items.map((it) => it.w * m.stationW + 2 * ROOM_PAD);
      const spare = inner - base.reduce((a, b) => a + b, 0) - (f.items.length - 1) * WALL;
      let left = spare;
      const widths = f.items.map((it, i) => { const extra = i === f.items.length - 1 ? left : Math.floor(spare * it.w / across); left -= extra; return base[i] + extra; });
      // The walls and the slab above are the floor's own padding, in the wall's colour.
      return h_flex().flex_none().w(inner + 2 * WALL).px(WALL).pt(at === 0 ? WALL : SLAB).gap(WALL).bg(C.wall)
        .children(f.items.map((it, i) => this.room(it.r, widths[i], it.w, ctx, t)));
    };
    const roof = v_flex().flex_none().h(ROOF).items_center().justify_end()
      // The mast, with its light.
      .child(div().flex_none().size(7).rounded(4).bg(off ? C.faint : C.accent).when(!off, (el) => el.loop("opacity", { from: 0.25, to: 1, period: 1800 })))
      .child(div().flex_none().w(3).h(16).bg(C.wall))
      .child(h_flex().flex_none().h(36).px(16).gap(12).items_center().rounded_t(6).border(1).border_color(off ? C.line : fade(C.accent, 0.7)).bg(C.bar)
        .child(svg(`mods/workspace-chrome/${tw.machine ? "server" : "monitor"}.svg`).size(15).flex_none().text_color(off ? C.faint : C.accent))
        .child(this.text(div(), 20, 600).flex_none().text_color(off ? C.dim : C.accent).child(tw.name.toUpperCase()))
        .child(div().flex_none().text_size(12).text_color(C.dim).child(off ? "offline" : `${n} ${n === 1 ? "agent" : "agents"}`))
        .when(!off && tw.crew > 0, (el) => el.child(div().flex_none().text_size(12).text_color(C.second).child(`+${tw.crew} crew`)))
        .when(busy > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.working).child(`${busy} working`)))
        .when(need > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.blocked).child(`${need} need you`))));
    // Its pieces, for the scene to put together: the roof, and each floor with which of the
    // keyboard's agents (ctx.order) stand on it.
    return { width, roof, floors: floors.map((f, at) => { const from = ctx.order.length; return { el: floor(f, at), from, to: ctx.order.length }; }) };
  }

  scene(t) {
    const ag = agents(), sp = spaces(), ms = machines();
    const fam = families(t), dockedNow = docked(), info = shared("mainframe.info") ?? {};
    // Each agent's crew (crewOf), and the stand-ins the cast dresses for the agents among them.
    const stationed = new Set(ag.map((a) => a.address));
    const crews = new Map(ag.map((a) => [a.address, crewOf(a.address, fam, stationed, info)]).filter(([, c]) => c.length));
    const all = [...ag, ...[...crews.values()].flat().filter((c) => c.kind === "agent").map((c) => standIn(c.k))];
    // What the dock shows, as the towers know it: an address, or a sub-agent's key while its transcript is up.
    const dockKey = dockedNow;
    // Questions agents are waiting on (the Asks engine keeps them), by agent.
    const asks = new Map((shared("asks.state")?.asks ?? []).filter((x) => x.state === "pending" && !x.notice && x.question).map((x) => [x.address, String(x.question)]));
    const ctx = { cast: casting(all, sp), info, colors: shared("space.colors") ?? {},
      tabs: new Map(sp.flatMap((s) => s.tabs.map((x) => [x.id, x]))), active: sp.find((s) => s.active)?.id ?? null, home: this.homeDir ??= home(),
      homes: shared("mainframe.homes") ?? {}, order: [], rooms: [], pick: new Map(), ag, all, fam, crews, stationed, asks, docked: dockedNow, dockKey, host: this.host,
      // The family that lights up: the hovered agent's, else the keyboard's pick's, else the open one's.
      lit: fam.members(familyOf(this.hover ?? this.sel ?? dockKey, fam)) };
    const W = this.size?.width ?? 1200, H = this.size?.height ?? 700;
    // Towers: this computer first, then the others, each with the spaces that have agents.
    const names = [null, ...ms.map((m) => m.name).filter(Boolean)];
    for (const s of sp) if (s.machine && !names.includes(s.machine)) names.push(s.machine);
    const towers = names.map((m) => ({
      machine: m, name: m ?? this.host ?? "This computer", state: ms.find((x) => (x.name ?? null) === m)?.layout ?? null,
      rooms: sp.filter((s) => (s.machine ?? null) === m).map((s) => ({ space: s, agents: ag.filter((a) => a.space === s.id) })).filter((r) => r.agents.length),
    })).filter((tw) => tw.rooms.length);
    // `n`: places to plan for (stations and bunks); `count`: agents; `crew`: who the bunks hold.
    for (const tw of towers) {
      for (const r of tw.rooms) r.slots = slotsOf(r.agents, crews);
      tw.n = tw.rooms.reduce((sum, r) => sum + r.slots.length, 0);
      tw.count = tw.rooms.reduce((sum, r) => sum + r.agents.length, 0);
      tw.crew = tw.rooms.reduce((sum, r) => sum + r.agents.reduce((n, a) => n + (crews.get(a.address)?.length ?? 0), 0), 0);
    }
    // The biggest characters that leave every tower standing in the window without scrolling.
    let m = metrics(4), p = plan(towers, W, m);
    for (const cell of [6, 5]) {
      const bigger = metrics(cell), q = plan(towers, W, bigger);
      if (!q.stacked && q.height + 10 + STREET <= H) { m = bigger; p = q; break; }
    }
    ctx.m = m;
    towers.forEach((tw, i) => { tw.cols = p.cols[i]; });
    const stacked = p.stacked;
    const street = div().w_full().h(STREET).flex_none().bg(C.bar).border_t(1).border_color(C.line)
      .child(h_flex().size_full().px(PAD).items_center().gap(14)
        .child(div().flex_1().h(1).bg(C.line))
        .child(div().flex_none().text_size(11).text_color(C.dim).child(hasDock()
          ? "Click an agent or one of its crew to open it here  ·  double-click to go to it  ·  N W D: next that needs you, works, is done  ·  ? for all the keys"
          : "Click an agent to go to it  ·  right-click to change its character  ·  ? for all the keys")));
    // The scroll area's own children, top to bottom: a spring (short towers stand on the street
    // at the bottom), the towers, the street. Side by side, the towers are one row. Stacked (a
    // narrow window), every roof and floor is a child of its own, so the floor the keyboard's
    // pick stands on can be brought into view (scroll_to_item reveals a direct child).
    const built = towers.map((tw) => this.tower(tw, ctx, t));
    const rows = [], targets = [];
    if (!towers.length) rows.push(v_flex().flex_1().items_center().justify_center().gap(8)
      .child(this.text(div(), 22, 700).text_color(C.accent).child("NOBODY HOME"))
      .child(div().text_size(12).text_color(C.dim).child("Start an agent and it gets a character and a room here.")));
    else if (stacked) built.forEach((b, i) => {
      rows.push(div().flex_none().pt(i ? GAP - 12 : 10).child(b.roof));
      for (const f of b.floors) { targets.push({ from: f.from, to: f.to, child: rows.length + 1 }); rows.push(f.el); } // + 1: the spring
    });
    else rows.push(h_flex().flex_none().w_full().items_end().justify_center().gap(GAP).px(PAD).pt(10)
      .children(built.map((b) => v_flex().w(b.width).flex_none().items_center().child(b.roof).children(b.floors.map((f) => f.el)))));
    this.order = ctx.order; this.roomStarts = ctx.rooms; this.pickable = ctx.pick;
    if (this.sel && !ctx.order.includes(this.sel)) this.sel = null;
    if (this.reveal) {
      this.reveal = false;
      const at = ctx.order.indexOf(this.sel), hit = targets.find((x) => at >= x.from && at < x.to);
      if (hit) this.scroll?.scroll_to_item(hit.child);
    }
    return div().id("grid-scene").relative().size_full().bg(C.ink).track_focus(this.h)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      // A press anywhere here gives the towers the keyboard (back from the dock's terminal).
      .on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      // The skyline, behind everything and out of the way of clicks' targets.
      .when(options().backdrop !== false, (el) => el.child(div().absolute().inset_0().overflow_hidden().children(this.skyline(W, H))))
      // The scroll area fills a column of its own: scroll_to_item only moves one sized by flex.
      .child(v_flex().absolute().inset_0().child(v_flex().id("grid-scroll").flex_1().min_h(0).items_center().overflow_y_scrollbar().track_scroll(this.scroll)
        .child(div().flex_1().min_h(0))
        .children(rows)
        .child(street)));
  }

  // The city behind the towers: two rows of silhouettes and a few lit windows, the same every
  // time (a fixed seed), in the theme's colours.
  skyline(W, H) {
    const out = [];
    let seed = 7411;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    // The sky: a crescent moon and stars, a few of them twinkling, each on its own time.
    const mx = Math.round(Math.min(W * 0.07, 150)), my = Math.round(H * 0.08);
    out.push(div().absolute().left(mx).top(my).size(30).rounded(15).bg(mix(C.text, C.ink, 0.3)));
    out.push(div().absolute().left(mx - 9).top(my - 5).size(30).rounded(15).bg(C.ink));
    for (let n = Math.round(W / 26); n > 0; n--) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H * 0.6), big = rnd() < 0.16, twinkle = rnd() < 0.3, period = 1500 + Math.floor(rnd() * 3200);
      const star = div().absolute().left(x).top(y).size(big ? 2 : 1).bg(fade(C.text, big ? 0.55 : 0.3));
      out.push(twinkle ? star.loop("opacity", { from: 0.1, to: 1, period }) : star);
    }
    seed = 20261;
    for (const [color, reach, lit] of [[C.far, 0.62, 0], [C.near, 0.38, 1]]) {
      for (let x = -30; x < W; ) {
        const w = 44 + Math.floor(rnd() * 96), h = Math.floor(H * reach * (0.3 + rnd() * 0.7)), gap = rnd() < 0.3 ? 12 + Math.floor(rnd() * 40) : 3;
        out.push(div().absolute().left(x).bottom(STREET).w(w).h(h).bg(color));
        // A mast on some of the tall ones.
        if (rnd() < 0.22 && h > H * reach * 0.6) out.push(div().absolute().left(x + Math.floor(w / 2)).bottom(STREET + h).w(2).h(14 + Math.floor(rnd() * 22)).bg(color));
        for (let n = lit ? Math.floor(rnd() * 5) : 0; n > 0; n--) {
          const wx = 6 + Math.floor(rnd() * Math.max(1, (w - 16) / 8)) * 8, wy = 8 + Math.floor(rnd() * Math.max(1, (h - 20) / 10)) * 10;
          if (wy < h - 8) out.push(div().absolute().left(x + wx).bottom(STREET + h - wy).w(4).h(5).bg(C.lit).opacity(0.35 + rnd() * 0.5));
        }
        x += w + gap;
      }
    }
    return out;
  }

  // ── the picker: every character, to give one to an agent ────────────────────────────
  picker(t) {
    const p = props() ?? {}, real = agents(), ag = [...real, ...standIns(real)], sp = spaces();
    const a = ag.find((x) => x.address === p.agent);
    const cast = casting(ag, sp), tabs = new Map(sp.flatMap((s) => s.tabs.map((x) => [x.id, x])));
    const current = a ? cast.of(a) : null;
    // An agent with no pane goes by the name it was started with.
    const called = (x) => (x.pane?.startsWith("t:") ? x.name || agentTask(x, null) || x.program?.name || x.address : nameOf(x, tabs.get(x.tab)));
    const users = new Map();
    for (const x of ag) { const c = cast.of(x); users.set(c.id, [...(users.get(c.id) ?? []), called(x)]); }
    const close = () => closeOverlay(p.overlay);
    const tile = (c) => {
      const on = current?.id === c.id, by = (users.get(c.id) ?? []).filter(() => !on);
      return div().id(`pick-${c.id}`).relative().size(50).flex_none().rounded(8).cursor_pointer().flex().items_center().justify_center()
        .bg(on ? C.selected : C.hover).border(2).border_color(on ? C.accent : fade(C.accent, 0))
        .hover((s) => s.border_color(fade(C.accent, 0.55)))
        .tooltip(`${c.name}${on ? "  ·  now" : by.length ? `  ·  played by ${by.join(", ")}` : ""}`)
        .on_click(() => { if (a) recast(a, c.id, ag, sp); close(); })
        .child(image(face(c)).w(42).h(42))
        .when(by.length > 0, (el) => el.child(div().absolute().right(3).top(3).size(6).rounded(3).bg(C.text)));
    };
    return v_flex().size_full().p(14).gap(12).bg(C.panel).track_focus(this.h)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().gap(12).items_center()
        .when(Boolean(current), (el) => el.child(div().flex_none().size(44).rounded(8).bg(C.selected).child(image(face(current)).w(42).h(42))))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(this.label(div(), 15).truncate().text_color(C.text).child(a ? `A character for ${called(a)}` : "That agent has gone"))
          .child(div().text_size(11).text_color(C.dim).child(current ? `Now ${current.name}. A dot marks one another agent has.` : "")))
        .child(div().id("pick-close").flex_none().size(26).rounded(6).flex().items_center().justify_center().text_color(C.dim).cursor_pointer()
          .hover((s) => s.bg(C.hover).text_color(C.text)).on_click(close).child(svg("mods/pane/close.svg").size(13))))
      .child(h_flex().flex_wrap().gap(6).children(ROSTER.map(tile)));
  }

  // ── the card of mouse and keys ──────────────────────────────────────────────────────
  helpCard() {
    const close = () => closeOverlay(props()?.overlay);
    const key = (k) => div().flex_none().px(6).py(1).rounded(4).border(1).border_color(C.border).bg(C.hover).text_size(11).font_semibold().text_color(C.text).child(k);
    const row = (keys, what) => h_flex().gap(8).items_center().min_h(24)
      .child(h_flex().w(168).flex_none().gap(4).justify_end().children(keys.map(key)))
      .child(div().flex_1().min_w(0).text_size(12).text_color(C.dim).child(what));
    const head = (s) => this.label(div(), 11).mt(6).text_color(C.accent).child(s);
    return v_flex().size_full().p(16).gap(3).bg(C.panel).track_focus(this.h)
      .on_key_down((e, cx) => { close(); cx.stop_propagation(); })
      .child(h_flex().items_center().gap(8)
        .child(this.text(div(), 20, 700).text_color(C.accent).child("THE GRID"))
        .child(div().flex_1().text_size(12).text_color(C.dim).child("every agent on one screen, and everything each one started"))
        .child(div().id("help-close").flex_none().size(26).rounded(6).flex().items_center().justify_center().text_color(C.dim).cursor_pointer()
          .hover((s) => s.bg(C.hover).text_color(C.text)).on_click(close).child(svg("mods/pane/close.svg").size(13))))
      .child(head("MOUSE"))
      .child(row(["Click"], "open a terminal or read a sub-agent’s task and transcript"))
      .child(row(["Double-click"], "go to it at the desk (one of a crew: a peek over the desk)"))
      .child(row(["Right-click"], "give it another character"))
      .child(row(["Click a count"], "in the bar: the next agent in that state, round and round"))
      .child(row(["Click a sign"], "go to that space at the desk"))
      .child(head("KEYS, WHILE THE TOWERS HAVE THE KEYBOARD"))
      .child(row(["←", "→", "Tab"], "the next agent or crew member"))
      .child(row(["↑", "↓"], "the next room"))
      .child(row(["Enter"], "open the pick in the dock and type to it"))
      .child(row(["Space"], "open it in the dock, the keyboard stays here"))
      .child(row(["Shift+Enter"], "go to it at the desk"))
      .child(row(["N", "W", "D", "I"], "the next that needs you, works, is done, idles"))
      .child(row(["C"], "another character for the pick"))
      .child(row(["Esc"], "close the dock, then back to the desk"))
      .child(div().mt(6).text_size(11).text_color(C.faint).child("A press on the towers takes the keyboard back from the dock. Any key closes this card."));
  }

  // ── the dock's header: who is open in the dock, its family, Open at desk, close ─────────
  // Two lines: the agent (character, name, status, model, context, where; whether the keyboard is
  // in its terminal), then its family as chips (who started it and the others it started, the
  // agents it started, its own subagents): a click opens that one in the dock.
  dockHead(t) {
    const selected = shared(DOCKED), view = shared(VIEW), viewing = view && view.key === selected ? view : null;
    const addr = viewing?.owner ?? selected, fam = families(t), real = agents(), sp = spaces();
    const ag = [...real, ...standIns(real)]; // with the agents that have no pane: they have a character too
    const tabs = new Map(sp.flatMap((s) => s.tabs.map((x) => [x.id, x])));
    const k = fam.by.get(addr), a = real.find((x) => x.address === addr) ?? null;
    const stop = (_e, cx) => cx.stop_propagation();
    const frame = v_flex().size_full().px(12).py(6).gap(4).justify_center().bg(C.bar).rounded(10).border(1).border_color(C.border);
    if (!k) {
      // Its session ended: the dock closes (its block would go on to show some other agent).
      if (addr && dockOpen() && this.closedFor !== addr) { this.closedFor = addr; closeDock(); }
      return frame.child(div().text_size(12).text_color(C.dim).child(addr ? "That session has ended." : "Click an agent to open its session here."));
    }
    this.closedFor = null;
    const cast = casting(ag, sp), infos = shared("mainframe.info") ?? {}, info = infos[addr] ?? {};
    // A sub-agent's transcript (openSub): the terminal only follows a file; the header is about
    // the sub-agent and the agent it works for.
    const owner = viewing ? fam.by.get(viewing.owner) ?? null : null;
    const st = viewing ? "working" : a?.status ?? statusOf(k), color = statusColor(st, t);
    const name = viewing ? viewing.title : termName(k, a, tabs);
    const space = a ? sp.find((s) => s.id === a.space) : null, here = machineOf(addr) ?? this.host ?? "this computer";
    const pct = info.context == null ? null : Math.max(0, Math.min(100, Math.round(info.context)));
    const pctColor = pct >= 80 ? t.ansi1 : pct >= 50 ? t.ansi3 : t.ansi2;
    const tab = a ? tabs.get(a.tab) : null, since = viewing ? null : st === "working" ? ago(tab?.working_since) : ago(info.lastAt ?? k.status_ms);
    const model = viewing ? "" : [info.model ?? (a ? null : argvModel(k)), info.effort === "medium" ? "med" : info.effort].filter(Boolean).join(" · ") || k.program?.name || a?.program?.name || "";
    // Its picture: its character (an agent, with a pane or not), else its program's icon.
    const icon = (term, agent, px) => {
      const who = agent ?? (term && isAgentTerm(term) && !isTool(term) && term.parent ? standIn(term) : null);
      if (who) return image(face(cast.of(who))).size(px).flex_none();
      const p = term?.program;
      if (p?.icon) return p.tint ? svg(p.icon).size(px - 4).flex_none().text_color(C.dim) : image(p.icon).size(px - 4).flex_none();
      return svg(`mods/${MOD}/proc.svg`).size(px - 4).flex_none().text_color(C.dim);
    };
    // Where the keyboard is: in this terminal (a layout block has the keyboard: no pane), or not.
    const f = focused(), typing = Boolean(f && !f.pane && f.terminal === addr);
    const button = (id, label, tip, action) => h_flex().id(id).h(24).px(8).gap(6).flex_none().items_center().rounded(6).cursor_pointer()
      .border(1).border_color(C.border).text_size(11.5).text_color(C.dim).hover((s) => s.bg(C.hover).text_color(C.text))
      .on_mouse_down("left", stop).on_click(action).tooltip(tip).child(label);
    const round = (id, glyph, tip, action) => div().id(id).flex_none().size(24).rounded(6).flex().items_center().justify_center().cursor_pointer().text_size(14).text_color(C.dim)
      .hover((s) => s.bg(C.hover).text_color(C.text)).on_mouse_down("left", stop).on_click(action).tooltip(tip).child(glyph);
    const desk = viewing ? null : a
      ? button("dock-desk", "Open at desk", "Go to it at the desk (double-click its station, or Shift+Enter)", () => goTo(a, sp.find((s) => s.active)?.id ?? null))
      : button("dock-desk", "Peek at desk", "It has no pane: peek at it over the desk's tab", () => { show("desktop"); run("terminal.peek", { terminal: addr }); });
    const line1 = h_flex().h(30).gap(8).items_center()
      .child(viewing ? div().size(28).flex_none().flex().items_center().justify_center().rounded(6).bg(fade(C.second, 0.14))
        .child(svg(`mods/${MOD}/drone.svg`).size(18).text_color(C.second).loop("opacity", { from: 0.45, to: 1, period: 1300 })) : icon(k, a, 28))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().min_w(0).gap(8).items_center()
          .child(this.label(div(), 14).min_w(0).truncate().text_color(C.text).child(name))
          .when(Boolean(viewing), (el) => el.child(div().flex_none().px(5).rounded(3).bg(fade(C.second, 0.16)).text_size(10).font_bold().text_color(C.second).child("SUB-AGENT")))
          .when(!viewing, (el) => el.child(div().flex_none().size(6).rounded(3).bg(color))
            .child(div().flex_none().text_size(11).font_semibold().text_color(st === "idle" ? C.dim : color).child(WORD[st] ?? st)))
          .when(Boolean(since), (el) => el.child(div().flex_none().text_size(11).text_color(C.faint).child(since))))
        .child(h_flex().min_w(0).gap(6).items_center().text_size(11).text_color(C.dim)
          .when(Boolean(model), (el) => el.child(div().flex_none().child(model)))
          .when(pct != null && !viewing, (el) => el.child(div().flex_none().text_color(pctColor).child(`${pct}%`)))
          .child(div().min_w(0).truncate().text_color(C.faint).child(viewing ? "its transcript, as it is written" : [here.toUpperCase(), space?.name].filter(Boolean).join(" · ")))))
      .child(div().flex_none().px(6).py(1).rounded(4).text_size(10).font_bold()
        .bg(typing && !viewing ? fade(C.accent, 0.16) : fade(C.accent, 0)).text_color(typing && !viewing ? C.accent : C.faint)
        .child(viewing ? "READ ONLY" : typing ? "TYPING HERE" : "CLICK TO TYPE"))
      .when(Boolean(desk), (el) => el.child(desk))
      // The one before and the one after, as the towers stand: the dock goes down the line.
      .child(round("dock-prev", "‹", "The one before, as the towers stand", () => run(`${MOD}.dock-prev`)))
      .child(round("dock-next", "›", "The next one, as the towers stand", () => run(`${MOD}.dock-next`)))
      .child(div().id("dock-close").flex_none().size(24).rounded(6).flex().items_center().justify_center().cursor_pointer().text_color(C.dim)
        .hover((s) => s.bg(C.hover).text_color(C.text)).on_mouse_down("left", stop).on_click(() => closeDock())
        .tooltip("Close (Esc on the towers)").child(svg("mods/pane/close.svg").size(13)));
    // The family: who started it (and the others it started), what it started, and its own
    // sub-agents: each a chip, and a click opens that one here.
    const base = viewing ? viewing.owner : addr;
    const link = fam.colorOf(base) ?? C.second;
    const chip = (term) => {
      const ta = real.find((x) => x.address === term.address) ?? null, ts = ta?.status ?? statusOf(term), is = isAgentTerm(term);
      const away = machineOf(term.address) !== machineOf(base);
      return h_flex().id(`fam-${term.address}`).h(20).px(6).gap(5).flex_none().items_center().rounded(5).cursor_pointer()
        .border(1).border_color(fade(link, 0.45)).bg(fade(link, 0.08)).hover((s) => s.bg(fade(link, 0.2)))
        .on_mouse_down("left", stop).on_click((_e, cx) => openDock(term.address, true, cx))
        .tooltip(`${termName(term, ta, tabs)}  ·  ${is ? WORD[ts] ?? ts : "a program it runs"}${away ? `  ·  on ${machineOf(term.address) ?? this.host ?? "this computer"}` : ""}\nClick: open it here`)
        .child(div().flex_none().size(6).rounded(3).bg(is ? statusColor(ts, t) : C.faint))
        .child(icon(term, ta, 15))
        .child(div().max_w(150).truncate().text_size(11).text_color(C.text).child(termName(term, ta, tabs)))
        .when(away, (el) => el.child(div().flex_none().text_size(9.5).text_color(C.faint).child((machineOf(term.address) ?? this.host ?? "here").toUpperCase())));
    };
    // A sub-agent: its transcript opens here (the one showing is marked).
    const subChip = (x, i) => {
      const c = { kind: "sub", key: `sub:${base}:${x.id ?? i}`, x }, on = viewing?.key === c.key;
      return h_flex().id(`fam-${c.key}`).h(20).px(6).gap(5).flex_none().items_center().rounded(5).cursor_pointer()
        .border(1).border_color(on ? C.accent : fade(C.second, 0.45)).bg(fade(on ? C.accent : C.second, on ? 0.16 : 0.08)).hover((s) => s.bg(fade(C.second, 0.2)))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.openSub({ address: base }, c, cx))
        .tooltip(`${crewName(c)}${crewDetail(c) ? `  ·  ${crewDetail(c)}` : ""}\nClick: read its transcript here, live`)
        .child(svg(`mods/${MOD}/drone.svg`).size(12).flex_none().text_color(C.second))
        .child(div().max_w(150).truncate().text_size(11).text_color(C.text).child(crewName(c)));
    };
    const word = (s) => div().flex_none().text_size(10.5).text_color(C.faint).child(s);
    const from = viewing ? null : fam.parent.get(addr) ?? (isAgentTerm(k) ? null : k.parent && fam.by.has(k.parent) ? k.parent : null);
    const kids = [...(fam.kids.get(base) ?? []), ...(fam.procs.get(base) ?? [])];
    const sibs = from ? [...(fam.kids.get(from) ?? []), ...(fam.procs.get(from) ?? [])].filter((x) => x.address !== addr) : [];
    const inner = Array.isArray(infos[base]?.inner) ? infos[base].inner : [];
    const parts = [];
    if (viewing && owner) parts.push(word("WORKS FOR"), chip(owner));
    if (from) parts.push(word("STARTED BY"), chip(fam.by.get(from)));
    if (sibs.length) parts.push(word("WITH"), ...sibs.map(chip));
    if (kids.length) parts.push(word(viewing ? "· ITS CREW" : from ? "· STARTED" : "STARTED"), ...kids.map(chip));
    if (inner.length) parts.push(word(viewing ? "· SUB-AGENTS" : "SUB-AGENTS"), ...inner.map(subChip));
    const line2 = parts.length
      ? div().h(22).min_w(0).child(h_flex().id("dock-family").size_full().gap(5).items_center().overflow_x_scrollbar().children(parts))
      : h_flex().h(22).min_w(0).items_center().child(div().min_w(0).truncate().text_size(11).text_color(C.faint)
        .child([tilde(k.cwd ?? "", (shared("mainframe.homes") ?? {})[machineOf(addr) ?? ""] ?? null), a ? agentTask(a, null) : null].filter(Boolean).join("  ·  ")));
    return frame.child(line1).child(line2);
  }

  render(_cx) {
    const t = theme();
    if (this.view === "keys" || this.view === "blank") return div();
    C = skin(t);
    if (this.view === "bar") return this.bar(t);
    if (this.view === "picker") return this.picker(t);
    if (this.view === "help") return this.helpCard();
    if (this.view === "reader") return this.reader.render(shared(VIEW), t);
    if (this.view === "dock") return this.dockHead(t);
    return this.scene(t);
  }
}

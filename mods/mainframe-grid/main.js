// Mainframe Grid: every agent on one screen, as a night city. Each computer is a tower, each
// space a room in it, each agent its character (cast.js) standing in its room with what it
// is doing: status, model, effort, context used, task. Click an agent to go to it; right-click
// to give it another character. Esc, the Back button or the key (mainframe-grid.toggle) returns.
// With the keyboard: arrows pick an agent (left/right the next one, up/down the next room),
// Enter goes to it, C changes its character.
//
// Every colour is the theme's (skin, below): the Grid is the desk's other screen, not another
// product. Only the characters keep their own colours: they are pictures.
//
// One mod, five views, picked by the layout with props.view:
//   "bar"    the strip across the top (a window_drag block): title, counts, Back, window buttons
//   "scene"  the towers
//   "keys"   nothing to see: a 0px block that is always shown, so the key works on both screens
//            (a mod only gets its key commands while shown)
//   "picker" the character picker (a dialog this mod opens)
//   "blank"  an empty block (see init)
// The layout's root holds a stack "deck" with two children: "desktop" (Over9k) and "grid".
// Model, effort and context come from the sidebar (mainframe-side shares "mainframe.info").
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, spaces, machines, theme, run, shared, layout, props, nextCommand, checking, exec, window, openOverlay, closeOverlay, focused, fonts, home, settings } from "herdr";
import { casting, recast, face, body, ROSTER } from "./cast.js";
import { agentTask } from "./agent-name.js";

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
// Sizes for a character drawn at `cell` px a cell (it is 14 × 24 cells): 4, 5 or 6, the biggest
// that lets every tower fit the window (plan). `up` is how many steps past the smallest.
function metrics(cell) {
  const sw = 14 * cell, sh = 24 * cell, up = cell - 4;
  const stationW = sw + 166 + up * 14, stationH = sh + 26;
  // unit: a tower is this much wider for each station across.
  return { cell, up, sw, sh, stationW, stationH, unit: stationW + 2 * ROOM_PAD + WALL };
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
const statusColor = (s, t) => (s === "working" ? t.working : s === "blocked" ? t.blocked : s === "done" ? t.done ?? t.accent : t.idle ?? C.faint);

// Rooms onto floors, `cols` stations across: wide rooms first, each on the first floor with
// room for it; a room with more agents than fit across takes a floor to itself (and more rows).
function pack(rooms, cols) {
  const items = rooms.map((r, i) => ({ r, i, w: Math.min(r.agents.length, cols), tall: r.agents.length > cols }));
  const floors = [];
  for (const it of [...items].sort((a, b) => b.w - a.w || a.i - b.i)) {
    let f = it.tall ? null : floors.find((x) => !x.tall && x.used + it.w <= cols);
    if (!f) { f = { used: 0, items: [], tall: it.tall }; floors.push(f); }
    f.items.push(it); f.used += it.w;
  }
  return floors;
}

const rowsOf = (f, cols) => (f.tall ? Math.ceil(f.items[0].r.agents.length / cols) : 1);
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
    this.size = null;
    this.host = null;
    this.sel = null; // the agent the keyboard has picked (its address), in the scene
    this.order = []; this.roomStarts = []; // the agents as drawn, and where each room starts
    this.scroll = null; this.reveal = false; // the scene's scroll, and "bring the pick into view"
    this.font = fonts().includes("Pixelify Sans") ? "Pixelify Sans" : null;
    this.mono = settings().font_family ?? settings().font ?? null; // the terminals' font, for names
    if (this.view === "scene" || this.view === "picker") this.h = cx.focus_handle();
    if (this.view === "scene") this.scroll = ScrollHandle.new();
    if (checking()) return;
    if (this.view === "scene") {
      // This computer's name for its tower's sign (Herdr calls it null).
      cx.spawn(async (cx) => { try { this.host = (await exec("hostname", [])).stdout.trim() || null; } catch {} cx.notify(); });
      cx.timer.every(30000, (cx) => { if (showing() === "grid") cx.notify(); }); // "3m" ages
    }
    if (this.view === "bar") cx.timer.every(20000, (cx) => { if (showing() === "grid") cx.notify(); }); // the clock
    if (this.view === "picker") { this.h.focus(); return; }
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
        }
        cx.notify();
      }
    });
  }

  // The character picker, for one agent.
  pick(address) {
    openOverlay({ mod: MOD, kind: "dialog", width: 480, height: 452, props: { view: "picker", agent: address } });
  }
  // The keyboard in the scene: arrows move the pick, Enter goes, C recasts, Esc leaves.
  key(e, cx) {
    // The whole chord (e.keystroke): Ctrl+C and the like are not ours and go on their way.
    const k = e.keystroke ?? e.key, order = this.order, at = order.indexOf(this.sel);
    const to = (i) => { if (order.length) { this.sel = order[(i + order.length) % order.length]; this.reveal = true; cx.notify(); } };
    if (k === "escape") show("desktop");
    else if (k === "right" || k === "tab") to(at + 1);
    else if (k === "left" || k === "shift-tab") to(at < 0 ? 0 : at - 1);
    else if (k === "down" || k === "up") {
      // The next (or previous) room's first agent.
      const starts = this.roomStarts, room = starts.findLastIndex((s) => s <= Math.max(at, 0));
      to(starts[(room + (k === "down" ? 1 : -1) + starts.length) % starts.length] ?? 0);
    } else if (k === "enter" && at >= 0) {
      const a = agents().find((x) => x.address === this.sel);
      if (a) goTo(a, spaces().find((s) => s.active)?.id ?? null);
    } else if (k === "c" && at >= 0) this.pick(this.sel);
    else return;
    cx.stop_propagation();
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
    // A count: lit in its colour while there are any, a quiet outline at none.
    const chip = (label, n, color) => h_flex().h(26).px(10).gap(7).flex_none().items_center().rounded(6)
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
      .child(div().flex_1())
      .child(chip("WORKING", count("working"), t.working))
      .child(chip("NEED YOU", count("blocked"), t.blocked))
      .child(chip("DONE", count("done"), t.done ?? t.accent))
      .child(chip("IDLE", count("idle"), C.dim))
      .child(div().flex_1())
      .child(this.label(div(), 13).flex_none().text_color(C.dim).child(clock))
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
    // `picked`: the keyboard's pick in this screen.
    const here = a.focused && a.space === ctx.active && Boolean(tab?.active), picked = this.sel === a.address;
    ctx.order.push(a.address);
    const boxH = STATION_H - 12, top = boxH - 8 - SPRITE_H; // the sprite's feet rest 8px above the box's floor
    const sprite = div().relative().flex_none().w(SPRITE_W + 10).h(boxH)
      // The pad under its feet: lit in its status colour, pulsing while it works or waits on you.
      .child(div().absolute().left(1).bottom(2).w(SPRITE_W + 8).h(5).rounded(3).bg(idle ? C.line : color)
        .when(st === "working" || st === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: st === "blocked" ? 700 : 1500 })))
      .child(image(body(who)).absolute().left(5).top(top).w(SPRITE_W).h(SPRITE_H).opacity(idle ? 0.82 : 1)
        .when(st === "working", (el) => el.loop("top", { from: top, to: top - 3, period: 640 })))
      .when(st === "blocked", (el) => el.child(div().text_size(13).font_bold().absolute().left(SPRITE_W - 6).top(0).w(18).h(18).rounded(5).bg(t.blocked).text_color(C.on)
        .flex().items_center().justify_center().child("!").loop("top", { from: 0, to: 5, period: 700 })))
      .when(st === "done", (el) => el.child(div().text_size(12).font_bold().absolute().left(SPRITE_W - 6).top(2).w(18).h(18).rounded(5).bg(t.done ?? t.accent).text_color(C.on)
        .flex().items_center().justify_center().child("✓")))
      // Asleep: over its shoulder, inside its own box (further right it would run into its name).
      .when(idle, (el) => el.child(div().absolute().left(SPRITE_W - 8 - up * 2).top(0).text_size(10 + up).font_semibold().text_color(C.faint).frames(["z", "zZ", "zZz", " "], 900)));
    const details = v_flex().flex_1().min_w(0).gap(4 + up).justify_center()
      .child(this.label(div(), 15 + up * 1.5).min_w(0).truncate().text_color(C.text).child(name))
      .child(h_flex().gap(5).items_center().text_size(11 + up)
        .child(div().flex_none().size(6).rounded(3).bg(color))
        .child(div().flex_none().font_semibold().text_color(idle ? C.dim : color).child(WORD[st] ?? st))
        .when(Boolean(since), (el) => el.child(div().flex_none().text_color(C.faint).child(since)))
        .when(i.subs > 0, (el) => el.child(div().flex_none().px(4).rounded(3).bg(fade(C.second, 0.16)).text_color(C.second).tooltip(`${i.subs} sub-agent${i.subs === 1 ? "" : "s"}`).child(`+${i.subs}`))))
      .child(div().min_w(0).truncate().text_size(12 + up).text_color(C.dim).child(model))
      .when(pct != null, (el) => el.child(h_flex().gap(6).items_center()
        .child(div().relative().flex_1().h(4).rounded(2).bg(C.line)
          .when(pct > 0, (bar) => bar.child(div().absolute().left(0).top(0).h(4).rounded(2).bg(pctColor).w(`${pct}%`))))
        .child(div().flex_none().w(30 + up * 3).text_size(11 + up).text_color(pctColor).child(`${pct}%`))))
      .when(Boolean(task) && task !== name, (el) => el.child(div().min_w(0).truncate().text_size(12 + up).text_color(C.dim).child(task)));
    const tip = [`${name}  ·  ${who.name}`, a.program?.name, model, pct != null ? `context ${pct}% used` : null, task && task !== name ? task : null,
      "Click: go to it  ·  Right-click: change its character"].filter(Boolean).join("\n");
    return h_flex().id(`st-${a.address}`).flex_1().min_w(STATION_W).max_w(STATION_W + 90).h(STATION_H).px(8).gap(8).items_center().rounded(8).cursor_pointer()
      .border(1).border_color(picked ? C.accent : here ? fade(C.accent, 0.5) : st === "blocked" ? fade(t.blocked, 0.55) : fade(C.accent, 0))
      .bg(picked ? fade(C.accent, 0.13) : here ? C.selected : st === "blocked" ? fade(t.blocked, 0.07) : fade(C.accent, 0))
      .hover((s) => s.bg(C.hover))
      .tooltip(tip)
      .on_click(() => goTo(a, ctx.active))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.pick(a.address); })
      .child(sprite).child(details);
  }

  // ── a space: its sign, and its agents side by side ──────────────────────────────────
  room(r, px, cols, ctx, t) {
    const hue = hueOf(ctx.colors[r.space.id], t);
    ctx.rooms.push(ctx.order.length); // where this room's agents start in the keyboard's order
    const folder = tilde(r.space.folder, ctx.homes[r.space.machine ?? ""] ?? (r.space.machine ? null : ctx.home));
    const rows = [];
    for (let i = 0; i < r.agents.length; i += cols) rows.push(r.agents.slice(i, i + cols));
    const busy = r.agents.filter((a) => a.status === "working").length, need = r.agents.filter((a) => a.status === "blocked").length;
    return v_flex().w(px).flex_none().bg(C.room)
      .child(h_flex().h(SIGN_H).flex_none().px(ROOM_PAD).gap(8).items_center()
        // The sign: a tube in the space's colour.
        .child(this.label(div(), 11.5).flex_none().max_w(px - 60).truncate().px(7).py(1).rounded(3).border(1).border_color(fade(hue, 0.6)).bg(fade(hue, 0.1)).text_color(hue).child(String(r.space.name).toUpperCase()))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(C.faint).child(folder))
        .when(need > 0, (el) => el.child(div().flex_none().size(7).rounded(4).bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 700 })))
        .when(busy > 0, (el) => el.child(div().flex_none().size(7).rounded(4).bg(t.working))))
      .child(v_flex().px(ROOM_PAD).pb(4)
        .children(rows.map((row) => h_flex().children([
          ...row.map((a) => this.station(a, ctx, t)),
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
    const busy = count("working"), need = count("blocked"), n = tw.n;
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
        .when(busy > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.working).child(`${busy} working`)))
        .when(need > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.blocked).child(`${need} need you`))));
    // Its pieces, for the scene to put together: the roof, and each floor with which of the
    // keyboard's agents (ctx.order) stand on it.
    return { width, roof, floors: floors.map((f, at) => { const from = ctx.order.length; return { el: floor(f, at), from, to: ctx.order.length }; }) };
  }

  scene(t) {
    const ag = agents(), sp = spaces(), ms = machines();
    const ctx = { cast: casting(ag, sp), info: shared("mainframe.info") ?? {}, colors: shared("space.colors") ?? {},
      tabs: new Map(sp.flatMap((s) => s.tabs.map((x) => [x.id, x]))), active: sp.find((s) => s.active)?.id ?? null, home: this.homeDir ??= home(),
      homes: shared("mainframe.homes") ?? {}, order: [], rooms: [] };
    const W = this.size?.width ?? 1200, H = this.size?.height ?? 700;
    // Towers: this computer first, then the others, each with the spaces that have agents.
    const names = [null, ...ms.map((m) => m.name).filter(Boolean)];
    for (const s of sp) if (s.machine && !names.includes(s.machine)) names.push(s.machine);
    const towers = names.map((m) => ({
      machine: m, name: m ?? this.host ?? "This computer", state: ms.find((x) => (x.name ?? null) === m)?.layout ?? null,
      rooms: sp.filter((s) => (s.machine ?? null) === m).map((s) => ({ space: s, agents: ag.filter((a) => a.space === s.id) })).filter((r) => r.agents.length),
    })).filter((tw) => tw.rooms.length);
    for (const tw of towers) tw.n = tw.rooms.reduce((sum, r) => sum + r.agents.length, 0);
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
        .child(div().flex_none().text_size(11).text_color(C.dim).child("Click an agent to go to it  ·  right-click to change its character  ·  arrows and Enter work too")));
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
    this.order = ctx.order; this.roomStarts = ctx.rooms;
    if (this.sel && !ctx.order.includes(this.sel)) this.sel = null;
    if (this.reveal) {
      this.reveal = false;
      const at = ctx.order.indexOf(this.sel), hit = targets.find((x) => at >= x.from && at < x.to);
      if (hit) this.scroll?.scroll_to_item(hit.child);
    }
    return div().id("grid-scene").relative().size_full().bg(C.ink).track_focus(this.h)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
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
    let seed = 20261;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
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
    const p = props() ?? {}, ag = agents(), sp = spaces();
    const a = ag.find((x) => x.address === p.agent);
    const cast = casting(ag, sp), tabs = new Map(sp.flatMap((s) => s.tabs.map((x) => [x.id, x])));
    const current = a ? cast.of(a) : null;
    const users = new Map();
    for (const x of ag) { const c = cast.of(x); users.set(c.id, [...(users.get(c.id) ?? []), nameOf(x, tabs.get(x.tab))]); }
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
          .child(this.label(div(), 15).truncate().text_color(C.text).child(a ? `A character for ${nameOf(a, tabs.get(a.tab))}` : "That agent has gone"))
          .child(div().text_size(11).text_color(C.dim).child(current ? `Now ${current.name}. A dot marks one another agent has.` : "")))
        .child(div().id("pick-close").flex_none().size(26).rounded(6).flex().items_center().justify_center().text_color(C.dim).cursor_pointer()
          .hover((s) => s.bg(C.hover).text_color(C.text)).on_click(close).child(svg("mods/pane/close.svg").size(13))))
      .child(h_flex().flex_wrap().gap(6).children(ROSTER.map(tile)));
  }

  render(_cx) {
    const t = theme();
    if (this.view === "keys" || this.view === "blank") return div();
    C = skin(t);
    if (this.view === "bar") return this.bar(t);
    if (this.view === "picker") return this.picker(t);
    return this.scene(t);
  }
}

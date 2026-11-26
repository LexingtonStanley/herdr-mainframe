// Mainframe help & options: a dialog, opened from the sidebar's footer (mainframe-chrome) or
// `mod.open:mainframe-options`. Three pages, picked on the left:
//   Guide    what this layout adds to Herdr, a few lines each
//   Keys     its keys, read from keys.json as they are now
//   Options  this layout's own switches, saved in shared "mainframe.options" as they change
// The sidebar's rows, the usage rows, the To-do panel and the Timeline are Over9k's: their options
// stay in Over9k's own dialog, which the last row on the left opens.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, shared, setShared, keys, fonts, window, layouts } from "herdr";

const NAME = "Mainframe";
const TABS = "mainframe-tabs", GRID = "mainframe-grid", SIDE = "mainframe-side", CHROME = "mainframe-chrome";
const OPTIONS = "mainframe.options";
export const DEFAULTS = { toolbar: "auto", spaceColors: "theme", backdrop: true, tabFaces: true };
const ICONS = "mods/workspace-chrome";

const PAGES = [["guide", "Guide"], ["keys", "Keys"], ["options", "Options"]];

// The guide: [title, icon, lines]. Keys named in a line are looked up, so it says yours.
// An icon that is a character's face is shown as the picture it is; the others take the accent.
const GUIDE = (key) => [
  ["The Grid", `mods/${TABS}/grid.svg`, [
    `Every agent on one screen${key(`${GRID}.toggle`)}: each computer is a tower, each space a room, each agent a character standing in its room with its status, model, context used and task.`,
    "Click an agent and its session opens in the dock beside the towers, ready to type in; double-click goes to it at the desk. Right-click gives it another character. With the keyboard: arrows pick an agent, Enter opens it in the dock, Space opens it there and keeps the towers' keyboard, Shift+Enter goes to it at the desk, C changes its character, Esc closes the dock, then comes back.",
    "Agents that started other agents, on this computer or another, share a colour with them: a bar down the station's edge, \"◂ NAME\" for who started one, and a dot for each one it started. Picking, hovering or opening one lights up the rest. The dock's header lists them; click one to open it there.",
  ]],
  ["Characters", `mods/${GRID}/chars/riot-face.svg`, [
    "Each new agent takes the next free character from a library of 44, and keeps it: on its sidebar row, on its tab and in the Grid. An agent in a tab you named keeps its character across restarts.",
  ]],
  ["Chat", `mods/${TABS}/chat.svg`, [
    `The Chat button${key(`${TABS}.chat`)} shows the tab's agent as a conversation in place of its terminal; press it again for the terminal. Needs Flockbook; without it the button isn't there.`,
  ]],
  ["Asks", `mods/${TABS}/asks.svg`, [
    `Questions your agents stop on, from every space, in one panel${key(`${TABS}.toggle`)}. Answer there and the answer is typed into the agent. The button counts the ones waiting here, and elsewhere.`,
  ]],
  ["Neovim", "icons/nvim.svg", [
    `The Nvim button${key(`${TABS}.nvim`)} opens Neovim beside the tab, with its file tree in the side panel. While Neovim is open the button shows a dot, and one press closes it, whatever the side panel shows. Needs herdr-nvim; without it the button isn't there.`,
  ]],
  ["Agents, PRs, Usage", `mods/${TABS}/graph.svg`, [
    `Three wider panels at the end of the bar: your agents and their sub-agents as a graph${key(`${TABS}.graph`)}, pull requests to review${key(`${TABS}.prs`)}, and tokens and cost by agent and day${key(`${TABS}.usage-panel`)}.`,
  ]],
  ["The bar", `${ICONS}/panel-right.svg`, [
    "The buttons are in three groups: what the main area shows, the side panels, the wider tools. When the tabs need the room the groups go down to icons, from the right; hover one for its name and key.",
  ]],
  ["Colours", `${ICONS}/layers.svg`, [
    "Everything takes its colours from the theme, the Grid too: pick another in Settings and both screens follow. The layout comes with Cyan Matrix, whose panels match its terminals.",
  ]],
];

// The keys page: [what, ...actions that do it]. The first one keys.json binds is shown.
const KEYS = [
  ["The Grid, and back", `${GRID}.toggle`],
  ["Chat or terminal", `${TABS}.chat`],
  ["Asks", `${TABS}.toggle`],
  ["Neovim beside the tab", `${TABS}.nvim`, "mod.open:herdr-nvim"],
  ["Pick a file for Neovim", "herdr-nvim.pick"],
  ["Jump to Neovim's file tree", "herdr-nvim.reveal"],
  ["Agents graph", `${TABS}.graph`],
  ["Pull requests", `${TABS}.prs`],
  ["Usage", `${TABS}.usage-panel`],
  ["Switch between recent agents", `${SIDE}.switcher`],
  ["Close this tab", `${SIDE}.close-tab`, "tab.close"],
  ["Close this pane", `${SIDE}.close-pane`, "pane.close"],
  ["Fold the sidebar", "layout.toggle:sidebar"],
  ["Another layout", "layout.switch"],
  ["Every command", "app.palette"],
];
const GRID_KEYS = [["Pick an agent", "Arrows"], ["Go to it", "Enter"], ["Change its character", "C"], ["Back to the desk", "Esc"]];

// "ctrl-shift-i" as people read it: "Ctrl+Shift+I". Chords keep their space.
const keyLabel = (k) => k.split(" ").map((chord) => chord.split("-").map((p) => (p === "cmd" ? "Super" : p === "" ? "-" : p[0].toUpperCase() + p.slice(1))).join("+")).join(" ");

export default class Options extends View {
  init(_props, cx) {
    this.page = "guide";
    this.font = fonts().includes("Pixelify Sans") ? "Pixelify Sans" : null;
    this.h = cx.focus_handle();
    this.h.focus();
  }

  options() { return { ...DEFAULTS, ...(shared(OPTIONS) ?? {}) }; }
  set(key, value) { setShared(OPTIONS, { ...(shared(OPTIONS) ?? {}), [key]: value }); }

  // The key keys.json has for any of `actions` here: in this layout's section, else a global one
  // (another layout's key for it does nothing in this one).
  keyOf(actions) {
    const section = `layout:${shared("layout")}`, found = keys().filter((k) => actions.includes(k.action));
    return (found.find((k) => k.section === section) ?? found.find((k) => k.section === "global"))?.keys ?? null;
  }

  chip(text, t) {
    return div().flex_none().px(6).py(1).rounded(5).border(1).border_color(t.border).bg(t.raised).text_size(11.5).text_color(t.foreground).child(text);
  }

  guide(t) {
    const key = (action) => { const k = this.keyOf([action]); return k ? ` (${keyLabel(k)})` : ""; };
    return v_flex().gap(14).children(GUIDE(key).map(([title, icon, lines]) => h_flex().gap(12).items_start()
      .child(div().flex_none().size(30).rounded(8).bg(t.raised).flex().items_center().justify_center()
        .child(icon.endsWith("-face.svg") ? image(icon).w(24).h(24) : svg(icon).size(15).text_color(t.accent)))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(title))
        .children(lines.map((line) => div().text_size(12.5).line_height("18px").text_color(t.muted).child(line))))));
  }

  keysPage(t) {
    const row = (what, key) => h_flex().h(30).px(10).gap(10).items_center().rounded(7).hover((s) => s.bg(t.hover))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(what))
      .child(key ? this.chip(key, t) : div().flex_none().text_size(11.5).text_color(t.dim).child("no key"));
    const head = (text) => div().px(10).pt(10).pb(4).text_size(11).text_color(t.dim).child(text);
    return v_flex()
      .child(head("ANYWHERE IN THIS LAYOUT"))
      .children(KEYS.map(([what, ...actions]) => { const k = this.keyOf(actions); return row(what, k ? keyLabel(k) : null); }))
      .child(head("IN THE GRID"))
      .children(GRID_KEYS.map(([what, key]) => row(what, key)))
      .child(div().px(10).pt(12).text_size(11.5).line_height("17px").text_color(t.dim)
        .child(`Keys are yours to change: they live in keys.json, in the section "layout:${shared("layout") ?? "mainframe"}". Ask an agent to rebind one.`));
  }

  optionsPage(t) {
    const o = this.options();
    // One choice of several, side by side.
    const pick = (key, choices) => h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.raised)
      .children(choices.map(([value, label]) => div().id(`${key}-${value}`).h(24).px(10).rounded(6).flex().items_center().cursor_pointer().text_size(12)
        .bg(o[key] === value ? t.selected : t.raised).text_color(o[key] === value ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground)).on_click(() => this.set(key, value)).child(label)));
    // On or off.
    const flip = (key) => { const on = o[key] !== false; return h_flex().id(`sw-${key}`).flex_none().w(34).h(20).p(2).rounded(10).cursor_pointer()
      .bg(on ? t.accent : t.raised).border(1).border_color(on ? t.accent : t.border)
      .when(on, (el) => el.justify_end()).on_click(() => this.set(key, !on))
      .child(div().size(14).rounded(7).bg(on ? t.accent_foreground ?? t.background : t.muted)); };
    const item = (title, note, control) => h_flex().py(10).gap(16).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(13).text_color(t.foreground).child(title))
        .child(div().text_size(11.5).line_height("16px").text_color(t.muted).child(note)))
      .child(control);
    return v_flex()
      .child(item("Bar buttons", "Auto shows names while the tabs have room and icons when they don't.",
        pick("toolbar", [["auto", "Auto"], ["labels", "Names"], ["icons", "Icons"]])))
      .child(item("Space colours", "Theme uses the theme's own terminal colours, so spaces go with it. Vivid keeps Over9k's six strong colours in every theme.",
        pick("spaceColors", [["theme", "Theme"], ["vivid", "Vivid"]])))
      .child(item("Characters on tabs", "A tab that is one agent shows that agent's character in place of the program's icon.", flip("tabFaces")))
      .child(item("Skyline in the Grid", "The quiet row of buildings behind the towers.", flip("backdrop")))
      .child(h_flex().pt(14).gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(11.5).line_height("16px").text_color(t.dim)
          .child("What the sidebar's rows show, the usage rows, the To-do panel and the Timeline are Over9k's, with options of their own."))
        .child(h_flex().id("over9k-options").h(28).px(10).gap(7).flex_none().items_center().rounded(7).cursor_pointer()
          .border(1).border_color(t.border).text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => openOverlay({ mod: "over9k-options", kind: "dialog", width: 740, height: 600 }))
          .child(svg(`${ICONS}/settings.svg`).size(13)).child("Over9k options")));
  }

  render() {
    const t = theme(), overlay = props()?.overlay;
    const close = () => closeOverlay(overlay);
    const nav = (id, label) => div().id(`nav-${id}`).h(30).px(10).rounded(7).flex().items_center().cursor_pointer().text_size(13)
      .bg(this.page === id ? t.selected : t.chrome).text_color(this.page === id ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.page = id; cx.notify(); }).child(label);
    const body = this.page === "keys" ? this.keysPage(t) : this.page === "options" ? this.optionsPage(t) : this.guide(t);
    return h_flex().size_full().bg(t.popover).text_color(t.foreground).track_focus(this.h)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      // The navigator.
      .child(v_flex().w(186).h_full().flex_none().p(12).gap(3).bg(t.chrome).border_r(1).border_color(t.border)
        .child(h_flex().h(34).px(6).mb(8).gap(9).items_center()
          .child(svg(`mods/${CHROME}/mark.svg`).size(18).flex_none().text_color(t.accent))
          .child(div().text_color(t.foreground)
            .when(Boolean(this.font), (e) => e.font_family(this.font).text_size(17).font_weight(600))
            .when(!this.font, (e) => e.font_semibold())
            .child(this.font ? NAME.toUpperCase() : NAME)))
        .children(PAGES.map(([id, label]) => nav(id, label)))
        .child(div().flex_1())
        .child(div().px(6).text_size(11).line_height("16px").text_color(t.dim)
          .child("Built on Over9k, with Asks, Flockbook, Emergence's panels and herdr-nvim. Their licences are in the layout's LICENSES.md.")))
      // The page.
      .child(v_flex().flex_1().min_w(0).h_full()
        .child(h_flex().h(46).flex_none().px(18).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().text_size(14).font_semibold().child(`${NAME} ${this.page === "guide" ? "guide" : this.page === "keys" ? "keys" : "options"}`))
          .child(div().id("close").size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer().text_color(t.muted)
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(close).child(svg("mods/pane/close.svg").size(13))))
        .child(div().id("page").flex_1().min_h(0).overflow_y_scrollbar().child(div().px(18).py(14).child(body))));
  }
}

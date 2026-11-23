// Clone of the shipped tabs mod: the close button and right-click menu ask through
// over9k-close / over9k-menu (terminals and agents, not tabs).
// Mainframe: cloned from over9k-tabs. Adds the Asks engine and button
// (engine.js / parse.js / state.js copied from mods/tabs-asks, which must stay in step
// with mods/asks/state.js), and a Chat button that flips the main area between the
// tab's panes and Flockbook's chat (the layout's "view" stack; see VIEW below).
// Also Emergence's Agents, PRs and Usage panels (clones: mainframe-agents / -prs / -usage,
// whose tabs-plus.* calls were renamed to this mod's back / prs / rail commands).
// And an Nvim button for herdr-nvim (github.com/ChmaraX/herdr-nvim; see NVIM below).
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, focused, checking, keys } from "herdr";
import { Engine } from "./engine.js";
import { readState, loadConfig } from "./state.js";
import { casting, face } from "./cast.js";
import { plan } from "./close-plan.js";
import { agentTask } from "./agent-name.js";

// Closing a tab asks first only when it is its space's last (the space goes too)
// or an agent in it is still working, in over9k-close, which says how many
// terminals and agents end.
function closeAsk(picked) {
  const p = plan(picked);
  if (!p.spaces && !p.working) for (const c of p.commands) run(c.name, c.args);
  else openOverlay({ mod: "over9k-close", kind: "dialog", width: 380, height: 150, props: picked });
}

// Emergence panels: [panel-body child id, label, icon, default panel width px]. Each panel keeps
// its own width (dragged widths are remembered), as tabs-plus does.
const EMERGENCE = [
  ["graph", "Agents", "mods/mainframe-tabs/graph.svg", 620],
  ["prs", "PRs", "mods/mainframe-tabs/pr.svg", 860],
  ["usage-panel", "Usage", "mods/mainframe-tabs/usage.svg", 760],
];
const WIDTH = { "files-browser": 368, files: 368, changes: 368, todos: 368, prompts: 368, asks: 368, ...Object.fromEntries(EMERGENCE.map(([id, , , px]) => [id, px])) };

// The main area is the layout's "view" stack: the tab's panes ("view-tab") or one of Flockbook's
// screens ("view-chat", "view-needs", "view-overview"). Flockbook picks its screen by selecting in
// a stack named "screen", and once its chat has been shown it re-picks on every tab switch and
// split (the chat for a lone agent, whatever was showing). So here "screen" is a zero-size
// stand-in that takes those selects, and this bar copies its choice to "view" only in chat mode
// (the Chat button). In terminal mode the panes stay, whatever Flockbook picks.
const VIEW = "view", FLOCK = "screen";

// herdr-nvim: Neovim in a pane beside the agent, with its file tree in the side panel. Its
// installer puts that tree in the panel child named "files" (and would again on an upgrade),
// so in this layout "files" is the Nvim panel and Herdr's own Files browser, which also works
// in spaces on other computers, is the child "files-browser". Both are found by the mod they
// show, not by name: after an uninstall (which hands "files" back to Herdr's browser) the Nvim
// button just goes. herdr-nvim's own controller opens and closes the tab's nvim with the panel.
// That controller leaves nvim open when the panel turns to another one (Asks, Changes: Changes
// opens files in it), so the Nvim button goes by nvim itself, not by the tree: while the tab's
// nvim is open, one press closes it, whatever the panel shows (toggleNvim).
const NVIM = "herdr-nvim", NVIM_WIDTH = 300;
// This mod's and the Grid's names (their key commands), and this layout's options (the options
// dialog writes them): `toolbar` "auto" (labels while there is room for the tabs), "labels"
// or "icons"; `tabFaces` a one-agent tab shows its agent's character.
const MOD = "mainframe-tabs", GRID = "mainframe-grid", OPTIONS = "mainframe.options";
const options = () => ({ toolbar: "auto", tabFaces: true, ...(shared(OPTIONS) ?? {}) });
// A label's width at the bar's 12px, near enough to share the bar out (toolbarLevel).
const textW = (label) => Math.ceil(String(label).length * 6.7);
// Whether `tab` has its nvim open: a pane showing one of its herdr-nvim terminals (labelled
// herdr-nvim.sidebar=<tab>), or a file preview in nvim's place (a herdr-nvim mod pane).
function nvimOpen(tab) {
  if (!tab) return false;
  const ps = panes().filter((p) => p.tab === tab);
  if (ps.some((p) => p.terminal === null && p.mod === NVIM)) return true;
  const shown = new Set(ps.map((p) => p.terminal));
  return terminals().some((t) => t.state === "live" && t.labels?.["herdr-nvim.sidebar"] === tab && shown.has(t.address));
}
// The panel-body child showing `mod`.
function slot(body, mod) {
  return (body?.children ?? []).find((c) => c.content?.mod === mod && c.content?.props?.role !== "sync") ?? null;
}
// "ctrl-shift-i" as people read it: "Ctrl+Shift+I".
const keyLabel = (k) => k.split("-").map((part) => (part === "cmd" ? "Super" : part[0].toUpperCase() + part.slice(1))).join("+");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.shown = undefined; // the panel last seen showing (its id, null when closed), set on first render
    this.timelineAt = 0; // when the Timeline button was last clicked to open it
    this.widths = JSON.parse(localStorage.getItem("widths") ?? "{}");
    this.sizing = null; // our own panel resize, until the layout shows it: { px, at }
    this.opened = null; // the panel togglePanel last opened: { id, at }
    this.tabId = undefined; // the tab shown at the last render
    this.nvimSlot = null; // herdr-nvim's panel child, set each render
    // "chat": the main area follows Flockbook's screens; "tab": always the tab's panes.
    this.mode = localStorage.getItem("screenMode") ?? (this.screen() === "tab" ? "tab" : "chat");
    this.viewSet = null; // our last select in the "view" stack: { want, at }
    this.size = null; // the bar's size, once laid out
    // The Asks engine (from tabs-asks): finds agents' questions while the panel is closed.
    this.engine = new Engine();
    if (checking()) { this.engine.tick = () => {}; return; } // herdr-app check: no terminal reads or classifier calls
    // Once: the width remembered for "files" was the Files browser's; it moves with the browser,
    // and the Nvim panel starts at its own.
    const body = find(layout(), "panel-body"), nv = slot(body, NVIM)?.id, fb = slot(body, "files")?.id;
    if (nv && fb && fb !== nv && !localStorage.getItem("nvimWidths")) {
      if (this.widths[nv] !== undefined) {
        this.widths[fb] ??= this.widths[nv]; delete this.widths[nv];
        localStorage.setItem("widths", JSON.stringify(this.widths));
      }
      localStorage.setItem("nvimWidths", "1");
    }
    const config = (cx) => cx.spawn(async (cx) => { this.engine.config = await loadConfig(); this.engine._backend = undefined; this.engine._codex = undefined; cx.notify(); });
    config(cx);
    cx.timer.every(30000, config);
    cx.timer.every(1000, (cx) => this.engine.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") this.togglePanel("asks", false);
        else if (c === "open") this.togglePanel("asks", true);
        else if (c === "recheck") this.engine.recheck();
        else if (c === "chat") this.toggleChat();
        else if (c === "nvim") this.toggleNvim();
        else if (EMERGENCE.some(([id]) => id === c)) this.togglePanel(c, false);
        // The Emergence panels' calls (tabs-plus.* in the originals):
        else if (c === "back") { const f = focused(); if (f) run("pane.focus", f.pane ? { pane: f.pane } : { terminal: f.terminal }); }
        else if (c === "rail") run("layout.toggle", { id: "sidebar" }); // PRs full size folds the sidebar away and back
        cx.notify();
      }
    });
  }

  togglePanel(id, forceOpen) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const on = panel && !panel.hidden && body?.active === id;
    if (on && !forceOpen) run("layout.hide", { id: "panel" });
    else {
      if (id === "prompts") this.timelineAt = Date.now();
      this.opened = { id, at: Date.now() };
      run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" });
      this.sizePanel(id);
      // Opened on purpose: an Emergence panel takes the keyboard (their keyboard.js reads this).
      if (EMERGENCE.some(([e]) => e === id)) setShared("emergence.opened", { id, at: Date.now() });
    }
  }

  // Each panel at its own width (the one it was last dragged to). `sizing` holds our resize until
  // the layout shows it, so the width from before it isn't taken for a drag and remembered.
  sizePanel(id) {
    const px = this.widths[id] ?? (id === this.nvimSlot ? NVIM_WIDTH : WIDTH[id]);
    if (!px) return;
    this.sizing = { px, at: Date.now() };
    run("layout.resize", { id: "panel", px });
  }

  // The Nvim button and its key. Closed: the tree's panel opens and herdr-nvim's controller opens
  // nvim beside the tab. Open with its tree showing: the panel closes and the controller closes
  // nvim. Open behind another panel, or with no panel: nvim alone closes ("herdr-nvim.files",
  // the controller's own nvim-only toggle), and the panel stays as it is.
  toggleNvim() {
    const id = this.nvimSlot;
    if (!id) return;
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const tree = panel && !panel.hidden && body?.active === id;
    const tab = spaces().find((p) => p.active)?.tabs?.find((t) => t.active)?.id;
    // herdr-nvim set to its own explorer (tree = "nvim"): it has no tree panel, so nvim alone
    // opens and closes, as its own key does.
    if (shared("herdr-nvim.tree") === "nvim" || (!tree && nvimOpen(tab))) run("herdr-nvim.files");
    else this.togglePanel(id, false);
  }

  // What the main area shows: "tab" (the shown tab's panes), "chat", "needs" or "overview".
  screen() { return (find(layout(), VIEW)?.active ?? "view-tab").replace(/^view-/, ""); }
  // The screen Flockbook last picked (its own switching, its buttons, or showScreen below).
  flockScreen() { return find(layout(), FLOCK)?.active ?? "tab"; }
  // Picks a screen the way Flockbook does; in chat mode the main area follows (render).
  // flockbook.screen is Flockbook's own record of it; keep it in step so its views agree.
  showScreen(child) {
    setShared("flockbook.screen", child);
    setShared("flockbook.agent", null); // the chat follows the shown tab's (focused) agent
    run("layout.select", { stack: FLOCK, child });
  }
  setMode(mode) { this.mode = mode; localStorage.setItem("screenMode", mode); }
  tabHasAgent() {
    const tab = spaces().find(p => p.active)?.tabs?.find(t => t.active);
    return Boolean(tab && agents().some(a => a.tab === tab.id));
  }
  // Chat on: chat mode, at the chat. Chat off (or a Flockbook screen in a tab with no agent): terminals.
  toggleChat() {
    if (!find(layout(), "view-chat")) return;
    const now = this.screen();
    if (now === "chat" || (now !== "tab" && !this.tabHasAgent())) this.setMode("tab");
    else if (this.tabHasAgent()) { this.setMode("chat"); this.showScreen("chat"); }
  }

  // Double-click: a tab that's one agent renames its conversation, as the
  // sidebar's rename does (over9k-rename); any other tab is renamed itself.
  rename(c, agent, term) {
    const alone = panes().filter((p) => p.tab === c.id).length === 1;
    if (!agent?.address || !alone) return run("tab.rename", { id: c.id });
    openOverlay({ mod: "over9k-rename", kind: "dialog", width: 380, height: 200,
      props: { pane: term?.pane, terminal: agent.address, tab: c.id, alone, value: (!/^(\d+|tb?[0-9a-z]+)$/.test(c.name) && c.name !== agent.program?.name ? c.name : "") || agentTask(agent, term?.cwd), title: `Rename ${agent.program?.name ?? "agent"} session` } });
  }

  // See render: how many of the bar's button groups (from the right) show as icons only.
  toolbarLevel(groups, tabCount, windowButtons) {
    const mode = options().toolbar;
    if (mode === "labels") return 0;
    if (mode === "icons") return groups.length;
    const W = this.size?.width;
    if (!W) return 0;
    const wide = (b) => 16 + 14 + 5 + textW(b.label) + (b.badge ? 40 : 0) + (b.live ? 10 : 0) + 3, narrow = (b) => 14 + 14 + (b.badge ? 40 : 0) + (b.live ? 10 : 0) + 3;
    const fixed = 20 + 29 + groups.length * 14 + (windowButtons ? 3 * 29 + 14 : 0); // padding, +, rules, window buttons
    const want = Math.min(tabCount * 130, W * 0.6);
    for (let level = 0; level <= groups.length; level++) {
      const used = groups.reduce((sum, g, i) => sum + g.reduce((a, b) => a + (i >= groups.length - level ? narrow(b) : wide(b)), 0), 0);
      if (W - fixed - used >= want) return level;
    }
    return groups.length;
  }

  render(cx) {
    this.engine.tick(cx);
    const t = theme();
    const all = spaces();
    const space = all.find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // A tab nobody renamed (Herdr calls it 1, 2... or, after a move, by its
    // terminal's address) goes by its agent: its session's title (Claude Code's
    // task; Codex's thread title, the first part of "<title> | <model> <effort> |
    // Context N% used", see over9k), else the agent's name (other agents
    // title their folder), else its terminal's last command (over9k
    // shares them), else "New CLI". An agent that hasn't reported yet counts
    // already. A plain terminal's icon stays the terminal's whatever it runs.
    const ps = panes(), ag = agents(), last = shared("terminals.last") ?? {};
    // A tab that's one agent shows that agent's character (cast.js), as the sidebar does.
    const cast = casting(ag, all), faces = options().tabFaces !== false;
    const item = (c, i) => {
      const term = ps.find(p => p.tab === c.id && p.terminal);
      const own = ag.filter(a => a.tab === c.id), who = faces && own.length === 1 ? cast.of(own[0]) : null;
      const agent = own[0] ?? (term?.program?.agent ? term : null);
      const program = agent?.program ?? { icon: "icons/shell.svg", tint: true };
      // Its session's title, by the sidebar's rule (agent-name.js).
      const task = agent ? agentTask(agent, term?.cwd) : "";
      // The + menu names an agent's tab after it ("Codex"): that's no name either.
      const auto = /^(\d+|tb?[0-9a-z]+)$/.test(c.name) || (Boolean(agent) && c.name === agent.program?.name);
      const name = !auto ? c.name : agent ? task || agent.program?.name || "Agent" : last[term?.terminal] || "New CLI";
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) this.rename(c, agent, term); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "over9k-menu", kind: "popup", width: 200, height: 150, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(who), el => el.child(image(face(who)).w(21).h(21).flex_none()))
        .when(!who && Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closeAsk({ tabs: [c.id] }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    // Herdr's Files browser and herdr-nvim's tree, by what the panels show (NVIM, above).
    const filesSlot = slot(body, "files")?.id ?? null, nvimSlot = (this.nvimSlot = slot(body, NVIM)?.id ?? null);
    const tabId = shown.find(c => c.active)?.id ?? null;
    // The main area: Flockbook's pick in chat mode, the tab's panes otherwise (VIEW, above).
    // No Flockbook chat in this layout (the "view" stack has no "view-chat"): the panes, always,
    // and no Chat button.
    const hasChat = Boolean(find(root, "view-chat"));
    if (!hasChat && this.mode !== "tab") this.setMode("tab");
    const want = hasChat && this.mode === "chat" ? this.flockScreen() : "tab";
    if (find(root, VIEW) && this.screen() !== want && !(this.viewSet?.want === want && Date.now() - this.viewSet.at < 400)) {
      this.viewSet = { want, at: Date.now() };
      run("layout.select", { stack: VIEW, child: `view-${want}` });
    }
    // A tab without an agent has no chat: show its panes.
    const chatOn = hasChat && want === "chat", canChat = this.tabHasAgent();
    if (chatOn && !canChat) this.showScreen("tab");
    // Options › To-do off: no button, and the panel closes if it's showing the list.
    const todosOn = (shared("sidebar.options") ?? {}).todos !== false;
    if (!todosOn && panel && !panel.hidden && body?.active === "todos") run("layout.hide", { id: "panel" });
    const timelineOn = (shared("sidebar.options") ?? {}).timeline !== false;
    if (!timelineOn && panel && !panel.hidden && body?.active === "prompts") run("layout.hide", { id: "panel" });
    // The Timeline opens only from its button: anything else that turns the panel
    // to it (as happened when switching agents) is undone, back to what showed.
    const showing = panel && !panel.hidden ? body?.active ?? null : null;
    // Remember each panel's width as it is dragged (not PRs while it's full size).
    const px = panel?.size?.px;
    if (this.sizing && (px === this.sizing.px || Date.now() - this.sizing.at > 1500)) this.sizing = null;
    // A drag: the width changed while the same panel stayed shown (and it isn't our own resize landing).
    if (showing && showing === this.shown && px && !this.sizing && !(showing === "prs" && shared("pr-review.wide")) && this.widths[showing] !== px) {
      this.widths[showing] = px; localStorage.setItem("widths", JSON.stringify(this.widths));
    }
    if (this.shown === undefined) this.shown = showing;
    else if (showing === "prompts" && this.shown !== "prompts" && Date.now() - this.timelineAt > 2000) {
      if (this.shown) run("layout.select", { stack: "panel-body", child: this.shown });
      else run("layout.hide", { id: "panel" });
    } else {
      if (showing && showing !== this.shown) {
        // A panel something else opened (herdr-nvim's key or its controller; ours are in `opened`)
        // gets its own width too.
        if (!(this.opened?.id === showing && Date.now() - this.opened.at < 1500)) this.sizePanel(showing);
        // Nvim asked for in this tab while its chat shows: back to the panes, where nvim opens.
        // (Not when a tab switch brought the panel with it.)
        if (showing === nvimSlot && tabId === this.tabId && want !== "tab") this.showScreen("tab");
      }
      this.shown = showing;
    }
    this.tabId = tabId;
    // One side panel for the window: Files, Changes or To-do stays as you left it
    // when you switch space, tab or pane (Herdr's tabs remember it per space).
    // The Nvim button's hint, with the key keys.json gives it in this layout (else anywhere).
    // A button's key, as keys.json has it for this layout (else anywhere): " (Ctrl+Shift+Y)", or "".
    const bound = keys(), section = `layout:${shared("layout")}`;
    const keyHint = (...actions) => {
      const found = bound.filter(k => actions.includes(k.action));
      const key = (found.find(k => k.section === section) ?? found.find(k => k.section === "global"))?.keys;
      return key ? ` (${keyLabel(key)})` : "";
    };
    const nvimHint = keyHint(`${MOD}.nvim`, "mod.open:herdr-nvim");
    const remote = Boolean(space?.machine);
    // Open, with its tree behind another panel or put away.
    const nvimLive = Boolean(nvimSlot) && nvimOpen(tabId) && !(panel && !panel.hidden && body?.active === nvimSlot);
    const nvimTip = remote ? `Nvim runs on this computer; this space is on ${space.machine}`
      : nvimLive ? `Neovim is open in this tab. Click to close it${nvimHint}`
      : `Neovim beside this tab, with its file tree${nvimHint}`;
    // Pending asks: a count for the shown space, and a dim one when other spaces have some too.
    const pending = readState().asks.filter(a => a.state === "pending" && !a.notice);
    const here = pending.filter(a => a.space === (space?.id ?? focused()?.space)).length, elsewhere = pending.length - here;
    const badge = pending.length ? h_flex().gap(3).items_center()
      .when(here > 0, el => el.child(div().h(16).min_w(16).px(5).rounded(8).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(t.blocked).text_color(t.background).child(String(here))))
      .when(elsewhere > 0, el => el.child(div().h(16).min_w(16).px(4).rounded(8).flex().items_center().justify_center().text_size(10.5).border(1).border_color(t.border).text_color(t.muted).child(`+${elsewhere}`))) : null;
    const asksTip = `Questions your agents are waiting on${pending.length ? `: ${here} in this space${elsewhere ? `, ${elsewhere} in others` : ""}` : ""}${keyHint(`${MOD}.toggle`)}`;
    // The bar's buttons, in three groups with a rule between: what the main area shows (Chat,
    // Grid), the side panels, and Emergence's wider tools. Each: { id, label, icon, on, live, dim,
    // badge, tip, action }. `live`: what the button stands for is open though its panel isn't
    // the one showing (nvim behind another panel): lit text and a dot.
    const panelOn = (id) => Boolean(panel && !panel.hidden && body?.active === id);
    const side = (id, label, icon, tip, more = {}) => ({ id: `panel-${id}`, label, icon, on: panelOn(id), tip, action: () => this.togglePanel(id, false), ...more });
    const groups = [
      [
        // Chat: the tab's agent as a Flockbook chat, in place of its terminal. Dimmed for a tab with no agent.
        hasChat ? { id: "screen-chat", label: chatOn ? "Terminal" : "Chat", icon: `mods/${MOD}/${chatOn ? "terminal" : "chat"}.svg`, on: chatOn, dim: !canChat && !chatOn,
          tip: `${chatOn ? "Back to this tab's terminals" : canChat ? "This tab's agent as a chat" : "This tab has no agent to chat with"}${keyHint(`${MOD}.chat`)}`, action: () => this.toggleChat() } : null,
        // The Grid: every agent on one screen (the Grid mod), the layout's "deck" stack.
        { id: "screen-grid", label: "Grid", icon: `mods/${MOD}/grid.svg`, tip: `Every agent on one screen${keyHint(`${GRID}.toggle`)}`, action: () => run(`${GRID}.open`) },
      ].filter(Boolean),
      [
        side("asks", this.engine.config?.label ?? "Asks", `mods/${MOD}/asks.svg`, asksTip, { badge }),
        // Neovim beside the agent (herdr-nvim). Dim in a space on another computer: it runs nvim here only.
        nvimSlot ? side(nvimSlot, "Nvim", "icons/nvim.svg", nvimTip, { dim: remote, live: nvimLive, action: () => this.toggleNvim() }) : null,
        filesSlot && enabled.includes("files") ? side(filesSlot, "Files", "mods/files/file.svg", "This space's files") : null,
        enabled.includes("changes") ? side("changes", "Changes", "mods/changes/changes.svg", "What changed in this space's repo") : null,
        // To-dos per project, shared with agents (over9k-todos).
        todosOn ? side("todos", "To-do", "mods/workspace-chrome/circle-check.svg", "This project's to-do list, shared with its agents") : null,
        // Your prompts in the agent you're in, as a timeline (over9k-prompts).
        timelineOn ? side("prompts", "Timeline", "mods/over9k-prompts/timeline.svg", "Your prompts to this agent, in order") : null,
      ].filter(Boolean),
      // Emergence's panels: the agents graph, PR review, usage.
      EMERGENCE.map(([id, label, icon]) => side(id, label, icon, `${{ graph: "Agents and their sub-agents, as a graph", prs: "Pull requests to review", "usage-panel": "Tokens and cost, by agent and day" }[id]}${keyHint(`${MOD}.${id}`)}`)),
    ];
    // How many groups go down to icons (0: none; 1: the tools; 2: the panels too; 3: all), so
    // the tabs keep room: about 130px each, up to 60% of the bar.
    const level = this.toolbarLevel(groups, shown.length, Boolean(w?.buttons));
    const toolButton = (b, compact) => h_flex().id(b.id).h(26).px(compact ? 7 : 8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(b.on ? t.selected : t.chrome).text_color(b.on || b.live ? t.foreground : b.dim ? t.dim : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(b.action)
      .child(svg(b.icon).size(14).flex_none())
      .when(!compact, el => el.child(b.label))
      .when(Boolean(b.live) && !b.on, el => el.child(div().size(5).rounded(3).flex_none().bg(t.accent)))
      .when(Boolean(b.badge), el => el.child(b.badge))
      .tooltip(compact ? `${b.label}: ${b.tip}` : b.tip);
    const rule = () => div().w(1).h(16).mx(5).flex_none().bg(t.border);
    return h_flex().id("bar").size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // The tabs keep at least 150px; narrower than its icons, the tools' strip scrolls instead.
      .child(h_flex().id("tab-scroll").flex_1().min_w(150).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).tooltip(`New terminal or agent${keyHint("tab.new")}`))
      .child(h_flex().id("tools").flex_shrink(1).min_w(0).h_full().gap(3).items_center().overflow_x_scrollbar()
        .children(groups.flatMap((g, i) => [rule(), ...g.map(b => toolButton(b, i >= groups.length - level))])))
      .when(Boolean(w?.buttons), el => el.child(rule()))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/mainframe-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/mainframe-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/mainframe-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}

// Mainframe's chrome: the brand row at the top of the sidebar (the layout's mark and name, the
// space picker, the sidebar's fold) and, with props { footer: true }, the sidebar's last rows:
// Settings, Mainframe help & options, Add machine. The footer also looks for a newer Mainframe every
// six hours while the option is on (updates.js, a copy of mainframe-options' own); one waiting puts
// an Update tag on the help & options row, which then opens the dialog's Updates page.
// After Herdr's workspace-chrome, by way of Over9k's over9k-footer (MIT; see LICENSES.md). Icons
// are Herdr's own (mods/workspace-chrome), which every install has.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay, fonts, checking } from "herdr";
import { UPDATE, EVERY, check, load, running } from "./updates.js";

const MOD = "mainframe-chrome", OPTIONS_MOD = "mainframe-options", NAME = "Mainframe";
const ICONS = "mods/workspace-chrome";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow()); // the sidebar's mods read the flag too
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}
export const openOptions = (page) => openOverlay({ mod: OPTIONS_MOD, kind: "dialog", width: 740, height: 580, props: page ? { page } : {} });
const updateWaiting = () => (shared(UPDATE)?.behind ?? 0) > 0 && !running(shared(UPDATE));

export default class Chrome extends View {
  init(_props, cx) {
    // The Grid's pixel font (it comes with the layout), for the name.
    this.font = fonts().includes("Pixelify Sans") ? "Pixelify Sans" : null;
    if (!props()?.footer || checking()) return;
    // Updates: what the last look found, then a look whenever the last one is six hours old.
    const due = () => (shared("mainframe.options")?.checkUpdates ?? true) !== false && !running(shared(UPDATE))
      && Date.now() - (shared(UPDATE)?.checked ?? 0) > EVERY;
    cx.spawn(async (cx) => {
      await load();
      await cx.sleep(20000); // not while Herdr is starting
      if (due()) await check();
      cx.notify();
    });
    cx.timer.every(15 * 60 * 1000, (cx) => { if (due()) cx.spawn(async (cx) => { await check(); cx.notify(); }); });
  }
  button(id, label, tip, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).tooltip(tip).child(label);
  }
  render() {
    const t = theme(), collapsed = narrow(), mac = window()?.platform === "macos";
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .text_color(dim ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`${ICONS}/${icon}.svg`).size(14).flex_none())
        .when(!collapsed, (el) => el.child(div().min_w(0).truncate().child(label)))
        .when(collapsed, (el) => el.tooltip(label));
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates()?.app?.ready), (el) => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("options", "panel-left", `${NAME} help & options`, false, () => openOptions(updateWaiting() ? "updates" : null))
          .when(updateWaiting(), (el) => el.when(!collapsed, (el) => el.child(div().ml_auto().flex_none().px(5).py(1).rounded(4)
            .bg(t.accent + "26").text_size(10.5).text_color(t.accent).child("Update")))
            .when(collapsed, (el) => el.child(div().size(6).rounded_full().bg(t.accent)).tooltip(`${NAME} help & options \u00b7 update available`))))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(mac && !collapsed, (el) => el.pl(76))
      .when(!collapsed, (el) => el.child(h_flex().flex_1().min_w(0).gap(9).items_center()
        .child(svg(`mods/${MOD}/mark.svg`).size(18).flex_none().text_color(t.accent))
        .child(div().min_w(0).truncate().text_color(t.foreground)
          .when(Boolean(this.font), (e) => e.font_family(this.font).text_size(17).font_weight(600))
          .when(!this.font, (e) => e.font_semibold())
          .child(this.font ? NAME.toUpperCase() : NAME))))
      .when(!collapsed, (el) => el.child(this.button("search", svg(`${ICONS}/search.svg`).size(15), "Find a space, tab or agent", () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && mac), (el) => el.child(this.button("sidebar-toggle", svg(`${ICONS}/sidebar.svg`).size(15), collapsed ? "Unfold the sidebar" : "Fold the sidebar", toggleSidebar)));
  }
}

// Mainframe's chrome: the brand row at the top of the sidebar (the layout's mark and name, the
// space picker, the sidebar's fold) and, with props { footer: true }, the sidebar's last rows:
// Settings, Mainframe help & options, Add machine.
// After Herdr's workspace-chrome, by way of Over9k's over9k-footer (MIT; see LICENSES.md), without
// Over9k's update check. Icons are Herdr's own (mods/workspace-chrome), which every install has.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay, fonts } from "herdr";

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
export const openOptions = () => openOverlay({ mod: OPTIONS_MOD, kind: "dialog", width: 740, height: 580 });

export default class Chrome extends View {
  init() {
    // The Grid's pixel font (it comes with the layout), for the name.
    this.font = fonts().includes("Pixelify Sans") ? "Pixelify Sans" : null;
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
        .child(row("options", "panel-left", `${NAME} help & options`, false, openOptions))
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

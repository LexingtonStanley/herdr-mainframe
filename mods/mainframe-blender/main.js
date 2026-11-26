import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { appHome, checking, exec, layout, theme } from "herdr";

const MOD = "mainframe-blender";
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
}
const stamp = ms => new Date(ms).toTimeString().slice(0, 8);
const words = value => String(value ?? "").replace(/_/g, " ").toLowerCase();
const caption = (s, t) => div().text_size(10).font_bold().text_color(t.muted).child(s);
const line = (s, t) => div().text_size(12).text_color(t.foreground).child(s);
const card = t => v_flex().flex_none().p(12).gap(6).rounded(8).bg(t.surface).border(1).border_color(t.border);
function button(id, label, action, t, on = false) {
  return div().id(id).flex_none().px(8).py(3).rounded(5).cursor_pointer().text_size(12)
    .bg(on ? t.selected : t.chrome).text_color(on ? t.accent : t.muted)
    .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(label);
}

export default class Blender extends View {
  init(_p, cx) {
    this.port = localStorage.getItem("port") || "9876";
    this.track = localStorage.getItem("track") === "true";
    this.portInput = InputState.new({ value: this.port });
    this.portInput.on("submit", (_e, cx) => this.connect(cx));
    this.tab = "Scene";
    this.width = 510;
    this.changes = [];
    this.last = 0;
    this.due = 0;
    if (!checking()) cx.timer.every(500, cx => {
      if (this.shown() && !this.paused && Date.now() >= this.due) this.refresh(cx);
    });
  }
  shown() {
    const root = layout();
    return find(root, "deck")?.active === "desktop" && !find(root, "panel")?.hidden &&
      find(root, "panel-body")?.active === "blender";
  }
  connect(cx) {
    const value = this.portInput.value().trim();
    if (!/^\d+$/.test(value) || +value < 1 || +value > 65535) {
      this.invalid = "Port must be between 1 and 65535."; cx.notify(); return;
    }
    if (this.port !== value) {
      this.data = null; this.previousFrame = null; this.last = 0; this.changes = []; this.selected = null;
    }
    this.port = value; localStorage.setItem("port", value);
    this.invalid = null; this.setup = false; this.paused = false; this.due = 0;
    this.refresh(cx); cx.notify();
  }
  refresh(cx) {
    if (this.busy) return;
    const port = this.port, track = this.track;
    this.busy = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const home = appHome();
        const res = await exec("python3", [`${home}/mods/${MOD}/client.py`, port, track ? "track" : "scene", home], { timeout: 20000 });
        if (res.code !== 0) throw new Error(res.stderr.trim() || "No reply from Blender");
        const next = JSON.parse(res.stdout);
        if (this.port !== port || this.track !== track) return;
        if (this.data && next.file === this.data.file && next.name === this.data.name) {
          const before = new Map(this.data.objects.map(o => [o.name, JSON.stringify(o)]));
          const after = new Set(next.objects.map(o => o.name));
          const changes = next.objects.filter(o => before.get(o.name) !== JSON.stringify(o))
            .map(o => `${before.has(o.name) ? "Updated" : this.data.count > before.size ? "Now listed:" : "Added"} ${o.name}`);
          for (const name of before.keys()) if (!after.has(name)) changes.push(`${next.count > after.size ? "No longer listed:" : "Removed"} ${name}`);
          if (changes.length) this.changes.unshift({ at: Date.now(), text: changes.slice(0, 3).join(" · ") +
            (changes.length > 3 ? ` · +${changes.length - 3} more` : "") });
          this.changes.length = Math.min(24, this.changes.length);
        } else this.changes = [];
        const oldFrame = this.data?.frameImage?.path;
        this.previousFrame = oldFrame !== next.frameImage?.path ? oldFrame : null;
        this.data = next; this.error = null; this.last = Date.now();
      } catch (e) {
        if (this.port === port) this.error = String(e.message ?? e).slice(0, 300);
      } finally {
        this.busy = false;
        this.due = Date.now() + (this.error ? 4000 : 1400);
        cx.notify();
      }
    });
  }
  settings(t) {
    return card(t).child(caption("BLENDER MCP CONNECTION", t))
      .child(line("Start the Blender MCP server in Blender’s sidebar. For another computer, forward its port to localhost.", t))
      .child(h_flex().items_center().gap(6).child(line("127.0.0.1 :", t))
        .child(Input.new(this.portInput).w(80).h(26).px(6).rounded(4).bg(t.background).text_color(t.foreground))
        .child(button("connect", "Connect", (_e, cx) => this.connect(cx), t)))
      .when(Boolean(this.invalid), el => el.child(line(this.invalid, t)))
      .child(button("tracking", `${this.track ? "✓" : "+"} Record MCP command names & timings`, (_e, cx) => {
        this.track = !this.track; localStorage.setItem("track", String(this.track)); this.due = 0; cx.notify();
      }, t, this.track));
  }
  objectDetail(o, t) {
    return card(t).child(caption(`OBJECT INSPECTOR   /   ${o.type}`, t)).child(line(o.name, t))
      .child(line(`Position  ${o.position.join("  /  ")}     ·     Size  ${o.size.join(" × ")}`, t))
      .child(line(`Rotation  ${o.rotation.join("° / ")}°     ·     Scale  ${o.scale.join(" × ")}`, t))
      .when(o.faces != null, el => el.child(line(`${o.vertices} vertices  ·  ${o.faces} faces`, t)))
      .when(o.materials.length > 0, el => el.child(line(`Materials   ${o.materials.join(", ")}`, t)))
      .when(o.modifiers.length > 0, el => el.child(line(`Modifiers   ${o.modifiers.join(", ")}`, t)))
      .when(o.collections.length > 0, el => el.child(line(`Collection   ${o.collections.join(", ")}`, t)));
  }
  activity(d, t, limit = 40) {
    const commands = (this.track ? d.activity : []).map(e => ({ at: e.at * 1000,
      text: `${e.ok ? "✓" : "Failed"}  ${e.tool}   ·   ${e.ms} ms` }));
    const rows = [...commands, ...this.changes].sort((a, b) => b.at - a.at).slice(0, limit);
    return card(t).child(caption("ACTIVITY   /   NEWEST FIRST", t))
      .when(!rows.length, el => el.child(line("Scene changes will appear here. Enable command recording in Connection for MCP timings.", t)))
      .children(rows.map(r => h_flex().gap(10).items_start()
        .child(div().text_size(11).flex_none().text_color(t.dim).child(stamp(r.at)))
        .child(line(r.text, t).min_w(0))));
  }
  render() {
    const t = theme(), d = this.data, f = d?.frameImage;
    const selected = d?.objects.find(o => o.name === (this.selected || d.active));
    const active = d?.objects.find(o => o.name === d.active);
    const state = this.paused ? "PAUSED" : this.error ? (d ? "STALE" : "OFFLINE") : d ? "LIVE" : "CONNECTING";
    const body = v_flex().id("blender-scroll").flex_1().min_h(0).p(12).gap(10).overflow_y_scrollbar();
    if (this.setup || (!d && this.error)) body.child(this.settings(t));
    if (this.error) body.child(card(t).child(caption(d ? `LAST GOOD SNAPSHOT   ${stamp(this.last)}` : "CONNECTION", t)).child(line(this.error, t)));
    if (d) {
      const frameWidth = Math.max(160, this.width - 28);
      const frameHeight = f ? Math.min(380, frameWidth * f.h / f.w) : 0;
      const picture = path => image(path).absolute().inset_0().w(frameWidth).h(frameHeight);
      body.child(v_flex().flex_none().rounded(8).overflow_hidden().bg(t.background).border(1).border_color(t.border)
        .child(h_flex().px(10).py(5).justify_between().bg(t.surface)
          .child(caption("01   /   VIEWPORT", t)).child(caption(`${d.shading || "NO VIEW"}   ·   ${stamp(this.last)}`, t)))
        .child(f ? div().relative().w(frameWidth).h(frameHeight).flex_none()
          .when(Boolean(this.previousFrame), el => el.child(picture(this.previousFrame)))
          .child(picture(f.path))
          : line(d.viewportError || "No frame available", t).p(12)));
      body.child(h_flex().gap(4).children(["Scene", "Objects", "Activity"].map(s =>
        button(`tab-${s}`, s, (_e, cx) => { this.tab = s; cx.notify(); }, t, this.tab === s))));
      if (this.tab === "Scene") {
        body.child(card(t).child(caption("02   /   SCENE BRIEF", t))
          .child(div().font_bold().text_size(18).text_color(t.foreground).child(d.name))
          .child(line(`${d.count} objects   ·   ${d.collectionCount} collections   ·   ${d.materialCount} materials`, t))
          .child(line(`${words(d.engine).replace("blender ", "").toUpperCase()}   ·   ${d.resolution[0]} × ${d.resolution[1]} at ${d.resolution[2]}%`, t))
          .child(line(`Frame ${d.frame} of ${d.range.join("–")}   ·   Camera: ${d.camera || "none"}`, t)));
        if (active) body.child(this.objectDetail(active, t));
        body.child(this.activity(d, t, 4));
      } else if (this.tab === "Activity") body.child(this.activity(d, t));
      else {
        if (selected) body.child(this.objectDetail(selected, t));
        const outliner = card(t).child(caption(`OUTLINER   /   ${d.objects.length} OF ${d.count}`, t));
        for (const o of d.objects) outliner.child(button(`obj-${o.name}`, `${o.type}   /   ${o.name}`, (_e, cx) => {
          this.selected = o.name; cx.notify();
        }, t, o.name === selected?.name));
        body.child(outliner);
      }
    } else if (!this.error) body.child(line("Waiting for the first scene snapshot…", t));
    return v_flex().size_full().min_w(0).bg(t.canvas)
      .on_size_change((s, cx) => { if (this.width !== s.width) { this.width = s.width; cx.notify(); } })
      .child(h_flex().h(38).flex_none().px(12).gap(7).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(svg(`mods/${MOD}/blender.svg`).size(17).text_color(t.accent))
        .child(div().font_bold().text_size(14).text_color(t.foreground).child("Blender"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(d ? `${d.file}${d.dirty ? " *" : ""}  ·  ${d.version}` : `127.0.0.1:${this.port}`))
        .child(div().text_size(10).font_bold().text_color(state === "LIVE" ? t.working : t.muted).child(state)))
      .child(h_flex().px(12).pt(8).gap(4).items_center()
        .child(button("setup", "Connection", (_e, cx) => { this.setup = !this.setup; cx.notify(); }, t, this.setup))
        .child(button("pause", this.paused ? "Resume" : "Pause", (_e, cx) => { this.paused = !this.paused; this.due = 0; cx.notify(); }, t, this.paused))
        .child(button("refresh", this.busy ? "Reading…" : "Refresh", (_e, cx) => this.refresh(cx), t)))
      .child(body);
  }
}

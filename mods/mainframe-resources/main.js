import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, checking, exec, layout, machines, readTextFile, theme, window } from "herdr";
import { bytes, encodeCommand, machineList, panelShown, parseSample, platform, up } from "./lib.js";

const text = (value, color, size = 12) => div().min_w(0).text_size(size).text_color(color).child(value);
const pct = n => n == null ? "—" : `${Math.round(n)}%`;
const degrees = n => `${Number(n.toFixed(1))} °C`;
const amount = ({ used, total }) => `${bytes(used)} / ${bytes(total)}`;
const tone = (n, t) => n >= 90 ? (t.ansi1 || t.blocked || t.accent) :
  n >= 75 ? (t.ansi3 || t.working || t.accent) : t.accent;
const sampleInterval = name => name === null ? 2000 : 5000;
const key = name => JSON.stringify(name);
const shown = () => window()?.visible !== false && panelShown(layout());

function row(label, value, t, color = t.foreground) {
  return h_flex().gap(8).items_center()
    .child(text(label, t.muted).flex_1().truncate()).child(text(value, color).flex_none());
}
function bar(value, t) {
  const track = div().w_full().h(4).rounded(2).overflow_hidden().bg(t.border);
  if (Number.isFinite(value) && value > 0) track.child(div().w(`${value}%`).h(4).bg(tone(value, t)));
  return track;
}
function button(id, label, click, t, selected = false) {
  return div().id(id).flex_none().px(8).py(3).rounded(4).cursor_pointer()
    .bg(selected ? t.selected : t.surface).text_color(selected ? t.accent : t.foreground)
    .hover(s => s.bg(t.hover)).on_click(click).text_size(11).child(label);
}
function section(title, t) {
  return v_flex().gap(4).pt(6).border_t(1).border_color(t.border)
    .child(text(title, t.muted, 10).font_bold());
}
function snapshot(card, data, history, t) {
  const cpu = section("CPU", t), c = data.cpu;
  const detail = [];
  if (c.cores !== null) detail.push(`${c.cores} logical cores`);
  if (c.load.length) detail.push(`Load  ${c.load.map(n => n.toFixed(2)).join("  ")}`);
  cpu.child(row("Utilisation", pct(c.percent), t)).child(bar(c.percent, t));
  if (detail.length) cpu.child(text(detail.join("   ·   "), t.muted, 11));
  if (history.length) {
    const graph = h_flex().w_full().h(18).gap(1).items_end().overflow_hidden();
    // Keep the newest sample on the right until the history fills.
    if (history.length < 60) graph.child(div().flex_grow(60 - history.length).flex_basis(0));
    for (const n of history) graph.child(div().flex_1().min_w(0).h(Math.max(1, n * 0.18)).bg(tone(n, t)));
    cpu.child(graph);
  }
  card.child(cpu);

  const heat = section("TEMPERATURES", t);
  heat.child(row("CPU package", data.packageTemp === null ? "not available" : degrees(data.packageTemp),
    t, data.packageTemp === null ? t.muted : tone(data.packageTemp, t)));
  for (const sensor of data.sensors) heat.child(row(sensor.name, degrees(sensor.celsius), t));
  card.child(heat);
  card.child(section("MEMORY", t).child(row("Physical", amount(data.memory), t))
    .child(bar(data.memory.percent, t)).child(row(data.os === "Windows" ? "Pagefile" : "Swap", amount(data.swap), t)));

  if (data.gpus.length) {
    const gpu = section("GPU", t);
    for (const g of data.gpus) {
      gpu.child(row(g.name, pct(g.percent), t));
      if (g.percent !== null) gpu.child(bar(g.percent, t));
      const readings = [];
      if (g.vram.used !== null || g.vram.total !== null) readings.push(`VRAM  ${amount(g.vram)}`);
      if (g.temp !== null) readings.push(degrees(g.temp));
      if (g.watts !== null) readings.push(`${Number(g.watts.toFixed(1))} W`);
      if (readings.length) gpu.child(text(readings.join("   ·   "), t.muted, 11));
    }
    card.child(gpu);
  }
  const disks = section("STORAGE", t);
  if (!data.drives.length) disks.child(text("No drive readings", t.muted));
  for (const d of data.drives) disks.child(row(d.mount, amount(d), t)).child(bar(d.percent, t));
  card.child(disks);
}

export default class Resources extends View {
  init(_props, cx) {
    this.states = new Map();
    this.scripts = new Map();
    this.paused = false;
    this.active = false;
    if (!checking()) cx.timer.every(500, cx => this.tick(cx));
  }

  state(name) {
    if (!this.states.has(name)) this.states.set(name, {
      os: name === null ? platform(window()?.platform) : null, data: null, baseline: null, history: [],
      busy: false, due: 0, revision: 0, error: "", collapsed: localStorage.getItem("fold:" + key(name)) === "1",
    });
    return this.states.get(name);
  }

  reset(state) {
    state.revision++;
    state.baseline = null;
    state.due = 0;
  }

  tick(cx, manual = false) {
    const visible = shown();
    if (visible) {
      for (const state of this.states.values()) {
        if (state.error && Date.now() >= state.errorUntil) { state.error = ""; cx.notify(); }
      }
    }
    if (!visible || (this.paused && !manual)) {
      if (this.active) for (const state of this.states.values()) this.reset(state);
      this.active = false;
      return;
    }
    this.active = !this.paused;
    const rows = machineList(machines()), live = new Set(rows.map(m => m.name));
    for (const [name, state] of this.states) {
      if (!live.has(name)) {
        if (!state.busy) this.states.delete(name);
        else this.reset(state);
      }
    }
    for (const { name, layout: status } of rows) {
      const state = this.state(name);
      if (status !== "ready") {
        if (state.available !== false) this.reset(state);
        state.available = false;
        continue;
      }
      state.available = true;
      if (state.busy || (!manual && Date.now() < state.due)) continue;
      this.poll(name, state, cx, manual);
    }
  }

  async source(os) {
    const file = os === "Windows" ? "windows.ps1" : "unix.sh";
    if (!this.scripts.has(file)) {
      this.scripts.set(file, readTextFile(`${appHome()}/mods/mainframe-resources/${file}`).then(s => {
        if (!s?.trim()) throw new Error(`Missing collector: ${file}`);
        return s;
      }).catch(e => { this.scripts.delete(file); throw e; }));
    }
    return this.scripts.get(file);
  }

  poll(name, state, cx, manual) {
    state.busy = true;
    state.due = Date.now() + sampleInterval(name);
    const revision = state.revision;
    const current = () => revision === state.revision && shown() && (!this.paused || manual) &&
      machineList(machines()).some(m => m.name === name && m.layout === "ready");
    cx.spawn(async cx => {
      try {
        if (!current()) return;
        let os = state.os;
        if (!os) {
          let probe;
          try { probe = await exec("uname", ["-s"], { on: name, timeout: 3500 }); } catch {}
          os = probe?.code === 0 ? platform(probe.stdout) : "Windows";
          if (!os) throw new Error("Unsupported operating system");
          if (!current()) return;
          if (probe?.code === 0) state.os = os;
        }
        const script = await this.source(os);
        if (!current()) return;
        const windows = os === "Windows";
        const args = windows ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodeCommand(script)] :
          ["-c", script, "resources", os === "macOS" ? "Darwin" : "Linux"];
        const result = await exec(windows ? "powershell" : "sh", args, { on: name, timeout: 12000 });
        if (!current()) return;
        if (result?.code !== 0) throw new Error(result?.stderr?.trim() || "Resource collector failed");
        const data = parseSample(result.stdout, state.baseline);
        state.os = data.os;
        state.data = state.baseline = data;
        if (data.cpu.percent !== null) state.history = [...state.history.slice(-59), data.cpu.percent];
        state.error = "";
        state.failed = false;
      } catch (error) {
        if (current()) {
          state.failed = true;
          state.errorUntil = Date.now() + 6000;
          state.error = String(error?.message || error || "No reply").replace(/\s+/g, " ").slice(0, 160);
          state.baseline = null;
        }
      } finally {
        state.busy = false;
        cx.notify();
      }
    });
  }

  card(machine, t) {
    const { name, layout: status } = machine, title = name ?? "This computer";
    const card = v_flex().flex_none().min_w(0).p(10).gap(7).rounded(7)
      .bg(t.surface).border(1).border_color(t.border);
    if (status !== "ready") return card.child(row(title, status === "unavailable" ? "offline" : "connecting…", t, t.muted));
    const state = this.state(name), d = state.data;
    const header = v_flex().id("machine:" + key(name)).min_w(0).gap(2).rounded(3).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => {
        state.collapsed = !state.collapsed;
        localStorage.setItem("fold:" + key(name), state.collapsed ? "1" : "0");
        cx.notify();
      });
    header.child(h_flex().items_center().gap(6)
      .child(text(state.collapsed ? "▸" : "▾", t.muted))
      .child(text(title, t.foreground, 14).font_bold().flex_1().truncate())
      .child(text(state.os || "…", t.accent, 11)));
    const detail = [d?.hostname, up(d?.uptime)].filter(Boolean).join("   ·   ");
    if (detail) header.child(text(detail, t.muted, 11).truncate());
    card.child(header);
    if (state.error) card.child(text((d ? "Last sample · " : "") + state.error, t.blocked || t.muted, 11));
    else if (state.failed) card.child(text(d ? "Showing last sample" : "Sample unavailable", t.muted, 11));
    if (!state.collapsed) {
      if (d) snapshot(card, d, state.history, t);
      else if (!state.failed) card.child(text(this.paused ? "Paused" : "Waiting for first sample…", t.muted));
    }
    return card;
  }

  render() {
    const t = theme();
    const body = v_flex().id("resource-cards").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar();
    for (const machine of machineList(machines())) body.child(this.card(machine, t));
    const header = h_flex().h(38).flex_none().px(10).gap(5).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(text("Resources", t.foreground, 14).font_bold().flex_1())
      .child(button("pause", this.paused ? "Resume" : "Pause", (_e, cx) => {
        this.paused = !this.paused;
        this.tick(cx);
        cx.notify();
      }, t, this.paused))
      .child(button("refresh", "Refresh", (_e, cx) => this.tick(cx, true), t));
    return v_flex().size_full().min_w(0).bg(t.canvas).child(header).child(body);
  }
}

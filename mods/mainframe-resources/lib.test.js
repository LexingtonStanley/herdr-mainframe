import { expect, mock, test } from "bun:test";
import { bytes, machineList, panelShown, parseSample, platform, up, encodeCommand } from "./lib.js";

const fixture = name => Bun.file(new URL(`fixtures/${name}.json`, import.meta.url)).text();
const linux = await fixture("linux"), windows = await fixture("windows"), mac = await fixture("macos");

test("captured Linux sample and consecutive CPU ticks (iowait included in idle)", () => {
  const first = parseSample(linux), next = JSON.parse(linux);
  expect(first.hostname).toBe("conair");
  expect(first.cpu.percent).toBeNull();
  expect(first.cpu.cores).toBe(12);
  expect(first.cpu.load).toHaveLength(3);
  expect(first.packageTemp).toBeGreaterThan(0);
  expect(first.sensors.some(s => s.name.includes("NVMe"))).toBe(true);
  expect(first.gpus[0].name).toContain("Quadro");
  expect(first.memory.used).toBeGreaterThan(0);
  expect(first.drives.map(d => d.mount)).toContain("/");
  next.cpu.totalTicks += 2400;
  next.cpu.idleTicks += 600;
  expect(parseSample(JSON.stringify(next), first).cpu.percent).toBe(75);
  expect(parseSample(linux, first).cpu.percent).toBeNull();
  next.uptime = 1;
  expect(parseSample(JSON.stringify(next), first).cpu.percent).toBeNull();
});

test("Windows arrays, pagefile, missing package temperature, two adapters and drives", () => {
  const s = parseSample("\uFEFF" + windows);
  expect(s.cpu.percent).toBe(31);
  expect(platform("MINGW64_NT-10.0-26100")).toBe("Windows");
  expect(s.cpu.load).toEqual([]);
  expect(s.packageTemp).toBeNull();
  expect(s.sensors[0].celsius).toBe(42.1);
  expect(s.gpus.map(g => g.percent)).toEqual([38, 0]);
  expect(s.gpus[0].watts).toBe(82.45);
  expect(s.gpus[1].vram.percent).toBeNull();
  expect(s.swap.used).toBe(178257920);
  expect(s.drives.map(d => d.mount)).toEqual(["C:", "D:"]);
});

test("macOS load, GPU without dedicated memory, and mount with spaces", () => {
  const s = parseSample(mac);
  expect(s.os).toBe("macOS");
  expect(s.cpu.load).toEqual([1.89, 2.12, 2.35]);
  expect(s.cpu.percent).toBe(12.41);
  expect(s.drives[1].mount).toBe("/Volumes/Video Work");
  expect(s.gpus[0].vram.total).toBeNull();
  expect(s.sensors).toEqual([]);
});

test("optional malformed telemetry stays unknown and leaves genuine zeroes intact", () => {
  const bad = { os: "Windows", cpu: {load: [null, false, 0], percent: 130}, uptime: [],
    sensors: [null, [], {name: {}, celsius: false}], memory: {used: "0", total: 0},
    drives: false, gpus: ["oops", null, {name: "GPU", percent: "N/A", temp: -273}],
  };
  const s = parseSample(JSON.stringify(bad));
  expect(s.cpu.load).toEqual([0]);
  expect(s.cpu.percent).toBeNull();
  expect(s.memory).toEqual({used: 0, total: 0, percent: null});
  expect(s.drives).toEqual([]);
  expect(s.sensors).toEqual([]);
  expect(s.gpus[0].temp).toBeNull();
  expect(s.uptime).toBeNull();
  expect(bytes(null)).toBe("—");
  expect(bytes(0)).toBe("0 B");
  expect(bytes(1610612736)).toBe("1.5 GiB");
  expect(up(undefined)).toBe("");
  expect(up(90061)).toBe("up 1d 1h");
  for (const json of ["null", "[]", "{}", "garbled"]) expect(() => parseSample(json)).toThrow();
});

const panel = {id: "panel-body", type: "stack", active: "resources", children: [{id: "resources"}]};
test("visibility follows the selected stack and every ancestor", () => {
  const deck = {type: "stack", active: "desktop", children: [{id: "desktop", children: [panel]}, {id: "grid"}]};
  expect(panelShown(deck)).toBe(true);
  expect(panelShown({...deck, active: "grid"})).toBe(false);
  expect(panelShown({hidden: true, children: [deck]})).toBe(false);
  expect(panelShown({...panel, active: "files"})).toBe(false);
  expect(panelShown({...panel, children: [{id:"resources", hidden:true}]})).toBe(false);
  expect(panelShown({children: {}})).toBe(false);
  expect(machineList([{name:"peer", layout:"unavailable"}, null, {name:null, layout:"ready"}]))
    .toEqual([{name:null, layout:"ready"}, {name:"peer", layout:"unavailable"}]);
});

// Model the documented GPUI calls and capture spawned jobs without running commands.
function element() {
  const el = {childrenSeen: [], child(x) {
    if (x == null || (typeof x !== "string" && !x.childrenSeen)) throw new Error("Invalid child");
    this.childrenSeen.push(x);
    return this;
  }};
  const methods = "id px py p rounded cursor_pointer bg text_color hover on_click text_size font_bold gap items_center flex_1 truncate flex_none min_w w_full h overflow_hidden w pt border_t border_color items_end flex_grow flex_basis size_full min_h overflow_y_scrollbar border_b border";
  for (const m of methods.split(" ")) el[m] = (...args) => {
    if (args.some(x => x == null || (typeof x === "number" && !Number.isFinite(x)))) throw new Error(`Invalid ${m}`);
    if (m === "id") el.testId = args[0];
    if (m === "on_click") el.click = args[0];
    return el;
  };
  return el;
}
function control(tree, id) {
  if (tree?.testId === id) return tree;
  for (const child of tree?.childrenSeen || []) {
    const found = control(child, id);
    if (found) return found;
  }
}
const colors = Object.fromEntries("muted foreground accent ansi1 ansi3 working blocked chrome canvas border surface selected hover".split(" ").map(k => [k,k]));
let inventory, visible, dispatch;
mock.module("gpui-kit", () => ({ View: class {}, div: element }));
mock.module("gpui-base", () => ({ h_flex: element, v_flex: element }));
mock.module("herdr", () => ({
  checking: () => false, machines: () => inventory, layout: () => panel, window: () => ({platform: "linux", visible}),
  exec: (...args) => dispatch(...args), appHome: () => "/app", readTextFile: async p => p, theme: () => colors,
}));
const { default: Resources } = await import("./main.js");
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) };
function context() {
  storage.clear();
  const jobs = [];
  const cx = {timer: {every() {}}, notify() {}, spawn(fn) {jobs.push(fn(cx));}};
  return { cx, flush: () => Promise.all(jobs.splice(0)) };
}

test("polling gates, per-machine in-flight exclusion, OS cache, pause, offline, and failure recovery", async () => {
  const {cx, flush} = context(), view = new Resources(), calls = [];
  visible = false;
  inventory = [{name: "peer", layout: "ready"}, {name: "down", layout: "unavailable"}];
  let finish, fail = false;
  dispatch = async (cmd, args, opts) => {
    calls.push([cmd, args, opts]);
    if (cmd === "uname") throw Error("Program missing");
    if (cmd === "powershell" && fail) throw Error("Timed out");
    if (cmd === "sh" && !finish) await new Promise(resolve => {finish = resolve;});
    return {code: 0, stdout: cmd === "sh" ? linux : windows};
  };
  view.init({}, cx);
  expect(() => view.render()).not.toThrow();
  view.tick(cx); expect(calls).toHaveLength(0);
  visible = true;
  view.tick(cx);
  view.tick(cx, true);
  // Wait for the local job to be in flight while the remote job finishes.
  await Bun.sleep(0);
  expect(calls.map(c => [c[0], c[2].on])).toEqual([["uname", "peer"], ["sh", null], ["powershell", "peer"]]);
  expect(calls.every(c => c[2].timeout > 0)).toBe(true);
  expect(calls[2][1].slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
  expect(calls[2][1][5]).toMatch(/^[A-Za-z0-9+/]+=*$/);
  finish(); await flush();
  const local = view.state(null), peer = view.state("peer");
  expect(peer.due - local.due).toBeGreaterThanOrEqual(2990);
  view.tick(cx); expect(calls).toHaveLength(3);
  control(view.render(), "pause").click(null, cx);
  peer.due = 0;
  view.tick(cx); expect(calls).toHaveLength(3);
  fail = true;
  control(view.render(), "refresh").click(null, cx);
  await flush();
  expect(peer.error).toBe("Timed out");
  expect(calls.filter(c => c[0] === "uname")).toHaveLength(1);
  expect(() => view.render()).not.toThrow();
  fail = false;
  view.tick(cx, true); await flush();
  expect(peer.error).toBe("");
  control(view.render(), 'machine:"peer"').click(null, cx);
  const second = new Resources(); second.init({},cx);
  expect(second.state("peer").collapsed).toBe(true);
  expect(() => view.render()).not.toThrow();
});

test("post-sample view handles macOS, sparse telemetry, and empty collections", () => {
  const {cx} = context(), view = new Resources();
  inventory = []; visible = true;
  view.init({}, cx);
  for (const src of [mac, '{"os":"Linux","cpu":{},"gpus":[{}],"sensors":null,"drives":false}']) {
    view.state(null).data = parseSample(src);
    view.state(null).history = [0, 25, 100];
    expect(() => view.render()).not.toThrow();
  }
});

test.skipIf(process.platform === "win32")("Darwin collector turns simulated command output into one sample", async () => {
  // Exercise the actual shell/awk just as Herdr would. Every macOS command is a fixture.
  const commands = `
    uname() { echo studio.local; }
    sysctl() {
      case "$2" in
        hw.logicalcpu) echo 10 ;;
        hw.memsize) echo 34359738368 ;;
        vm.loadavg) echo '{ 1.89 2.12 2.35 }' ;;
        kern.boottime) echo '{ sec = 100000, usec = 0 }' ;;
        vm.swapusage) echo 'total = 1024.00M  used = 256.00M  free = 768.00M  (encrypted)' ;;
      esac
    }
    date() { echo 168702; }
    vm_stat() {
      echo 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'
      echo 'Pages free: 100000.'
      echo 'Pages inactive: 700000.'
      echo 'Pages speculative: 6400.'
    }
    top() { echo 'CPU usage: 20% user, 10% sys, 70% idle'; echo 'CPU usage: 8.00% user, 4.41% sys, 87.59% idle'; }
    df() {
      echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'
      echo '/dev/disk3s1s1 482797652 10476624 200000000 5% /'
      echo 'devfs 205 205 0 100% /dev'
      echo '/dev/disk3s6 482797652 2097172 200000000 2% /System/Volumes/VM'
      echo '/dev/disk3s5 482797652 270000000 200000000 58% /System/Volumes/Data'
      echo 'map auto_home 0 0 0 100% /System/Volumes/Data/home'
      echo '/dev/disk4s1 976426672 207230368 769196304 21% /Volumes/Video Work'
    }
    ioreg() {
      echo '+-o AGXAccelerator  <class AGXAccelerator, id 0x0000001>'
      echo '  "PerformanceStatistics" = {"Device Utilization %"=8,"vramUsedBytes"=3145728,"vramFreeBytes"=1048576}'
    }
  `;
  const script = await Bun.file(new URL("unix.sh", import.meta.url)).text();
  const run = Bun.spawnSync(["sh", "-c", commands + script, "resources", "Darwin"]);
  expect(run.exitCode).toBe(0);
  const s = parseSample(run.stdout.toString());
  expect(s.os).toBe("macOS");
  expect(s.cpu.percent).toBeCloseTo(12.41);
  expect(s.cpu.load).toEqual([1.89, 2.12, 2.35]);
  expect(s.uptime).toBe(68702);
  expect(s.memory.used).toBe(34359738368 - 806400 * 16384);
  expect(s.swap.used).toBe(256 * 1024 * 1024);
  // APFS: the system's other volumes are left out, and "/" shows its container (size less free).
  expect(s.drives.map(d => d.mount)).toEqual(["/", "/Volumes/Video Work"]);
  expect(s.drives[0].used).toBe((482797652 - 200000000) * 1024);
  expect(s.gpus.map(g => [g.name, g.percent])).toEqual([["AGXAccelerator", 8]]);
  expect(s.gpus[0].vram.percent).toBe(75);
});

test("hiding the panel during OS detection prevents the collector from starting", async () => {
  const {cx, flush} = context(), view = new Resources();
  inventory = [{name: null, layout: "unavailable"}, {name: "studio", layout: "ready"}];
  visible = true;
  let finish;
  const calls = [];
  dispatch = async cmd => {
    calls.push(cmd);
    if (cmd === "uname") {
      if (!finish) await new Promise(resolve => {finish = resolve;});
      return {code: 0, stdout: "Darwin\n"};
    }
    return {code: 0, stdout: mac};
  };
  view.init({}, cx);
  view.tick(cx);
  visible = false;
  view.tick(cx);
  finish(); await flush();
  expect(calls).toEqual(["uname"]);
  visible = true;
  for (let i = 0; i < 61; i++) { view.tick(cx, true); await flush(); }
  expect(view.state("studio").os).toBe("macOS");
  expect(view.state("studio").history).toHaveLength(60);
  expect(calls.filter(c => c === "uname")).toHaveLength(2);
});

test("encodeCommand: PowerShell's UTF-16LE base64", () => {
  // [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(...)) in PowerShell.
  expect(encodeCommand("dir")).toBe("ZABpAHIA");
  expect(encodeCommand("Get-Date")).toBe("RwBlAHQALQBEAGEAdABlAA==");
  expect(encodeCommand('"a"\n°')).toBe(btoa(String.fromCharCode(...[...'"a"\n°'].flatMap(c => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]))));
});

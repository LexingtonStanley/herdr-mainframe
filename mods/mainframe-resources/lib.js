// Only normalized snapshots cross into the view. Null means the provider had no reading.
const list = value => Array.isArray(value) ? value : [];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const label = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim() : "";
function number(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
const percent = value => number(value, 0, 100);
const temp = value => number(value, -40, 150);
function capacity(value) {
  const used = number(value?.used), total = number(value?.total);
  return { used, total, percent: used !== null && total > 0 ? Math.min(100, 100 * used / total) : null };
}

export function platform(name) {
  const value = label(name).toLowerCase();
  if (/^(mingw|msys|cygwin|windows_nt)/.test(value)) return "Windows";
  switch (value) {
    case "linux": return "Linux";
    case "darwin": case "macos": return "macOS";
    case "windows": return "Windows";
    default: return null;
  }
}

export function parseSample(stdout, previous = null) {
  let raw;
  try { raw = JSON.parse(stdout.trim().replace(/^\uFEFF/, "")); }
  catch { throw new Error("Collector returned invalid JSON"); }
  const os = platform(raw?.os);
  if (!record(raw) || !os || !record(raw.cpu)) throw new Error("Incomplete resource snapshot");
  const cpu = raw.cpu, hostname = label(raw.hostname), uptime = number(raw.uptime);
  const totalTicks = number(cpu.totalTicks), idleTicks = number(cpu.idleTicks);
  let busy = percent(cpu.percent);
  if (os === "Linux" && totalTicks !== null && idleTicks !== null) {
    busy = null;
    const before = previous?.cpu;
    if (previous?.os === os && previous.hostname === hostname && uptime >= previous.uptime &&
        before?.totalTicks != null && before.idleTicks != null) {
      const total = totalTicks - before.totalTicks, idle = idleTicks - before.idleTicks;
      if (total > 0 && idle >= 0 && idle <= total) busy = 100 * (1 - idle / total);
    }
  }
  return {
    os, hostname, uptime, packageTemp: temp(raw.packageTemp),
    cpu: { percent: busy, totalTicks, idleTicks, cores: number(cpu.cores, 1),
      load: list(cpu.load).slice(0, 3).map(v => number(v)).filter(v => v !== null) },
    memory: capacity(raw.memory), swap: capacity(raw.swap),
    sensors: list(raw.sensors).filter(record).map(s => ({ name: label(s.name), celsius: temp(s.celsius) }))
      .filter(s => s.name && s.celsius !== null),
    gpus: list(raw.gpus).filter(record).map(g => ({ name: label(g.name), percent: percent(g.percent),
      temp: temp(g.temp), watts: number(g.watts), vram: capacity(g.vram) })).filter(g => g.name),
    drives: list(raw.drives).filter(record).map(d => ({ mount: label(d.mount), ...capacity(d) })).filter(d => d.mount),
  };
}

export function machineList(rows) {
  const names = new Map([[null, { name: null, layout: "ready" }]]);
  for (const row of list(rows)) {
    if (!row || (row.name !== null && !(typeof row.name === "string" && row.name.trim()))) continue;
    names.set(row.name, { name: row.name, layout: row.layout });
  }
  return [...names.values()];
}

export function panelShown(node) {
  if (!record(node) || node.hidden) return false;
  const children = list(node.children);
  if (node.id === "panel-body") {
    return node.active === "resources" && children.some(c => c?.id === "resources" && !c.hidden);
  }
  if (node.type === "stack") return panelShown(children.find(c => c?.id === node.active) ?? (!node.active && children[0]));
  return children.some(panelShown);
}

export function bytes(n) {
  if (number(n) === null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${Number(n.toFixed(i && n < 100 ? 1 : 0))} ${units[i]}`;
}
export function up(seconds) {
  if (number(seconds) === null) return "";
  const mins = Math.floor(seconds / 60), hours = Math.floor(mins / 60);
  if (hours >= 24) return `up ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return hours ? `up ${hours}h ${mins % 60}m` : `up ${mins}m`;
}

// PowerShell's -EncodedCommand: the script as base64 of its UTF-16LE text. Passed this way it needs
// no quoting, whatever it holds (quotes, newlines), on this computer or through herdr-core on another.
export function encodeCommand(script) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = [];
  for (let i = 0; i < script.length; i++) { const c = script.charCodeAt(i); bytes.push(c & 255, c >> 8); }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (i + 1 < bytes.length ? abc[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? abc[n & 63] : "=");
  }
  return out;
}

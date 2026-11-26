// Mainframe's updates, for the help & options dialog and the sidebar's footer (mainframe-chrome has
// a copy of this file, since mods can't import from each other). The work is update.py's, next to
// this file: it fetches the layout's GitHub repository, compares it with what is installed and,
// when asked, installs the newer version. What it last found is in shared "mainframe.update" and in
// <home>/data/mainframe-update/status.json:
//   { state: "idle" | "updating" | "error", installed, latest, behind, log: [subject, ...],
//     checked, updated, message }
import { exec, appHome, shared, setShared, readTextFile } from "herdr";

export const UPDATE = "mainframe.update";
export const EVERY = 6 * 60 * 60 * 1000; // how often the footer looks, while "Check for updates" is on
const script = () => `${appHome()}/mods/mainframe-options/update.py`;
const statusFile = () => `${appHome()}/data/mainframe-update/status.json`;

// python3, or on Windows often only python or py.
let python = null;
async function run(args, timeout) {
  const tries = python ? [python] : [["python3"], ["python"], ["py", "-3"]];
  let last = null, started = false;
  for (const p of tries) {
    try {
      const r = await exec(p[0], [...p.slice(1), script(), "--home", appHome(), ...args], { timeout });
      started = true;
      const line = r.stdout.trim().split("\n").pop();
      let status = null;
      try { status = JSON.parse(line); } catch {}
      if (status) { python = p; setShared(UPDATE, status); return status; }
      last = (r.stderr || r.stdout).trim().split("\n").slice(-4).join("\n");
    } catch (e) { if (!started) last = String(e); }
  }
  const status = { ...(shared(UPDATE) ?? {}), state: "error", checked: Date.now(),
    message: started ? last || "The updater stopped without saying why." : "Mainframe's updates need Python 3, and it isn't installed." };
  setShared(UPDATE, status);
  return status;
}

// Looks for a newer version; changes nothing.
export const check = () => run(["--check"], 90000);
// Installs the newer version in the background: Herdr reloads the mods as their files change, this
// one too. Follow it with `watch`.
export const apply = () => run(["--detach"], 20000);

// What the updater last wrote down (after a restart, or an update that reloaded this mod).
export async function load() {
  try {
    const status = JSON.parse(await readTextFile(statusFile()) ?? "null");
    if (status) setShared(UPDATE, status);
    return status;
  } catch { return null; }
}

// While an update runs: the status file every 700ms until it says it's done (or 5 minutes pass).
export async function watch(cx, onChange) {
  const end = Date.now() + 5 * 60 * 1000;
  while (Date.now() < end) {
    await cx.sleep(700);
    const status = await load();
    onChange?.(status);
    if (status && status.state !== "updating") return status;
  }
  const status = { ...(shared(UPDATE) ?? {}), state: "error", message: "The update hasn't finished after 5 minutes. data/mainframe-update/update.log says why." };
  setShared(UPDATE, status);
  return status;
}

// An update that says it's running but started over 5 minutes ago has stopped.
export const running = (s) => s?.state === "updating" && Date.now() - (s.started ?? 0) < 5 * 60 * 1000;

// "3 minutes ago", for the last check.
export function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const [n, unit] = s < 3600 ? [Math.round(s / 60), "minute"] : s < 86400 ? [Math.round(s / 3600), "hour"] : [Math.round(s / 86400), "day"];
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

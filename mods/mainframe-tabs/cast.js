// The cast: which character plays which agent. One library (roster.js, drawn by build.py into
// chars/), handed out in order: each new agent takes the next one nobody has.
// Who plays whom is shared ("mainframe.cast") so the sidebar, the tab bar and the Grid agree.
// This file and roster.js are copied as they are into mainframe-side and mainframe-tabs
// (mods can't import from each other): build.py copies them, so edit them here and run it.
//
// An agent is known two ways:
//  - by its tab's name, when someone named the tab and it is the tab's only agent ("n:server:atlas"):
//    that survives restarts, so a named agent keeps its face;
//  - by its pane ("p:<pane id>"): for agents nobody named, and so a renamed tab keeps its character.
import { shared, setShared } from "herdr";
import { ROSTER } from "./roster.js";

export { ROSTER };
export const DIR = "mods/mainframe-grid/chars";
export const KEY = "mainframe.cast";
export const byId = Object.fromEntries(ROSTER.map((c) => [c.id, c]));
export const face = (c) => `${DIR}/${c.id}-face.svg`;
export const body = (c) => `${DIR}/${c.id}.svg`;
// Pane keys of agents long gone are dropped past this many (names are kept).
const KEEP = 240;

const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : "");
function read() {
  const s = shared(KEY);
  return s && typeof s === "object" && s.map && typeof s.map === "object" ? s : { map: {}, next: 0 };
}

// Built once a render from agents() and spaces(): `of(agent)` is its character. New agents are
// given one here (and the choice is saved), so every mod that asks gets the same answer.
export function casting(all, spaceList) {
  const tabs = new Map(), lone = {};
  for (const s of spaceList ?? []) for (const t of s.tabs ?? []) tabs.set(t.id, t);
  for (const a of all ?? []) lone[a.tab] = (lone[a.tab] ?? 0) + 1;
  const keys = (a) => {
    const tab = tabs.get(a.tab);
    const name = tab?.named && lone[a.tab] === 1 ? `n:${machineOf(a.address)}:${String(tab.name).trim().toLowerCase()}` : null;
    return { name, pane: `p:${a.pane ?? a.address}` };
  };
  const state = read();
  let map = state.map, next = state.next ?? 0, changed = false;
  const put = (k, id) => { if (map[k] === id) return; if (!changed) { map = { ...map }; changed = true; } map[k] = id; };
  const found = (a) => { const k = keys(a); const id = (k.name && map[k.name]) || map[k.pane]; return byId[id] ? id : null; };
  for (const a of all ?? []) {
    const k = keys(a);
    let id = found(a);
    if (!id) {
      // The next one in the library that no live agent has and no named agent owns; then one no
      // live agent has; then (more agents than characters) simply the next.
      const live = new Set((all ?? []).map(found).filter(Boolean));
      const owned = new Set(Object.entries(map).filter(([key]) => key.startsWith("n:")).map(([, v]) => v));
      const order = ROSTER.map((_c, i) => ROSTER[(next + i) % ROSTER.length]);
      const pick = order.find((c) => !live.has(c.id) && !owned.has(c.id)) ?? order.find((c) => !live.has(c.id)) ?? order[0];
      id = pick.id;
      next = (ROSTER.indexOf(pick) + 1) % ROSTER.length;
      changed = true; map = { ...map };
    }
    if (k.name) put(k.name, id);
    put(k.pane, id);
  }
  if (changed) {
    const livePanes = new Set((all ?? []).map((a) => keys(a).pane));
    const gone = Object.keys(map).filter((k) => k.startsWith("p:") && !livePanes.has(k));
    for (const k of gone.slice(0, Math.max(0, gone.length - KEEP))) delete map[k];
    setShared(KEY, { map, next });
  }
  const final = map;
  return {
    of: (a) => { const k = keys(a); return byId[(k.name && final[k.name]) || final[k.pane]] ?? ROSTER[0]; },
    keys,
  };
}

// A character picked by hand for this agent (the Grid's picker).
export function recast(a, id, all, spaceList) {
  if (!byId[id]) return;
  const k = casting(all, spaceList).keys(a);
  const s = read(), map = { ...s.map, [k.pane]: id };
  if (k.name) map[k.name] = id;
  setShared(KEY, { map, next: s.next ?? 0 });
}

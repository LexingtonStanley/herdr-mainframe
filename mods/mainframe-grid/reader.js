import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, shared } from "herdr";

// Read just the tail on the owning machine. Partial JSONL records can wait until the next read.
function messages(text) {
  const out = [];
  for (const line of text.split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const m = e?.type === "response_item" ? e.payload : e?.message;
    if (!m) continue;
    if (m.type === "function_call") out.push(["TOOL", m.name]);
    if (m.role !== "user" && m.role !== "assistant") continue;
    const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
    for (const p of parts) {
      if (p?.type === "tool_use") out.push(["TOOL", p.name]);
      else if (typeof p?.text === "string" && ["text", "input_text", "output_text"].includes(p.type))
        out.push([m.role.toUpperCase(), p.text.slice(0, 2000)]);
    }
  }
  return out.slice(-30).reverse();
}

export class Reader {
  refresh(view, cx) {
    if (!view || this.busy) return;
    const latest = (shared("mainframe.info") ?? {})[view.owner]?.inner?.find(x => x.id === view.id);
    const file = latest?.file || view.file;
    if (!file) return;
    this.busy = true;
    cx.spawn(async cx => {
      try {
        const r = await exec("tail", ["-c", "131072", file], { on: view.on, timeout: 6000 });
        this.rows = r.code === 0 ? messages(r.stdout) : [];
        this.note = r.code === 0 ? "Waiting for readable transcript entries…" : "Transcript unavailable on the parent’s computer.";
      } catch {
        this.rows = []; this.note = "Could not reach the parent’s computer.";
      } finally {
        this.key = view.key; this.busy = false; cx.notify();
      }
    });
  }
  render(view, t) {
    if (!view) return div();
    const rows = this.key === view.key ? this.rows ?? [] : [];
    return v_flex().id(`reader-${view.key}`).size_full().min_h(0).p(16).gap(10).overflow_y_scrollbar().bg(t.background)
      .child(div().text_size(11).font_bold().text_color(t.accent).child("SUB-AGENT   /   TASK"))
      .child(div().text_size(16).font_bold().text_color(t.foreground).child(view.title))
      .child(div().text_size(12).text_color(t.muted).child([view.detail, `Parent: ${view.parentName || view.owner}`].filter(Boolean).join("   ·   ")))
      .child(div().text_size(11).font_bold().text_color(t.accent).child("RECENT TRANSCRIPT   /   NEWEST FIRST"))
      .when(!rows.length, el => el.child(div().text_size(12).text_color(t.muted).child(this.key === view.key ? this.note : view.file ? "Reading…" : "No transcript path has been reported.")))
      .children(rows.map(([role, text]) => v_flex().flex_none().gap(3).p(9).rounded(6).bg(t.surface)
        .child(div().text_size(10).text_color(t.dim).child(role))
        .child(div().text_size(12).text_color(t.foreground).child(text))));
  }
}

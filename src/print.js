import { kindInfo } from "./catalog.js";
import { escapeHTML } from "./renderer.js";
import { markerSymbol } from "./symbols.js";
import { PLAN_STATUS, STAFF_KINDS } from "./operations.js";
export class PrintView {
  constructor(map, editor, project) {
    this.map = map;
    this.editor = editor;
    this.project = project;
    this.active = false;
    this.paper = "A4 landscape";
    document.getElementById("paper").addEventListener("change", (e) => {
      this.paper = e.target.value;
      this.layout();
    });
    document.getElementById("legend-toggle").addEventListener("change", (e) => {
      document.getElementById("print-legend").hidden = !e.target.checked;
      this.layout();
    });
    window.addEventListener("beforeprint", () => {
      if (document.body.classList.contains("report-mode")) return;
      if (!this.active) this.enter();
      this.map.resize();
      this.editor.request();
    });
  }
  enter() {
    this.editor.cancel();
    this.editor.selection.clear();
    this.active = true;
    const p = this.project();
    document.getElementById("print-title").textContent = p.title;
    const plan = p.meta.plan;
    document.getElementById("print-note").textContent = [
      plan.venue,
      [plan.startDate, plan.endDate].filter(Boolean).join(" ~ "),
      plan.organizer,
      plan.agency,
      plan.manager && `총괄 ${plan.manager} ${plan.phone}`,
      p.meta.note,
    ]
      .filter(Boolean)
      .join(" · ");
    document.getElementById("print-date").textContent =
      `${plan.documentNo ? plan.documentNo + " · " : ""}개정 ${plan.revision} · ${PLAN_STATUS[plan.status]} · ${new Date().toLocaleDateString("ko-KR")}`;
    const kinds = new Map();
    for (const o of p.objects)
      if (o.visible && p.settings.layers[o.type]) {
        const key = `${o.type}:${o.kind}:${o.style.color}`;
        if (!kinds.has(key))
          kinds.set(key, {
            label: kindInfo(o)[0],
            color: o.style.color,
            count: 0,
            type: o.type,
            kind: o.kind,
          });
        kinds.get(key).count += o.type === "marker" ? o.operations.quantity : 1;
      }
    document.getElementById("print-legend").innerHTML = [...kinds.values()]
      .map(
        (k) =>
          `<span>${k.type === "marker" ? markerSymbol(k.kind, 22) : `<i style="background:${k.color}"></i>`}${escapeHTML(k.label)} <b>${k.count}${k.type === "marker" && STAFF_KINDS.has(k.kind) ? "명" : ""}</b></span>`,
      )
      .join("");
    document.getElementById("print-controls").hidden = false;
    document.body.classList.add("print-preview");
    this.layout();
  }
  layout() {
    const [paper, direction] = this.paper.split(" "),
      dimensions = paper === "A3" ? [297, 420] : [210, 297],
      land = direction === "landscape",
      w = dimensions[land ? 1 : 0] - 16,
      h = dimensions[land ? 0 : 1] - 16;
    const scale = Math.min(1, (innerWidth - 24) / ((w * 96) / 25.4));
    document.documentElement.style.setProperty("--preview-scale", scale);
    document.documentElement.style.setProperty(
      "--preview-height",
      `${((h * 96) / 25.4) * scale}px`,
    );
    document.documentElement.style.setProperty(
      "--preview-left",
      `${Math.max(12, (innerWidth - ((w * 96) / 25.4) * scale) / 2)}px`,
    );
    document.documentElement.style.setProperty("--paper-width", `${w}mm`);
    document.documentElement.style.setProperty("--paper-height", `${h}mm`);
    let style = document.getElementById("page-size");
    if (!style) {
      style = document.createElement("style");
      style.id = "page-size";
      document.head.append(style);
    }
    style.textContent = `@page { size: ${paper} ${direction}; margin: 8mm; }`;
    requestAnimationFrame(() => {
      this.map.resize();
      this.editor.request();
    });
  }
  async print() {
    if (!this.active) this.enter();
    this.map.resize();
    this.editor.request();
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    window.print();
  }
  exit() {
    this.active = false;
    document.body.classList.remove("print-preview");
    document.getElementById("print-controls").hidden = true;
    this.map.resize();
    this.editor.request();
  }
}

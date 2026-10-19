import { isDisplayed } from "./event-data.js";
import { localPoint } from "./venue.js";
import { kindInfo } from "./catalog.js";
import { markerArtwork } from "./symbols.js";
import { elementScale, labelScale } from "./scaling.js";
import { center, length, meters, samples, distance } from "./geometry.js";
export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const attr = (n, k, v) => {
  const s = String(v);
  if (n.getAttribute(k) !== s) n.setAttribute(k, s);
};
const linePath = (pts) =>
  pts
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
export class Renderer {
  constructor(svg, adapter) {
    this.svg = svg;
    this.map = adapter;
    this.entries = new Map();
    svg.innerHTML =
      '<defs><pattern id="safety-tape" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="16" fill="#f7d449"/><rect width="7" height="16" fill="#182533"/></pattern><pattern id="barrier" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="20" height="20" fill="white"/><rect width="10" height="20" fill="#dd4954"/></pattern></defs>';
    this.shapes = el("g", { class: "objects" });
    this.handles = el("g", { class: "handles" });
    this.draft = el("g", { class: "draft", "pointer-events": "none" });
    this.background = el("image", {
      "pointer-events": "none",
      preserveAspectRatio: "none",
    });
    svg.append(this.background, this.shapes, this.draft, this.handles);
  }
  create(o) {
    const group = el("g", {
      "data-object": o.id,
      class: `map-object ${o.type}`,
      role: "button",
      tabindex: "-1",
    });
    const shape = el(o.type === "marker" ? "g" : "path", {
        class: "object-shape",
      }),
      hit = el(o.type === "marker" ? "circle" : "path", {
        class: "object-hit",
        fill: "none",
        stroke: "transparent",
        "stroke-width": 24,
      });
    if (o.type === "marker") {
      hit.setAttribute("r", 24);
      hit.setAttribute("fill", "transparent");
      hit.removeAttribute("stroke");
    }
    const decorations = el("g", { "pointer-events": "none" }),
      label = el("g", { "data-handle": "label", class: "object-label" }),
      leader = el("path", {
        class: "label-leader",
        stroke: "#697b88",
        "stroke-width": 1,
        "stroke-dasharray": "3 3",
        fill: "none",
        "pointer-events": "none",
      });
    label.append(
      el("rect", { rx: 6, height: 26, y: -13 }),
      el("text", { "text-anchor": "middle", "dominant-baseline": "central" }),
    );
    group.append(shape, decorations, hit, leader, label);
    this.shapes.append(group);
    const entry = {
      group,
      shape,
      hit,
      decorations,
      label,
      leader,
      labelTouch: el("rect", { fill: "transparent", class: "label-touch" }),
      labelTitle: el("title"),
      signature: "",
      decoKey: "",
    };
    label.append(entry.labelTouch, entry.labelTitle);
    this.entries.set(o.id, entry);
    return entry;
  }
  draw(
    project,
    selection = new Set(),
    editing = false,
    draft = null,
    vertex = -1,
    previewIds = new Set(),
  ) {
    // Slider previews never enter the project, persistence journal or undo history.
    const preview = this.markerSizePreview;
    if (preview)
      project =
        preview.scope === "all"
          ? {
              ...project,
              settings: { ...project.settings, markerSize: preview.value },
            }
          : {
              ...project,
              objects: project.objects.map((o) =>
                preview.ids.has(o.id)
                  ? { ...o, style: { ...o.style, markerSize: preview.value } }
                  : o,
              ),
            };
    const { width, height } = this.map.size;
    attr(this.svg, "viewBox", `0 0 ${width} ${height}`);
    const patternScale = elementScale(
      project,
      { type: "line", style: { scale: 1 } },
      this.map.view.zoom,
      this.map.size,
    );
    for (const pattern of this.svg.querySelectorAll("defs pattern"))
      attr(pattern, "patternTransform", `rotate(45) scale(${patternScale})`);
    const bg = project.meta.event?.background;
    attr(this.background, "display", bg?.enabled ? "inline" : "none");
    if (bg?.enabled) {
      const a = this.map.project(
          localPoint(bg.center, -bg.width / 2, -bg.height / 2, bg.rotation),
        ),
        b = this.map.project(
          localPoint(bg.center, bg.width / 2, -bg.height / 2, bg.rotation),
        ),
        c = this.map.project(
          localPoint(bg.center, -bg.width / 2, bg.height / 2, bg.rotation),
        );
      attr(this.background, "href", bg.data);
      attr(this.background, "width", 1);
      attr(this.background, "height", 1);
      attr(this.background, "opacity", bg.opacity);
      attr(
        this.background,
        "transform",
        `matrix(${b.x - a.x} ${b.y - a.y} ${c.x - a.x} ${c.y - a.y} ${a.x} ${a.y})`,
      );
    }
    const keep = new Set(),
      buckets = new Map(),
      mapKey = `${this.map.view.center.lat}:${this.map.view.center.lng}:${this.map.view.zoom}:${width}:${height}`;
    for (const o of project.objects) {
      keep.add(o.id);
      const e = this.entries.get(o.id) || this.create(o),
        selected = selection.has(o.id),
        previewing = previewIds.has(o.id),
        visible = previewing || isDisplayed(project, o);
      attr(e.group, "display", visible ? "inline" : "none");
      if (!visible) continue;
      attr(
        e.group,
        "class",
        `map-object ${o.type}${selected ? " selected" : ""}${o.locked ? " locked" : ""}${previewing ? " paste-preview" : ""}`,
      );
      attr(e.group, "tabindex", previewing ? "-1" : "0");
      attr(e.group, "aria-hidden", previewing ? "true" : "false");
      attr(e.group, "aria-label", `${o.name} (${kindInfo(o)[0]})`);
      const pts = (o.path || [o.position]).map((p) => this.map.project(p)),
        scale = elementScale(project, o, this.map.view.zoom, this.map.size),
        textScale = labelScale(project, o, this.map.view.zoom, this.map.size);
      attr(e.group, "data-render-scale", scale);
      if (o.type === "marker") {
        attr(
          e.shape,
          "transform",
          `translate(${pts[0].x},${pts[0].y}) rotate(${o.rotation}) scale(${scale})`,
        );
        attr(e.hit, "cx", pts[0].x);
        attr(e.hit, "cy", pts[0].y);
        attr(e.hit, "r", Math.max(24, 23 * scale));
        const signature = `${o.kind}:${o.style.color}:${o.locked}`;
        if (o.kind === "note") {
          const a = o.annotation,
            lines = [];
          let line = "",
            used = 0;
          for (const ch of (a?.text || o.name).slice(0, 1000)) {
            const cw = /[\u1100-\uffff]/.test(ch)
              ? a.fontSize
              : a.fontSize * 0.58;
            if (ch === "\n" || used + cw > a.width - 20) {
              lines.push(line);
              line = "";
              used = 0;
            }
            if (ch !== "\n") {
              line += ch;
              used += cw;
            }
          }
          lines.push(line);
          const h = lines.length * a.fontSize * 1.4 + 20,
            sig = JSON.stringify([a, o.locked]);
          if (e.signature !== sig) {
            e.shape.innerHTML = `<rect x="${-a.width / 2}" y="${-h / 2}" width="${a.width}" height="${h}" rx="5" fill="${a.background}" stroke="${a.border ? o.style.color : "none"}"/><text fill="${a.textColor}" font-family="sans-serif" font-size="${a.fontSize}" text-anchor="${a.align}">${lines.map((l, i) => `<tspan x="${a.align === "start" ? -a.width / 2 + 10 : a.align === "end" ? a.width / 2 - 10 : 0}" y="${-h / 2 + 15 + a.fontSize + i * a.fontSize * 1.4}">${escapeHTML(l)}</tspan>`).join("")}</text>`;
            e.signature = sig;
          }
          attr(e.hit, "r", Math.max(24, Math.min(a.width / 2, h / 2) * scale));
        } else if (e.signature !== signature) {
          e.shape.innerHTML = `<circle class="marker-halo" r="25" fill="white" stroke="${o.style.color}" stroke-width="2.2"/><g transform="translate(-20,-20)">${markerArtwork(o.kind)}</g>${o.locked ? '<g data-locked-indicator="true" transform="translate(18,18)" pointer-events="none"><circle r="8" fill="#23423d" stroke="white" stroke-width="1.5"/><path d="M-3-1v-2a3 3 0 016 0v2m-7 0h8v6h-8z" fill="none" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></g>' : ""}`;
          e.signature = signature;
        }
      } else {
        const d = linePath(pts) + (o.type === "area" ? " Z" : "");
        attr(e.shape, "d", d);
        attr(e.hit, "d", d);
        attr(e.shape, "fill", o.type === "area" ? o.style.color : "none");
        attr(e.shape, "fill-opacity", o.style.opacity);
        attr(
          e.shape,
          "stroke-opacity",
          o.type === "line" ? o.style.opacity : 1,
        );
        attr(e.decorations, "opacity", o.style.opacity);
        attr(
          e.shape,
          "stroke",
          o.kind === "tape"
            ? "url(#safety-tape)"
            : o.kind === "block"
              ? "url(#barrier)"
              : o.style.color,
        );
        attr(
          e.shape,
          "stroke-width",
          o.style.width * scale + (selected ? 2 : 0),
        );
        attr(e.hit, "stroke-width", Math.max(24, o.style.width * scale + 12));
        attr(e.shape, "stroke-linejoin", "round");
        attr(e.shape, "stroke-linecap", "round");
        attr(
          e.shape,
          "stroke-dasharray",
          o.kind === "oneway"
            ? `${12 * scale} ${7 * scale}`
            : o.kind === "measure"
              ? `${5 * scale} ${5 * scale}`
              : "none",
        );
        if (o.type === "area") {
          attr(e.hit, "fill", "transparent");
          attr(e.hit, "stroke", "transparent");
        }
        const decoKey =
          mapKey + scale + JSON.stringify([o.path, o.style, o.kind]);
        if (o.type === "line" && e.decoKey !== decoKey) {
          const mpp = distance(
            this.map.unproject({ x: 0, y: 0 }),
            this.map.unproject({ x: 1, y: 0 }),
          );
          const spacing = Math.max(
            o.style.spacing,
            mpp * (o.kind === "cone" ? 18 : 48) * scale,
          );
          const ss = [
            "cone",
            "oneway",
            "vehicle",
            "pedestrian",
            "block",
            "emergency",
            "accessible",
          ].includes(o.kind)
            ? samples(o.path, spacing, 100)
            : [];
          const end = o.path.at(-1),
            previous = o.path.at(-2);
          if (
            [
              "oneway",
              "vehicle",
              "pedestrian",
              "emergency",
              "accessible",
            ].includes(o.kind) &&
            distance(end, previous) > 0.05
          )
            ss.push({ point: end, from: previous, to: end });
          e.decorations.innerHTML = ss
            .map((s) => {
              const p = this.map.project(s.point),
                a = this.map.project(s.from),
                b = this.map.project(s.to),
                angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              if (o.kind === "cone")
                return `<g transform="translate(${p.x},${p.y}) scale(${scale})"><path d="M0-9L7 8H-7Z" fill="${o.style.color}" stroke="white" stroke-width="1.5"/><path d="M-3 0h6M-8 9H8" stroke="white" stroke-width="2"/></g>`;
              if (o.kind === "block")
                return `<g transform="translate(${p.x},${p.y}) scale(${scale})"><circle r="9" fill="${o.style.color}" stroke="white" stroke-width="2"/><path d="M-5 0H5" stroke="white" stroke-width="3"/></g>`;
              return `<g transform="translate(${p.x},${p.y}) rotate(${angle}) scale(${scale})"><path d="M-10-6L0 0-10 6" fill="none" stroke="white" stroke-width="7" stroke-linejoin="round"/><path d="M-10-6L0 0-10 6" fill="none" stroke="${o.style.color}" stroke-width="3" stroke-linejoin="round"/></g>`;
            })
            .join("");
          e.decoKey = decoKey;
        }
      }
      const anchor = this.map.project(
        o.label.position || o.position || center(o.path),
      );
      let x = anchor.x + o.label.dx * textScale,
        y = anchor.y + o.label.dy * textScale;
      if (!o.facility && !o.label.manual && !o.label.position) {
        if (o.type === "marker")
          y = Math.max(y, anchor.y + 26 * scale + 13 * textScale + 6);
        const key = `${Math.round(x / (130 * textScale))}:${Math.round(y / (32 * textScale))}`,
          count = buckets.get(key) || 0;
        buckets.set(key, count + 1);
        y += count * 30 * textScale;
      }
      const show =
        o.kind !== "note" &&
        (!o.facility ||
          selected ||
          Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) > 10) &&
        project.settings.labels &&
        o.label.visible &&
        (selected ||
          (x > -250 && y > -150 && x < width + 250 && y < height + 150));
      attr(e.label, "display", show ? "inline" : "none");
      if (show) {
        const labelText =
          o.kind === "measure"
            ? `${o.label.text} · ${meters(length(o.path))}`
            : o.details?.number && o.label.text !== o.details.number
              ? `${o.details.number} · ${o.label.text}`
              : o.label.text;
        const limit =
          project.settings.autoSize !== false
            ? Math.max(90, Math.min(180, width * 0.42)) / textScale - 20
            : Infinity;
        let shown = "",
          used = 0;
        for (const c of labelText.slice(0, 80)) {
          const cw = /[\u1100-\uffff]/.test(c) ? 12 : 7;
          if (used + cw + 12 > limit) {
            shown += "…";
            break;
          }
          shown += c;
          used += cw;
        }
        if (e.labelTitle.textContent !== labelText)
          e.labelTitle.textContent = labelText;
        if (e.label.children[1].textContent !== shown)
          e.label.children[1].textContent = shown;
        const w = Math.max(
          o.facility ? 24 : 44,
          Array.from(shown).reduce(
            (s, c) => s + (/[\u1100-\uffff]/.test(c) ? 12 : 7),
            0,
          ) + (o.facility ? 8 : 18),
        );
        attr(e.label.firstChild, "width", w);
        attr(e.label.firstChild, "x", -w / 2);
        attr(e.label, "transform", `translate(${x},${y}) scale(${textScale})`);
        const tw = Math.max(w, 44 / textScale),
          th = Math.max(26, 44 / textScale);
        attr(e.labelTouch, "x", -tw / 2);
        attr(e.labelTouch, "y", -th / 2);
        attr(e.labelTouch, "width", tw);
        attr(e.labelTouch, "height", th);
        attr(
          e.labelTouch,
          "pointer-events",
          (selected && editing) || o.type === "marker" ? "all" : "none",
        );
        if (o.type === "marker" && selected) {
          attr(e.label, "role", "button");
          attr(e.label, "aria-label", `이름 수정: ${o.label.text || o.name}`);
          attr(e.label, "tabindex", "0");
        } else if (e.label.hasAttribute("role")) {
          e.label.removeAttribute("role");
          e.label.removeAttribute("aria-label");
          e.label.removeAttribute("tabindex");
        }
      }
      const objectAnchor = this.map.project(o.position || center(o.path));
      attr(
        e.leader,
        "d",
        show && Math.hypot(x - objectAnchor.x, y - objectAnchor.y) > 45
          ? `M${objectAnchor.x},${objectAnchor.y}L${x},${y}`
          : "",
      );
    }
    for (const [id, e] of this.entries)
      if (!keep.has(id)) {
        e.group.remove();
        this.entries.delete(id);
      }
    // Only reorder after object ordering actually changes.
    const order = project.objects.map((o) => o.id).join("|");
    if (this.order !== order) {
      let next = this.shapes.firstElementChild;
      for (const o of project.objects) {
        const node = this.entries.get(o.id).group;
        if (node === next) next = next.nextElementSibling;
        else this.shapes.insertBefore(node, next);
      }
      this.order = order;
    }
    const edit =
      editing && selection.size === 1
        ? project.objects.find(
            (o) =>
              selection.has(o.id) &&
              !o.locked &&
              o.visible &&
              project.settings.layers[o.type],
          )
        : null;
    let handles = "";
    if (edit?.type === "marker") {
      const q = this.map.project(edit.position);
      handles = `<g data-object="${edit.id}" data-handle="move" transform="translate(${q.x},${q.y})" class="marker-move"><circle r="24" fill="transparent"/><circle r="9" fill="white" stroke="#16615a" stroke-width="2.5"/><path d="M-5 0H5M0-5V5" stroke="#16615a" stroke-width="2" pointer-events="none"/></g>`;
    }
    if (edit?.path) {
      edit.path.forEach((p, i) => {
        const q = this.map.project(p);
        handles += `<g data-object="${edit.id}" data-handle="vertex" data-index="${i}" transform="translate(${q.x},${q.y})" class="vertex"><circle r="22" fill="transparent"/><circle r="${i === vertex ? 9 : 7}" fill="${i === vertex ? "#ed8635" : "white"}" stroke="#16615a" stroke-width="3"/><text y="-13" text-anchor="middle">${i + 1}</text></g>`;
        if (i < edit.path.length - 1 || edit.type === "area") {
          const r = this.map.project(edit.path[(i + 1) % edit.path.length]);
          handles += `<g data-object="${edit.id}" data-handle="midpoint" data-index="${i}" transform="translate(${(q.x + r.x) / 2},${(q.y + r.y) / 2})" class="midpoint"><circle r="20" fill="transparent"/><circle r="8" fill="#16615a" stroke="white" stroke-width="2"/><path d="M-3 0h6M0-3v6" stroke="white" stroke-width="1.5"/></g>`;
        }
      });
    }
    this.handles.innerHTML = handles;
    if (draft?.points.length) {
      const pts = draft.points.map((p) => this.map.project(p)),
        all = draft.hover ? [...pts, this.map.project(draft.hover)] : pts;
      this.draft.innerHTML = `<path d="${linePath(all)}${draft.type === "area" && pts.length > 2 ? " Z" : ""}" fill="${draft.type === "area" ? "#209477" : "none"}" fill-opacity=".13" stroke="#167560" stroke-width="3" stroke-dasharray="8 5"/>${pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${i ? "white" : "#167560"}" stroke="#167560" stroke-width="2"/>`).join("")}`;
    } else this.draft.replaceChildren();
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.entries.clear();
    this.svg.replaceChildren();
  }
}

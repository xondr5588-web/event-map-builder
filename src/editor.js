import { clone, newObject } from "./model.js";
import { kindInfo } from "./catalog.js";
import { labelScale } from "./scaling.js";
import { positionCopies } from "./clipboard.js";
import {
  area,
  length,
  meters,
  squareMeters,
  pointsOf,
  center,
  validCoord,
} from "./geometry.js";
export class Editor {
  constructor(svg, map, renderer, callbacks) {
    this.svg = svg;
    this.map = map;
    this.renderer = renderer;
    this.cb = callbacks;
    this.mode = "select";
    this.selection = new Set();
    this.points = [];
    this.editing = false;
    this.pointers = new Map();
    this.vertex = -1;
    this.tool = null;
    this.placement = null;
    this.frame = 0;
    svg.addEventListener("pointerdown", (e) => this.down(e));
    svg.addEventListener("pointermove", (e) => this.move(e));
    svg.addEventListener("pointerup", (e) => this.up(e));
    svg.addEventListener("pointercancel", () => this.cancelGesture());
    svg.addEventListener("lostpointercapture", () => {
      if (this.drag && !this.pointers.size) this.cancelGesture();
    });
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    svg.addEventListener("keydown", (e) => {
      const label = e.target.closest?.(".map-object.marker .object-label");
      if (
        label &&
        !this.editing &&
        !this.tool &&
        !this.placement &&
        this.mode === "select" &&
        ["Enter", " "].includes(e.key)
      ) {
        e.preventDefault();
        e.stopPropagation();
        const id = label.closest("[data-object]").dataset.object;
        this.select(id);
        this.cb.rename?.(id);
      }
    });
    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.drag) return;
        this.map.zoom(e.deltaY < 0 ? 1 : -1, this.xy(e));
        this.cb.viewChanged();
      },
      { passive: false },
    );
  }
  get project() {
    return this.preview || this.cb.project();
  }
  request() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const copies = this.placement
        ? positionCopies(
            this.placement,
            this.map,
            this.hover || this.map.view.center,
          )
        : [];
      this.renderer.draw(
        copies.length
          ? { ...this.project, objects: [...this.project.objects, ...copies] }
          : this.project,
        this.selection,
        this.editing,
        this.tool
          ? { ...this.tool, points: this.points, hover: this.hover }
          : null,
        this.vertex,
        new Set(copies.map((o) => o.id)),
      );
      this.cb.rendered?.();
    });
  }
  xy(e) {
    const r = this.svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.svg.clientWidth) / r.width,
      y: ((e.clientY - r.top) * this.svg.clientHeight) / r.height,
    };
  }
  setMode(mode, tool = null) {
    this.cancelGesture();
    this.mode = mode;
    this.tool = tool;
    this.placement = null;
    this.points = [];
    this.hover = null;
    this.editing = false;
    this.vertex = -1;
    this.io = null;
    this.cb.modeChanged();
    this.request();
  }
  select(id, multi = false) {
    if (!multi) this.selection.clear();
    if (id) {
      if (multi && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.editing = false;
    this.vertex = -1;
    this.mode = "select";
    this.tool = null;
    this.placement = null;
    this.points = [];
    this.cb.selectionChanged();
    this.request();
  }
  startPlacement(objects) {
    this.setMode("paste");
    this.placement = objects;
    this.selection.clear();
    this.cb.selectionChanged();
    this.cb.modeChanged();
    this.request();
  }
  startEdit() {
    const o = this.project.objects.find((o) => this.selection.has(o.id));
    if (this.selection.size !== 1 || !o || o.locked) return;
    this.editing = true;
    this.vertex = -1;
    this.cb.modeChanged();
    this.request();
  }
  snap(p, skip) {
    if (!this.project.settings.snap) return p;
    const q = this.map.project(p);
    let best = p,
      dist = 14;
    for (const o of this.project.objects) {
      if (o.id === skip || !o.visible || !this.project.settings.layers[o.type])
        continue;
      for (const v of pointsOf(o)) {
        const r = this.map.project(v),
          d = Math.hypot(q.x - r.x, q.y - r.y);
        if (d < dist) {
          dist = d;
          best = v;
        }
      }
    }
    return clone(best);
  }
  down(e) {
    if (e.button && e.button !== 0) return;
    if (this.cb.beforePointer?.() === false) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    this.svg.focus({ preventScroll: true });
    const p = this.xy(e);
    this.pointers.set(e.pointerId, p);
    this.svg.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      clearTimeout(this.longTimer);
      this.preview = null;
      this.drag = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.map.view.zoom,
        lastMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      this.gestureMulti = true;
      this.request();
      return;
    }
    if (this.pointers.size > 2) return;
    this.gestureMulti = false;
    const target = e.target.closest("[data-object]"),
      id = target?.dataset.object,
      handle = e.target.closest("[data-handle]")?.dataset.handle,
      index = Number(e.target.closest("[data-index]")?.dataset.index);
    const o = this.project.objects.find((o) => o.id === id);
    const quickMarker =
      o?.type === "marker" &&
      !this.tool &&
      !this.placement &&
      !this.editing &&
      this.mode === "select" &&
      !e.shiftKey &&
      !this.cb.multi();
    if (quickMarker && !this.selection.has(id)) this.select(id);
    if (quickMarker) this.request();
    const groupMove =
      o &&
      this.selection.has(id) &&
      !this.tool &&
      !this.placement &&
      !this.editing &&
      this.mode === "select" &&
      !e.shiftKey &&
      !this.cb.multi() &&
      handle !== "label" &&
      !o.locked;
    const directMove =
      (quickMarker || groupMove) && !o.locked && handle !== "label";
    const editable =
      (this.editing && this.selection.has(id) && !o?.locked) || directMove;
    const label =
        editable && handle === "label"
          ? target?.querySelector(".object-label")
          : null,
      transform = label?.transform.baseVal.numberOfItems
        ? label.transform.baseVal.getItem(0).matrix
        : null,
      labelAnchor =
        transform && o
          ? this.map.project(o.label.position || o.position || center(o.path))
          : null;
    this.drag = {
      start: p,
      last: p,
      id,
      handle,
      index,
      moved: false,
      editable,
      quickMarker,
      directMove,
      groupMove,
      shift: e.shiftKey,
      before: editable && !directMove ? clone(this.project) : null,
      startCoord: this.map.unproject(p),
      original: editable ? clone(o) : null,
      labelOffset: labelAnchor
        ? {
            x: transform.e - labelAnchor.x,
            y: transform.f - labelAnchor.y,
          }
        : null,
    };
    if (editable && !directMove) this.preview = clone(this.cb.project());
    if (e.pointerType !== "mouse" && id && !this.tool && !this.placement) {
      this.longTimer = setTimeout(() => {
        if (this.drag && !this.drag.moved) {
          this.select(id);
          this.startEdit();
          this.cb.haptic();
          this.drag = null;
        }
      }, 550);
    }
  }
  move(e) {
    const p = this.xy(e);
    if (!this.pointers.has(e.pointerId)) {
      if (this.tool || this.placement) {
        this.hover = this.map.unproject(p);
        this.request();
      }
      return;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size >= 2 && this.pinch) {
      if (this.placement) this.hover = null;
      const [a, b] = [...this.pointers.values()],
        d = Math.hypot(a.x - b.x, a.y - b.y),
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const target =
        this.pinch.zoom +
        Math.round(Math.log2(d / Math.max(1, this.pinch.distance)));
      if (target !== this.map.view.zoom)
        this.map.zoom(target - this.map.view.zoom, mid);
      this.map.panPixels(
        mid.x - this.pinch.lastMid.x,
        mid.y - this.pinch.lastMid.y,
      );
      this.pinch.lastMid = mid;
      this.request();
      return;
    }
    const d = this.drag;
    if (!d || this.gestureMulti) return;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 5) {
      d.moved = true;
      clearTimeout(this.longTimer);
    }
    if (!d.moved) return;
    if (d.editable) {
      // A tap only selects. Allocate a preview and history snapshot when a drag starts.
      if (!this.preview) {
        d.before = clone(this.cb.project());
        this.preview = clone(this.cb.project());
      }
      const o = this.project.objects.find((o) => o.id === d.id);
      if (!o) return;
      if (d.handle === "label") {
        const scale = labelScale(
          this.project,
          o,
          this.map.view.zoom,
          this.map.size,
        );
        o.label.dx =
          ((d.labelOffset?.x ?? d.original.label.dx * scale) +
            p.x -
            d.start.x) /
          scale;
        o.label.dy =
          ((d.labelOffset?.y ?? d.original.label.dy * scale) +
            p.y -
            d.start.y) /
          scale;
        o.label.manual = true;
      } else if (d.handle === "vertex") {
        const v = this.snap(this.map.unproject(p), o.id);
        if (validCoord(v)) {
          o.path[d.index] = v;
          if (o.facility) o.facility.mode = "free";
        }
        this.vertex = d.index;
      } else if (d.handle !== "midpoint") {
        const shift = (q) => {
          const v = this.map.project(q);
          return this.map.unproject({
            x: v.x + p.x - d.start.x,
            y: v.y + p.y - d.start.y,
          });
        };
        if (d.groupMove && this.selection.size > 1) {
          for (const original of d.before.objects.filter(
            (q) => this.selection.has(q.id) && !q.locked,
          )) {
            const item = this.project.objects.find((q) => q.id === original.id);
            if (item.position) item.position = shift(original.position);
            else item.path = original.path.map(shift);
            if (original.label.position)
              item.label.position = shift(original.label.position);
          }
        } else if (o.type === "marker")
          o.position = this.snap(shift(d.original.position), o.id);
        else o.path = d.original.path.map(shift);
        if (d.original.label.position)
          o.label.position = shift(d.original.label.position);
      }
      this.request();
    } else {
      if (this.placement) this.hover = null;
      this.map.panPixels(p.x - d.last.x, p.y - d.last.y);
    }
    d.last = p;
  }
  up(e) {
    clearTimeout(this.longTimer);
    this.pointers.delete(e.pointerId);
    if (this.gestureMulti) {
      if (!this.pointers.size) {
        this.pinch = null;
        this.gestureMulti = false;
        this.cb.viewChanged();
      }
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved) {
      if (d.editable && d.handle !== "midpoint") {
        this.preview.revision = this.cb.project().revision;
        this.cb.restore(this.preview);
        this.preview = null;
        this.cb.commit(d.before, "위치 편집");
      } else {
        this.preview = null;
        this.cb.viewChanged();
      }
      this.request();
      return;
    }
    if (d.editable && d.handle === "midpoint") {
      const o = this.project.objects.find((o) => o.id === d.id),
        a = o.path[d.index],
        b = o.path[(d.index + 1) % o.path.length];
      o.path.splice(d.index + 1, 0, {
        lat: (a.lat + b.lat) / 2,
        lng: (a.lng + b.lng) / 2,
      });
      this.vertex = d.index + 1;
      this.preview.revision = this.cb.project().revision;
      this.cb.restore(this.preview);
      this.preview = null;
      this.cb.commit(d.before, "점 추가");
      this.request();
      return;
    }
    this.preview = null;
    if (d.editable && d.handle === "vertex") {
      this.vertex = d.index;
      this.cb.modeChanged();
      this.request();
      return;
    }
    if (this.placement) {
      this.cb.place?.(this.map.unproject(d.start));
      return;
    }
    if (this.tool) {
      this.addPoint(this.map.unproject(d.start));
      return;
    }
    if (this.mode === "pan") return;
    if (d.quickMarker) {
      if (d.handle === "label") this.cb.rename?.(d.id);
      return;
    }
    if (d.id) {
      this.select(d.id, d.shift || this.cb.multi());
    } else if (!this.editing) this.select(null);
  }
  addPoint(p) {
    if (this.placement) {
      this.cb.place?.(p);
      return;
    }
    p = this.snap(p);
    if (this.io) {
      this.points.push(p);
      if (this.points.length === 2) {
        const before = clone(this.project);
        this.project.objects.push(
          newObject("marker", "gateIn", [this.points[0]], `${this.io} IN`),
          newObject("marker", "gateOut", [p], `${this.io} OUT`),
        );
        this.cb.commit(before, "주차장 IN/OUT 생성");
        this.setMode("select");
      } else this.cb.modeChanged();
      this.request();
      return;
    }
    if (!this.tool) return;
    if (this.tool.type === "marker") {
      const before = clone(this.project),
        kind = this.tool.kind,
        name =
          this.cb.toolName() ||
          `${kindInfo(this.tool)[0]} ${this.project.objects.filter((o) => o.kind === kind).length + 1}`,
        o = newObject("marker", kind, [p], name);
      this.project.objects.push(o);
      this.cb.commit(before, "마커 생성");
      this.selection = new Set([o.id]);
      this.cb.haptic();
      this.request();
      return;
    }
    const prev = this.points.at(-1);
    if (prev) {
      const a = this.map.project(prev),
        b = this.map.project(p);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 3) return;
    }
    this.points.push(p);
    this.hover = null;
    this.cb.haptic();
    this.cb.modeChanged();
    this.request();
  }
  finish() {
    if (this.placement) {
      this.cb.place?.(this.hover || this.map.view.center);
      return;
    }
    if (!this.tool) {
      this.editing = false;
      this.vertex = -1;
      this.cb.modeChanged();
      this.request();
      return;
    }
    if (this.tool.type === "marker") {
      this.setMode("select");
      this.cb.selectionChanged();
      return;
    }
    if (this.points.length < (this.tool.type === "area" ? 3 : 2)) {
      this.cb.toast("점을 더 추가해 주세요.");
      return;
    }
    if (
      (this.tool.type === "area" && area(this.points) < 0.1) ||
      (this.tool.type === "line" && length(this.points) < 0.1)
    ) {
      this.cb.toast("구역 또는 동선이 너무 작습니다.");
      return;
    }
    const before = clone(this.project),
      o = newObject(
        this.tool.type,
        this.tool.kind,
        this.points,
        this.cb.toolName() ||
          `${kindInfo(this.tool)[0]} ${this.project.objects.filter((x) => x.kind === this.tool.kind).length + 1}`,
      );
    this.project.objects.push(o);
    this.cb.commit(before, "객체 생성");
    this.setMode("select");
    this.select(o.id);
    this.cb.haptic();
  }
  removeVertex() {
    const o = this.project.objects.find((o) => this.selection.has(o.id));
    if (!o?.path || this.vertex < 0 || o.locked) return;
    if (o.path.length <= (o.type === "area" ? 3 : 2)) {
      this.cb.toast("최소 점 개수는 유지해야 합니다.");
      return;
    }
    const before = clone(this.project);
    o.path.splice(this.vertex, 1);
    this.vertex = -1;
    this.cb.commit(before, "점 삭제");
    this.cb.modeChanged();
    this.request();
  }
  cancelGesture() {
    clearTimeout(this.longTimer);
    this.preview = null;
    this.drag = null;
    this.pinch = null;
    this.pointers.clear();
    this.gestureMulti = false;
    this.request();
  }
  cancel() {
    this.setMode("select");
    this.cb.selectionChanged();
  }
  back() {
    if (this.points.length) {
      this.points.pop();
      this.cb.modeChanged();
      this.request();
    }
  }
  metric() {
    return this.tool?.type === "area"
      ? squareMeters(area(this.points))
      : meters(length(this.points));
  }
}

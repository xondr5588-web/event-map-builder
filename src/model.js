import { CATALOG, DEFAULT_VIEW, kindInfo } from "./catalog.js";
import { clamp, validCoord } from "./geometry.js";
import {
  defaultEvent,
  normalizeEvent,
  normalizeDetails,
  normalizeAnnotation,
} from "./event-data.js";
export const SCHEMA_VERSION = 2;
export const uid = () => globalThis.crypto.randomUUID();
export const clone = (x) => structuredClone(x);
const text = (s, fallback = "") =>
  typeof s === "string" ? s.slice(0, 2000) : fallback;
const validId = (s) =>
  typeof s === "string" &&
  s.length > 0 &&
  s.length <= 120 &&
  !/[<>"'&\u0000-\u001f]/.test(s);
const number = (v, fallback, min, max) =>
  Number.isFinite(Number(v)) && v !== null && v !== ""
    ? clamp(Number(v), min, max)
    : fallback;
const color = (v, fallback) =>
  /^#[0-9a-f]{6}$/i.test(v)
    ? v
    : /^#[0-9a-f]{3}$/i.test(v)
      ? "#" +
        v
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : fallback;
export function defaultPlan() {
  return {
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    venue: "",
    organizer: "",
    agency: "",
    manager: "",
    phone: "",
    documentNo: "",
    revision: "1",
    status: "draft",
    expectedVisitors: 0,
    parkingAreaPerCar: 30,
  };
}
function normalizePlan(raw = {}) {
  const plan = defaultPlan();
  for (const key of Object.keys(plan))
    if (typeof plan[key] === "string")
      plan[key] = text(raw?.[key], plan[key]).slice(0, 120);
  plan.status = ["draft", "review", "final"].includes(raw?.status)
    ? raw.status
    : "draft";
  plan.expectedVisitors = Math.floor(
    number(raw?.expectedVisitors, 0, 0, 10000000),
  );
  plan.parkingAreaPerCar = number(raw?.parkingAreaPerCar, 30, 10, 200);
  return plan;
}
export function newProject(title = "새 행사 운영도") {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    objects: [],
    view: clone(DEFAULT_VIEW),
    settings: {
      layers: { area: true, line: true, marker: true },
      viewMode: "all",
      labels: true,
      snap: true,
      autoSize: true,
      scaleWithMap: true,
      referenceZoom: 16,
      symbolSize: 1,
      markerSize: null,
    },
    meta: { note: "", plan: defaultPlan(), event: defaultEvent() },
  };
}
export function newObject(type, kind, points, name) {
  const info = kindInfo({ type, kind });
  return {
    id: uid(),
    type,
    kind,
    name: name || info[0],
    ...(type === "marker"
      ? { position: clone(points[0]) }
      : { path: clone(points) }),
    visible: true,
    locked: false,
    group: "",
    bundle: "",
    details: normalizeDetails({}, kind),
    ...(kind === "note"
      ? { annotation: normalizeAnnotation({ text: name || "안내 문구" }) }
      : {}),
    rotation: 0,
    style: {
      color: info[1],
      width: type === "area" ? 3 : 6,
      opacity: type === "area" ? 0.2 : 1,
      spacing: kind === "cone" ? 7 : 40,
      scale: 1,
      markerSize: null,
    },
    operations: {
      quantity: 1,
      team: "",
      contact: "",
      start: "",
      end: "",
      note: "",
      capacity: null,
      status: "planned",
    },
    label: {
      text: name || info[0],
      visible: true,
      dx: 0,
      dy: type === "marker" ? 34 : 0,
      manual: false,
    },
  };
}
function coord(p, where) {
  const a = Array.isArray(p)
    ? { lat: Number(p[1]), lng: Number(p[0]) }
    : { lat: Number(p?.lat), lng: Number(p?.lng) };
  if (
    p == null ||
    p.lat === null ||
    p.lng === null ||
    p.lat === "" ||
    p.lng === "" ||
    !validCoord(a)
  )
    throw new Error(`${where}: 유효하지 않은 좌표입니다.`);
  return a;
}
function normalizeObject(raw, type, index, ids, warnings, legacyLayer = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${index + 1}번 객체가 올바르지 않습니다.`);
  if (!["area", "line", "marker"].includes(type))
    throw new Error(`${index + 1}번 객체 종류가 올바르지 않습니다.`);
  const kind =
    raw.kind === "staff"
      ? "parkingStaff"
      : text(raw.kind, Object.keys(CATALOG[type])[0]);
  const name = text(raw.name, kindInfo({ type, kind })[0]);
  const points =
    type === "marker" ? [coord(raw.position || raw, name)] : raw.path;
  if (
    !Array.isArray(points) ||
    points.length < (type === "area" ? 3 : type === "line" ? 2 : 1) ||
    points.length > 20000
  )
    throw new Error(`${name}: 점 개수가 올바르지 않습니다.`);
  const o = newObject(
    type,
    kind,
    points.map((p) => coord(p, name)),
    name,
  );
  if (validId(raw.id) && !ids.has(raw.id)) o.id = raw.id;
  else if (raw.id)
    warnings.push("중복 또는 잘못된 객체 ID를 새 ID로 교체했습니다.");
  ids.add(o.id);
  const st = raw.style || {};
  o.style = {
    color: color(
      st.color || raw.color || legacyLayer.styleOverrides?.[type]?.[kind],
      o.style.color,
    ),
    width: number(
      st.width || raw.width,
      type === "area" ? 3 : legacyLayer.lineWidth || 6,
      1,
      30,
    ),
    opacity: number(
      st.opacity ?? raw.opacity,
      type === "area" ? (legacyLayer.areaOpacity ?? 0.2) : 1,
      0,
      1,
    ),
    spacing: number(
      st.spacing ?? raw.coneSpacing ?? raw.arrowSpacing,
      o.style.spacing,
      1,
      500,
    ),
    scale: number(st.scale, 1, 0.25, 4),
    markerSize:
      st.markerSize == null || st.markerSize === ""
        ? null
        : number(st.markerSize, 32, 16, 96),
  };
  const op = raw.operations || {};
  o.operations = {
    quantity: Math.round(number(op.quantity, 1, 1, 9999)),
    team: text(op.team).slice(0, 120),
    contact: text(op.contact).slice(0, 120),
    start: text(op.start).slice(0, 80),
    end: text(op.end).slice(0, 80),
    note: text(op.note),
    capacity:
      op.capacity == null || op.capacity === ""
        ? null
        : Math.floor(number(op.capacity, 0, 0, 100000)),
    status: ["planned", "confirmed", "deployed"].includes(op.status)
      ? op.status
      : "planned",
  };
  o.rotation = number(raw.rotation, 0, -36000, 36000) % 360;
  o.visible = raw.visible !== false;
  o.locked = raw.locked === true;
  o.group = text(raw.group).slice(0, 80);
  o.bundle = validId(raw.bundle) ? raw.bundle : "";
  o.details = normalizeDetails(raw.details, kind);
  if (kind === "note")
    o.annotation = normalizeAnnotation(raw.annotation || { text: name });
  if (type === "area" && raw.facility)
    o.facility = {
      width: number(raw.facility.width, 3, 0.5, 1000),
      depth: number(raw.facility.depth, 3, 0.5, 1000),
      rotation: number(raw.facility.rotation, 0, -360, 360),
      mode: raw.facility.mode === "rectangle" ? "rectangle" : "free",
    };
  const l = raw.label || {};
  o.label = {
    text: text(l.text, text(raw.labelText, name)),
    visible: (l.visible ?? raw.labelVisible) !== false,
    dx: number(l.dx ?? raw.labelDx, 0, -5000, 5000),
    dy: number(l.dy ?? raw.labelDy, type === "marker" ? 34 : 0, -5000, 5000),
    manual: !!(
      l.manual ||
      raw.labelManual ||
      raw.labelDx !== undefined ||
      raw.labelDy !== undefined
    ),
  };
  if (l.position || (raw.labelLat != null && raw.labelLng != null))
    o.label.position = coord(
      l.position || { lat: raw.labelLat, lng: raw.labelLng },
      `${name} 라벨`,
    );
  return o;
}
export function migrate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("프로젝트 JSON 형식이 아닙니다.");
  let raw = input.project || input.data || input;
  if (
    raw.schemaVersion != null &&
    ![1, SCHEMA_VERSION].includes(raw.schemaVersion)
  )
    throw new Error(
      `지원하지 않는 스키마 버전: ${raw.schemaVersion}. 최신 프로그램으로 열어 주세요.`,
    );
  const modern = Array.isArray(raw.objects);
  const old = ["areas", "lines", "markers"].some((k) => Array.isArray(raw[k]));
  const oldest = ["parking", "flow", "staff"].some((k) =>
    Array.isArray(raw[k]),
  );
  if (!modern && !old && !oldest)
    throw new Error("지원하지 않는 JSON 구조입니다.");
  const p = newProject(text(raw.title, text(raw.meta?.title, "가져온 운영도")));
  if (validId(raw.id)) p.id = raw.id;
  p.createdAt = number(raw.createdAt, p.createdAt, 0, 8640000000000000);
  p.updatedAt = number(
    raw.updatedAt ?? input.ts,
    p.updatedAt,
    0,
    8640000000000000,
  );
  p.revision = number(raw.revision, 0, 0, Number.MAX_SAFE_INTEGER);
  if (Number.isFinite(raw.deletedAt) && raw.deletedAt > 0)
    p.deletedAt = raw.deletedAt;
  p.meta = {
    note: text(raw.meta?.note),
    plan: normalizePlan(raw.meta?.plan),
    event: normalizeEvent(raw.meta?.event),
    ...(oldest
      ? { migratedFrom: "parking/flow/staff" }
      : old
        ? { migratedFrom: "v10" }
        : {}),
  };
  const s = raw.settings || raw.layer || {};
  p.settings = {
    labels: (s.labels ?? s.markerLabels) !== false,
    snap: s.snap !== false,
    layers: {
      area: (s.layers?.area ?? s.areas) !== false,
      line: (s.layers?.line ?? s.lines) !== false,
      marker: (s.layers?.marker ?? s.markers) !== false,
    },
  };
  if (raw.view) {
    p.view = {
      center: coord(raw.view.center, "지도 중심"),
      zoom: number(raw.view.zoom, 16, 6, 21),
      type: ["normal", "satellite", "hybrid", "terrain"].includes(raw.view.type)
        ? raw.view.type
        : "hybrid",
    };
  }
  p.settings.viewMode = ["all", "visitor", "emergency"].includes(s.viewMode)
    ? s.viewMode
    : "all";
  p.settings.scaleWithMap = s.scaleWithMap !== false;
  p.settings.autoSize = s.autoSize !== false;
  // Anchor pre-upgrade screen offsets and symbol sizes at their saved zoom.
  p.settings.referenceZoom = number(s.referenceZoom, p.view.zoom, 6, 21);
  p.settings.symbolSize = number(s.symbolSize, 1, 0.25, 3);
  p.settings.markerSize =
    s.markerSize == null || s.markerSize === ""
      ? null
      : number(s.markerSize, 32, 16, 96);
  let entries;
  if (modern) entries = raw.objects;
  else if (old) {
    for (const k of ["areas", "lines", "markers"])
      if (raw[k] != null && !Array.isArray(raw[k]))
        throw new Error(`${k}는 배열이어야 합니다.`);
    entries = [
      ...(raw.areas || []).map((o) => ({ ...o, type: "area" })),
      ...(raw.lines || []).map((o) => ({ ...o, type: "line" })),
      ...(raw.markers || []).map((o) => ({ ...o, type: "marker" })),
    ];
  } else {
    for (const k of ["parking", "flow", "staff"])
      if (raw[k] != null && !Array.isArray(raw[k]))
        throw new Error(`${k}는 배열이어야 합니다.`);
    entries = [
      ...(raw.parking || []).map((o) => ({
        ...o,
        type: "area",
        kind: o.name?.includes("행사장")
          ? "event"
          : o.name?.includes("관계자")
            ? "vip"
            : "parking",
      })),
      ...(raw.flow || []).map((o) => ({
        ...o,
        type: "line",
        kind: o.name?.includes("라바콘")
          ? "cone"
          : o.name?.includes("일방")
            ? "oneway"
            : /차단|금지/.test(o.name)
              ? "block"
              : "route",
      })),
      ...(raw.staff || []).map((o) => ({
        ...o,
        type: "marker",
        kind: "parkingStaff",
      })),
    ];
  }
  if (entries.length > 10000)
    throw new Error("프로젝트당 객체는 10,000개까지 지원합니다.");
  const warnings = [],
    ids = new Set();
  if (raw.id && !validId(raw.id))
    warnings.push("잘못된 프로젝트 ID를 새 ID로 교체했습니다.");
  let vertices = 0;
  p.objects = entries.map((o, i) => {
    const n = normalizeObject(o, o.type, i, ids, warnings, s);
    vertices += n.path?.length || 1;
    if (vertices > 200000)
      throw new Error("점이 너무 많습니다(최대 200,000개).");
    return n;
  });
  return { project: p, warnings: [...new Set(warnings)] };
}
export function exportProject(p) {
  return JSON.stringify(
    {
      format: "event-map-builder",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      project: p,
    },
    null,
    2,
  );
}
export function parseImport(str) {
  if (new TextEncoder().encode(str).length > 50 * 1024 * 1024)
    throw new Error("파일 크기는 50MB 이하만 지원합니다.");
  let data;
  try {
    data = JSON.parse(str);
  } catch {
    throw new Error(
      "JSON 문법이 올바르지 않습니다. 원본 파일을 확인해 주세요.",
    );
  }
  if (data.format === "event-map-builder-backup") {
    if (
      ![1, SCHEMA_VERSION].includes(data.schemaVersion) ||
      !Array.isArray(data.projects) ||
      data.projects.length > 300
    )
      throw new Error("백업 형식 또는 프로젝트 개수가 올바르지 않습니다.");
    if (
      !Array.isArray(data.versions || []) ||
      (data.versions || []).length > 10000
    )
      throw new Error("백업 버전 형식 또는 개수가 올바르지 않습니다.");
    if (
      !Array.isArray(data.legacyBackups || []) ||
      (data.legacyBackups || []).some(
        (b) => !b || typeof b.id !== "string" || typeof b.raw !== "string",
      )
    )
      throw new Error("이전 원본 백업 형식이 올바르지 않습니다.");
    const results = data.projects.map(migrate),
      ids = new Set(results.map((r) => r.project.id));
    if (ids.size !== results.length)
      throw new Error("백업에 중복된 프로젝트 ID가 있습니다.");
    const versions = (data.versions || []).map((v) => {
      if (!v || !ids.has(v.projectId))
        throw new Error("프로젝트가 없는 버전 데이터입니다.");
      return {
        id: uid(),
        projectId: v.projectId,
        label: text(v.label, "가져온 버전"),
        ts: number(v.ts, Date.now(), 0, 8640000000000000),
        legacy: !!v.legacy,
        data: migrate(v.data).project,
      };
    });
    return {
      projects: results.map((r) => r.project),
      versions,
      legacyBackups: data.legacyBackups || [],
      warnings: results.flatMap((r) => r.warnings),
    };
  }
  const r = migrate(data);
  return { projects: [r.project], versions: [], warnings: r.warnings };
}

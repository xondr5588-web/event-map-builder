import { clone } from "./clone.js";
// Versioned, portable event publishing data. Never contains API credentials.
export const INTERNAL_KINDS = new Set([
  "parkingStaff",
  "safetyStaff",
  "guideStaff",
  "control",
  "vipGate",
  "vip",
  "command",
]);
const str = (x, n = 2000) => (typeof x === "string" ? x.slice(0, n) : "");
const num = (x, d, a, b) =>
  Number.isFinite(Number(x)) && x !== null && x !== ""
    ? Math.max(a, Math.min(b, Number(x)))
    : d;
const col = (x, d) => (/^#[0-9a-f]{6}$/i.test(x) ? x : d);
export const validDate = (x) =>
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  !Number.isNaN(Date.parse(x)) &&
  new Date(x).toISOString().slice(0, 10) === x;
export const validTime = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
export function defaultEvent() {
  return {
    programs: [],
    background: null,
    views: [],
    document: { subtitle: "", notice: "", accent: "#186b61", frame: null },
  };
}
export function normalizeDetails(raw = {}, kind = "") {
  return {
    number: str(raw.number, 30),
    description: str(raw.description),
    audience: ["both", "visitor", "internal"].includes(raw.audience)
      ? raw.audience
      : INTERNAL_KINDS.has(kind)
        ? "internal"
        : "both",
    listed: raw.listed === true,
  };
}
export function normalizeAnnotation(raw = {}) {
  return {
    text: str(raw.text, 1000),
    fontSize: num(raw.fontSize, 16, 10, 72),
    width: num(raw.width, 180, 60, 600),
    textColor: col(raw.textColor, "#203f4c"),
    background: col(raw.background, "#ffffff"),
    align: ["start", "middle", "end"].includes(raw.align)
      ? raw.align
      : "middle",
    border: raw.border !== false,
  };
}
export function normalizeProgram(p, index = 0) {
  if (!p || !validDate(p.date) || !validTime(p.start) || !validTime(p.end))
    throw new Error(
      `${index + 1}번 프로그램: 날짜·시작·종료시간을 확인하세요.`,
    );
  if (!str(p.title, 120).trim())
    throw new Error(`${index + 1}번 프로그램: 제목이 필요합니다.`);
  const endDate = p.endDate || p.date;
  if (
    validDate(endDate) &&
    Date.parse(endDate) - Date.parse(p.date) > 31 * 86400000
  )
    throw new Error("프로그램 기간은 최대 31일입니다.");
  if (!validDate(endDate) || `${endDate}T${p.end}` <= `${p.date}T${p.start}`)
    throw new Error(
      `${index + 1}번 프로그램: 종료가 시작보다 늦어야 합니다. 자정 이후라면 종료일을 지정하세요.`,
    );
  return {
    id: str(p.id, 120) || crypto.randomUUID(),
    title: str(p.title, 120).trim(),
    date: p.date,
    start: p.start,
    end: p.end,
    endDate,
    placeId: str(p.placeId, 120),
    venue: str(p.venue, 120),
    category: str(p.category, 50),
    description: str(p.description),
    public: p.public !== false,
  };
}
export function normalizeEvent(raw = {}) {
  const value = defaultEvent();
  if (
    raw.programs != null &&
    (!Array.isArray(raw.programs) || raw.programs.length > 2000)
  )
    throw new Error("프로그램은 2,000개까지 저장할 수 있습니다.");
  const ids = new Set();
  value.programs = (raw.programs || []).map((p, i) => {
    const q = normalizeProgram(p, i);
    if (ids.has(q.id)) q.id = crypto.randomUUID();
    ids.add(q.id);
    return q;
  });
  const b = raw.background;
  if (b) {
    if (
      !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(
        b.data || "",
      ) ||
      b.data.length > 4000000 ||
      !Number.isFinite(b.center?.lat) ||
      !Number.isFinite(b.center?.lng) ||
      Math.abs(b.center.lat) > 85 ||
      Math.abs(b.center.lng) > 180
    )
      throw new Error("배경 그림 형식·크기·좌표가 올바르지 않습니다.");
    value.background = {
      data: b.data,
      name: str(b.name, 120),
      center: { lat: b.center.lat, lng: b.center.lng },
      width: num(b.width, 200, 1, 50000),
      height: num(b.height, 150, 1, 50000),
      rotation: num(b.rotation, 0, -360, 360),
      enabled: b.enabled !== false,
      opacity: num(b.opacity, 1, 0.1, 1),
    };
  }
  const d = raw.document || {};
  value.document = {
    subtitle: str(d.subtitle, 160),
    notice: str(d.notice, 2000),
    accent: col(d.accent, "#186b61"),
    frame: null,
  };
  if (
    d.frame &&
    Array.isArray(d.frame) &&
    d.frame.length === 2 &&
    d.frame.every(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 85 &&
        Math.abs(p.lng) <= 180,
    )
  )
    value.document.frame = d.frame.map((p) => ({ lat: p.lat, lng: p.lng }));
  value.views = (Array.isArray(raw.views) ? raw.views : [])
    .slice(0, 20)
    .filter(
      (v) =>
        typeof v.name === "string" &&
        v.view?.center &&
        Number.isFinite(v.view.center.lat) &&
        Number.isFinite(v.view.center.lng) &&
        Math.abs(v.view.center.lat) <= 85 &&
        Math.abs(v.view.center.lng) <= 180,
    )
    .map((v) => ({
      name: str(v.name, 60),
      view: {
        center: { lat: v.view.center.lat, lng: v.view.center.lng },
        zoom: num(v.view.zoom, 16, 6, 21),
        type: ["normal", "hybrid", "satellite", "terrain"].includes(v.view.type)
          ? v.view.type
          : "hybrid",
      },
      mode: ["all", "visitor", "emergency"].includes(v.mode) ? v.mode : "all",
    }));
  return value;
}
export function isDisplayed(
  project,
  o,
  { mode = project.settings.viewMode || "all", layers = true } = {},
) {
  if (!o.visible || (layers && project.settings.layers[o.type] === false))
    return false;
  const audience =
    o.details?.audience || (INTERNAL_KINDS.has(o.kind) ? "internal" : "both");
  if (mode === "visitor") return audience !== "internal";
  if (mode === "emergency")
    return [
      "medical",
      "fire",
      "police",
      "assembly",
      "command",
      "emergency",
      "accessible",
      "restricted",
      "control",
      "gateIn",
      "gateOut",
      "note",
    ].includes(o.kind);
  return true;
}
export function directory(project, { visitor = false } = {}) {
  return project.objects
    .filter(
      (o) =>
        (o.details?.listed || o.details?.number) &&
        (!visitor ||
          isDisplayed(project, o, { mode: "visitor", layers: false })),
    )
    .sort((a, b) =>
      (a.details.number || "").localeCompare(b.details.number || "", "ko", {
        numeric: true,
      }),
    );
}
export function programVenue(p, project) {
  return (
    project.objects.find((o) => o.id === p.placeId)?.name ||
    p.venue ||
    "장소 미정"
  );
}
export function programConflicts(programs) {
  const conflicts = [];
  const sorted = [...programs].sort((a, b) =>
    (a.date + a.start).localeCompare(b.date + b.start),
  );
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i],
        b = sorted[j];
      if (`${b.date}T${b.start}` >= `${a.endDate || a.date}T${a.end}`) break;
      if (
        (a.placeId || a.venue) &&
        (a.placeId || a.venue) === (b.placeId || b.venue)
      )
        conflicts.push([a, b]);
    }
  return conflicts;
}
// RFC4180, quoted multiline cells and Excel TSV; all rows validate before import.
export function parseProgramTable(source) {
  const input = source.replace(/^\uFEFF/, "");
  if (input.length > 4000000)
    throw new Error("일정 파일은 4MB 이하로 가져오세요.");
  const delimiter = input.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("CSV 따옴표를 확인하세요.");
    } else if (!quoted && (c === delimiter || c === "\n")) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (c === "\n") {
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("제목 행과 프로그램 행이 필요합니다.");
  const aliases = {
    날짜: "date",
    시작: "start",
    종료: "end",
    종료일: "endDate",
    프로그램: "title",
    제목: "title",
    장소: "venue",
    분류: "category",
    설명: "description",
    공개: "public",
  };
  const headers = rows.shift().map((s) => aliases[s.trim()] || s.trim());
  if (!["date", "start", "end", "title"].every((h) => headers.includes(h)))
    throw new Error("날짜, 시작, 종료, 프로그램 열이 필요합니다.");
  if (rows.length > 2000)
    throw new Error("프로그램은 2,000개까지 가져올 수 있습니다.");
  return rows.map((r, i) => {
    const p = Object.fromEntries(
      headers.map((h, j) => [h, r[j]?.trim() || ""]),
    );
    p.public = !["아니오", "false", "비공개", "0"].includes(p.public);
    return normalizeProgram(p, i);
  });
}
export function programCSV(programs, project) {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return (
    "\uFEFF" +
    [
      [
        "날짜",
        "시작",
        "종료",
        "종료일",
        "프로그램",
        "장소",
        "분류",
        "설명",
        "공개",
      ],
      ...programs.map((p) => [
        p.date,
        p.start,
        p.end,
        p.endDate,
        p.title,
        programVenue(p, project),
        p.category,
        p.description,
        p.public ? "예" : "아니오",
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}

export function publicationProject(project, visitor = true) {
  const p = clone(project);
  p.settings.viewMode = visitor ? "visitor" : "all";
  p.objects = p.objects.filter((o) =>
    isDisplayed(p, o, { mode: visitor ? "visitor" : "all", layers: false }),
  );
  p.settings.layers = { area: true, line: true, marker: true };
  if (visitor) {
    p.objects = p.objects.map((o) => {
      delete o.operations;
      return o;
    });
    p.meta.plan = {
      venue: p.meta.plan.venue,
      startDate: p.meta.plan.startDate,
      endDate: p.meta.plan.endDate,
      organizer: p.meta.plan.organizer,
    };
    p.meta.note = "";
    p.meta.event.programs = p.meta.event.programs.filter((s) => s.public);
  }
  return p;
}

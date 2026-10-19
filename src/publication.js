import { Renderer, escapeHTML as esc } from "./renderer.js";
import { clone } from "./model.js";
import { pointsOf, world, unworld, distance, boundsXY } from "./geometry.js";
import { localPoint } from "./venue.js";
import {
  directory,
  isDisplayed,
  programVenue,
  publicationProject,
} from "./event-data.js";
export { publicationProject } from "./event-data.js";
import { operationalSummary } from "./operations.js";
import { download, fileName } from "./files.js";
const NS = "http://www.w3.org/2000/svg";
const MAP_STYLE =
  ".object-hit,.label-touch,.handles,.draft{display:none}.object-label rect{fill:#fff;stroke:#b9c8ca}.object-label text{font:600 12px sans-serif;fill:#163432}.label-leader{opacity:.6}.map-object{outline:none}";
export function schematicSVG(
  project,
  { visitor = true, width = 1600, height = 950 } = {},
) {
  const p = publicationProject(project, visitor),
    bg = p.meta.event.background;
  let points = p.meta.event.document.frame || p.objects.flatMap(pointsOf);
  if (!p.meta.event.document.frame && bg?.enabled)
    points = [
      ...points,
      ...[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) =>
        localPoint(
          bg.center,
          (a * bg.width) / 2,
          (b * bg.height) / 2,
          bg.rotation,
        ),
      ),
    ];
  if (!points.length) points = [p.view.center];
  const { left, right, top, bottom } = boundsXY(points.map((c) => world(c, 0))),
    mid = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const zoom = Math.min(
      26,
      Math.max(
        6,
        Math.log2(
          Math.min(
            (width - 180) / Math.max(right - left, 0.00001),
            (height - 160) / Math.max(bottom - top, 0.00001),
          ),
        ),
      ),
    ),
    scale = 2 ** zoom;
  const adapter = {
    size: { width, height },
    view: { zoom, center: unworld(mid, 0) },
    project: (c) => {
      const v = world(c, 0);
      return {
        x: (v.x - mid.x) * scale + width / 2,
        y: (v.y - mid.y) * scale + height / 2,
      };
    },
    unproject: (v) =>
      unworld(
        {
          x: (v.x - width / 2) / scale + mid.x,
          y: (v.y - height / 2) / scale + mid.y,
        },
        0,
      ),
  };
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", p.title);
  const renderer = new Renderer(svg, adapter);
  renderer.draw(p);
  svg
    .querySelectorAll(
      ".object-hit,.label-touch,.handles,.draft,[data-locked-indicator]",
    )
    .forEach((n) => n.remove());
  svg.querySelectorAll("[tabindex],[data-object]").forEach((n) => {
    n.removeAttribute("tabindex");
    n.removeAttribute("data-object");
    n.removeAttribute("role");
  });
  const style = document.createElementNS(NS, "style");
  style.textContent = MAP_STYLE;
  svg.prepend(style);
  const rect = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ width, height, fill: "#f0f4ed" }))
    rect.setAttribute(k, v);
  svg.prepend(rect);
  const overlay = document.createElementNS(NS, "g");
  const m = distance(
    adapter.unproject({ x: 0, y: 0 }),
    adapter.unproject({ x: 100, y: 0 }),
  );
  const scaleMeters = [
      1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
    ].reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), 1),
    px = (100 * scaleMeters) / m;
  overlay.innerHTML = `<g transform="translate(${width - 80},55)"><path d="M0-27L-9 1L0-4L9 1Z" fill="#244942"/><text y="22" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#244942">N</text></g><g transform="translate(35,${height - 40})"><rect x="-12" y="-27" width="${px + 40}" height="48" rx="5" fill="white" fill-opacity=".9"/><path d="M0-7V0H${px}V-7" fill="none" stroke="#244942" stroke-width="3"/><text x="${px / 2}" y="-11" text-anchor="middle" font-family="sans-serif" font-size="16">${scaleMeters} m</text></g><text x="${width - 25}" y="${height - 20}" text-anchor="end" font-family="sans-serif" font-size="14" fill="#526d68">${bg?.enabled ? "사용자 제공 배경" : "시설 배치도 · 실제 도로정보 아님"} · FIELD</text>`;
  svg.append(overlay);
  return new XMLSerializer().serializeToString(svg);
}
const chunks = (a, n) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) =>
    a.slice(i * n, i * n + n),
  );
export function schedulePages(project) {
  const programs = [...project.meta.event.programs].sort((a, b) =>
      (a.date + a.start).localeCompare(b.date + b.start),
    ),
    days = new Map();
  for (const p of programs) {
    let d = p.date;
    for (let n = 0; n < 32 && d <= (p.endDate || p.date); n++) {
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(p);
      d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
    }
  }
  const pages = [];
  for (const [date, items] of [...days].sort()) {
    const venues = [...new Set(items.map((p) => programVenue(p, project)))];
    if (items.length > 24 || venues.length > 5) {
      for (const group of chunks(items, 18))
        pages.push(`<h2>${esc(date)} 프로그램</h2>${agenda(group, project)}`);
      continue;
    }
    const min = Math.min(
        ...items.map((p) => (p.date < date ? 0 : minute(p.start))),
      ),
      max = Math.max(
        ...items.map((p) =>
          (p.endDate || p.date) > date ? 1440 : minute(p.end),
        ),
      ),
      from = Math.floor(min / 60) * 60,
      to = Math.max(from + 60, Math.ceil(max / 60) * 60),
      span = to - from;
    const columns = venues
      .map((v) => {
        const list = items.filter((p) => programVenue(p, project) === v),
          ends = [],
          position = [];
        for (const p of list) {
          const a = p.date < date ? 0 : minute(p.start),
            b = (p.endDate || p.date) > date ? 1440 : minute(p.end);
          let lane = ends.findIndex((end) => end <= a);
          if (lane < 0) lane = ends.length;
          ends[lane] = b;
          position.push({ p, a, b, lane });
        }
        return `<div class="schedule-column"><h3>${esc(v)}</h3><div class="schedule-track">${position.map(({ p, a, b, lane }) => `<article class="schedule-card" style="top:${((a - from) / span) * 100}%;height:${Math.max(1, ((b - a) / span) * 100)}%;left:${(lane / ends.length) * 100}%;width:${100 / ends.length}%"><b>${esc(p.start)}–${esc(p.end)}${p.endDate !== p.date ? " (+1일 이상)" : ""}</b><strong>${esc(p.title)}</strong><small>${esc(p.category)}</small></article>`).join("")}</div></div>`;
      })
      .join("");
    pages.push(
      `<h2>${esc(date)} 프로그램 시간표</h2><div class="schedule-grid"><div class="schedule-axis"><h3>시간</h3><div class="schedule-track">${Array.from({ length: Math.ceil(span / 60) + 1 }, (_, i) => `<span style="top:${((i * 60) / span) * 100}%">${String(Math.floor((from + i * 60) / 60)).padStart(2, "0")}:00</span>`).join("")}</div></div>${columns}</div>`,
    );
    for (const group of chunks(items, 12))
      pages.push(
        `<h2>${esc(date)} 프로그램 상세</h2>${agenda(group, project)}`,
      );
  }
  return pages;
}
const minute = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const agenda = (items, p) =>
  `<div class="program-agenda">${items.map((s) => `<article><div class="program-time">${esc(s.date)}<br>${esc(s.start)}–${esc(s.end)}${s.endDate !== s.date ? `<br>~ ${esc(s.endDate)}` : ""}</div><div><b>${esc(s.title)}</b><small>${esc(programVenue(s, p))} ${esc(s.category)}</small><p>${esc(s.description)}</p></div></article>`).join("")}</div>`;
export const PUBLICATION_CSS = `*{box-sizing:border-box}body{margin:0;background:#e8eeed;color:#213e3a;font-family:Arial,'Noto Sans KR',sans-serif}.publication-page{width:281mm;min-height:194mm;margin:18px auto;padding:10mm;background:white;break-after:page}.publication-page:last-child{break-after:auto}.publication-page header{border-bottom:3px solid var(--accent,#186b61);padding-bottom:10px;margin-bottom:12px;display:flex;justify-content:space-between;gap:12px}.publication-page h1{font-size:25px;margin:0 0 6px}.publication-page h2{font-size:20px}.publication-page h3{font-size:13px;margin:0}.publication-page p{white-space:pre-wrap;line-height:1.5}.publication-meta{font-size:12px;color:#56716b}.publication-map svg{width:100%;height:auto;display:block}.publication-map{border:1px solid #d4dfdc;border-radius:8px;overflow:hidden}.publication-directory{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.publication-facility{display:flex;gap:9px;break-inside:avoid;padding:12px 0;border-bottom:1px solid #dbe4e0}.facility-number{display:inline-grid;place-items:center;border-radius:6px;background:var(--accent,#186b61);color:white;min-width:38px;height:30px;font-size:13px;padding:0 5px}.publication-facility>div{min-width:0;overflow-wrap:anywhere}.publication-page h1{overflow-wrap:anywhere}.publication-facility p{font-size:12px;margin:4px 0;overflow-wrap:anywhere}.publication-footer{font-size:11px;color:#59716b;border-top:1px solid #dbe4e0;padding-top:8px;margin-top:12px;white-space:pre-wrap}.publication-metrics{display:flex;gap:24px;margin:14px 0;font-size:15px}.publication-metrics b{font-size:23px;display:block}.schedule-grid{display:flex;height:148mm;gap:6px;margin:20px 0 25px}.schedule-axis{width:45px;flex:none}.schedule-axis span{position:absolute;left:0;font-size:10px;transform:translateY(-50%)}.schedule-column{flex:1;min-width:0}.schedule-track{position:relative;height:calc(100% - 25px);margin-top:15px;background:repeating-linear-gradient(#fff 0,#fff 39px,#e5eeea 40px)}.schedule-card{position:absolute;padding:5px;border:1px solid #6ea99a;background:#e5f2ed;border-radius:4px;overflow:hidden;min-height:17px}.schedule-card b,.schedule-card small{font-size:10px;display:block}.schedule-card strong{font-size:12px;display:block}.program-agenda article{display:flex;gap:20px;padding:12px 0;border-bottom:1px solid #dbe4e0;break-inside:avoid}.program-time{font-size:12px;width:125px;flex:none}.program-agenda small{display:block;color:#56716b;margin-top:5px}.program-agenda p{font-size:12px;margin:5px 0}.publication-controls{position:sticky;top:0;display:flex;justify-content:center;gap:12px;z-index:10;background:#173d36;padding:12px}.publication-controls button{font:inherit;padding:10px 18px;border:0;border-radius:6px;cursor:pointer}@media(max-width:760px){.publication-page{width:100%;min-height:0;padding:16px;margin:10px 0}.publication-directory{grid-template-columns:1fr 1fr}.schedule-grid{overflow:auto;height:140mm}.schedule-column{min-width:135px}.publication-page h1{font-size:21px}.publication-metrics{flex-wrap:wrap}}@media print{body{background:white}.publication-controls{display:none!important}.publication-page{margin:0;padding:0;min-height:0;width:100%;box-shadow:none}.publication-directory{grid-template-columns:repeat(3,minmax(0,1fr))}.publication-map svg{max-height:144mm}.publication-page{break-after:page}.publication-page:last-child{break-after:auto}.schedule-grid{height:145mm;overflow:visible}.schedule-column{min-width:0}}`;
export function publicationHTML(
  project,
  { visitor = true, template = "guide", paper = "A4 landscape" } = {},
) {
  const p = publicationProject(project, visitor),
    d = p.meta.event.document,
    facilities = directory(p),
    pages = [];
  if (template !== "schedule") {
    const summary = operationalSummary(visitor ? p : project);
    pages.push(
      `<div class="publication-map">${schematicSVG(project, { visitor, width: 1600, height: template === "operation" ? 860 : 900 })}</div>${template === "operation" ? `<div class="publication-metrics"><span><b>${summary.staff}명</b>계획 인력</span><span><b>${summary.parking}대</b>주차 계획</span><span><b>${summary.cones}개</b>라바콘 추정</span><span><b>${Math.round(summary.routeLength)} m</b>동선 총 길이</span></div>` : ""}`,
    );
    for (const group of chunks(facilities, 15))
      pages.push(
        `<h2>시설·부스 안내</h2><div class="publication-directory">${group.map((o) => `<article class="publication-facility"><b class="facility-number">${esc(o.details.number || "·")}</b><div><b>${esc(o.name)}</b><p>${esc(o.details.description)}</p>${o.facility ? `<small>${o.facility.mode === "rectangle" ? `${o.facility.width} × ${o.facility.depth} m` : "자유 규격"}</small>` : ""}</div></article>`).join("")}</div>`,
      );
  }
  if (template !== "operation") pages.push(...schedulePages(p));
  if (!pages.length) pages.push("<p>등록된 프로그램이 없습니다.</p>");
  const header = `<header><div><h1>${esc(p.title)}</h1><div>${esc(d.subtitle)}</div></div><div class="publication-meta">${esc(p.meta.plan.venue)}<br>${esc(p.meta.plan.startDate)}${p.meta.plan.endDate && p.meta.plan.endDate !== p.meta.plan.startDate ? " ~ " + esc(p.meta.plan.endDate) : ""}<br>${visitor ? "방문객 안내" : "운영용 · 내부 배포"}</div></header>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><style>${PUBLICATION_CSS}\n@page{size:${["A4 landscape", "A4 portrait", "A3 landscape", "A3 portrait"].includes(paper) ? paper : "A4 landscape"};margin:8mm}</style></head><body style="--accent:${d.accent}"><div class="publication-controls"><button onclick="window.print()">PDF / 인쇄</button></div>${pages.map((content, i) => `<section class="publication-page">${header}${content}<footer class="publication-footer">${esc(d.notice)}<br>${esc(p.meta.plan.organizer)} · FIELD · ${i + 1} / ${pages.length}</footer></section>`).join("")}</body></html>`;
}
export function openPublication(project, options = {}) {
  document.getElementById("event-publication")?.remove();
  const host = document.createElement("div");
  host.id = "event-publication";
  const frame = document.createElement("iframe");
  frame.title = "행사 안내도 미리보기";
  frame.srcdoc = publicationHTML(project, options);
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-modals");
  const controls = document.createElement("div");
  controls.className = "event-publication-controls";
  const back = document.createElement("button");
  back.textContent = "편집으로 돌아가기";
  back.onclick = () => host.remove();
  const save = document.createElement("button");
  save.textContent = "안내 파일 저장";
  save.onclick = () =>
    download(
      publicationHTML(project, options),
      fileName(
        `${project.title}_${options.visitor === false ? "운영용" : "방문객안내"}`,
        "html",
      ),
      "text/html;charset=utf-8",
    );
  controls.append(back, save);
  host.append(controls, frame);
  document.body.append(host);
  back.focus();
  host.addEventListener("keydown", (e) => {
    if (e.key === "Escape") host.remove();
  });
}
export async function exportSchematicPNG(project, options = {}) {
  const source = schematicSVG(project, options),
    url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1425;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("PNG를 저장하지 못했습니다.");
    download(blob, fileName(`${project.title}_완성안내도`, "png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

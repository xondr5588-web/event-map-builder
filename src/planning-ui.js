import {
  PLAN_FIELDS,
  PLAN_STATUS,
  DEPLOY_STATUS,
  operationalSummary,
  parkingCapacity,
  objectMeasure,
  STAFF_KINDS,
} from "./operations.js";
import { escapeHTML as esc } from "./renderer.js";
import { markerSymbol } from "./symbols.js";
import { meters } from "./geometry.js";
const num = (n) => n.toLocaleString("ko-KR");
export function summaryHTML(p, reviewOpen = false) {
  const s = operationalSummary(p);
  return `<div class="plan-metrics"><div><b>${num(s.staff)}</b><span>배치 인원</span></div><div><b>${num(s.parking)}</b><span>주차 대수${s.estimatedParking ? " · 추정 포함" : ""}</span></div><div><b>${num(s.teams)}</b><span>담당팀</span></div><div><b>${meters(s.routeLength)}</b><span>동선 총 길이</span></div></div><p class="small muted">현재 지도에 표시한 요소 기준 · 라바콘 약 ${num(s.cones)}개</p>${s.resources.length ? `<div class="resource-list">${s.resources.map((r) => `<span>${markerSymbol(r.kind, 24)}${esc(r.name)} <b>${num(r.count)}${STAFF_KINDS.has(r.kind) ? "명" : "개"}</b></span>`).join("")}</div>` : ""}<details class="review-items" ${reviewOpen ? "open" : ""}><summary>계획 검토 항목 ${s.warnings.length}개</summary>${s.warnings.length ? `<ul>${s.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : '<p class="small">현재 확인이 필요한 미지정 항목이 없습니다.</p>'}<p class="small muted">입력 누락을 돕는 항목이며 현장 안전점검이나 관계기관 승인을 대신하지 않습니다.</p></details>`;
}
export function planningHTML(p) {
  const plan = p.meta.plan;
  const field = (key) =>
    `<label>${PLAN_FIELDS[key]}<input data-plan="${key}" type="${key.endsWith("Date") ? "date" : key.endsWith("Time") ? "time" : ["expectedVisitors", "parkingAreaPerCar"].includes(key) ? "number" : "text"}" value="${esc(plan[key])}" ${key === "expectedVisitors" ? 'min="0" max="10000000"' : key === "parkingAreaPerCar" ? 'min="10" max="200"' : 'maxlength="120"'}/></label>`;
  return `<div class="panel-intro"><b>행사 운영계획</b>도면과 배치 명세를 한 프로젝트로 관리하세요.</div><div class="row wrap plan-actions"><button data-action="operations-report" class="primary">운영계획서 / PDF</button><button data-action="deployment-csv">배치표 CSV</button></div><section id="plan-summary">${summaryHTML(p)}</section><div class="section-title">문서 관리</div><div class="stack"><label>문서 상태<select data-plan="status">${Object.entries(
    PLAN_STATUS,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${plan.status === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></label><div class="two-col">${field("documentNo")}${field("revision")}</div>${field("venue")}<div class="two-col">${field("startDate")}${field("endDate")}${field("startTime")}${field("endTime")}</div>${field("organizer")}${field("agency")}<div class="two-col">${field("manager")}${field("phone")}</div>${field("expectedVisitors")}<label>운영 메모<textarea id="project-note" rows="4" maxlength="2000">${esc(p.meta.note)}</textarea></label><details><summary>주차 수용대수 추정 설정</summary>${field("parkingAreaPerCar")}<p class="small muted">구역 면적 ÷ 1대당 계획면적의 단순 추정입니다. 통로·지형·차종을 반영해 조정하고, 확정 대수는 구역 속성에 직접 입력하세요.</p></details></div>`;
}
export function operationsFields(objects, project) {
  const o = objects[0],
    op = o.operations,
    locked = objects.every((o) => o.locked),
    disabled = locked ? "disabled" : "";
  const input = (key, label, type = "text", extra = "") =>
    `<label>${label}<input data-prop="operations.${key}" type="${type}" value="${esc(op[key] ?? "")}" ${extra} ${disabled}/></label>`;
  return `<details class="operations-fields" open><summary>현장 배치 정보${objects.length > 1 ? " · 일괄 변경" : ""}</summary><div class="stack"><div class="two-col">${input("team", "담당팀", "text", 'maxlength="120"')}${input("contact", "담당자·연락처", "text", 'maxlength="120"')}</div>${objects.every((o) => o.type === "marker") ? input("quantity", STAFF_KINDS.has(o.kind) ? "배치 인원 (명)" : "수량 (개)", "number", 'min="1" max="9999"') : ""}<div class="two-col">${input("start", "운영 시작", "time")}${input("end", "운영 종료", "time")}</div><label>배치 상태<select data-prop="operations.status" ${disabled}>${Object.entries(
    DEPLOY_STATUS,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${op.status === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></label>${objects.length === 1 && o.type === "area" && ["parking", "vip"].includes(o.kind) ? `${input("capacity", "확정 주차 대수 · 비우면 면적 추정", "number", 'min="0" max="100000"')}<span class="small muted">현재 수용대수: ${parkingCapacity(o, project).count.toLocaleString()}대${op.capacity == null ? " (면적 추정, 운영계획 설정에 따라 변동)" : " (직접 입력)"}</span>` : ""}<label>업무지시·주의사항<textarea data-prop="operations.note" rows="3" maxlength="2000" ${disabled}>${esc(op.note)}</textarea></label></div></details>`;
}
export function reportHTML(p) {
  const plan = p.meta.plan,
    s = operationalSummary(p);
  const teams = new Map();
  for (const o of s.objects) {
    const name = o.operations.team || "미지정";
    if (!teams.has(name)) teams.set(name, { staff: 0, sites: 0 });
    const t = teams.get(name);
    t.sites++;
    if (o.type === "marker" && STAFF_KINDS.has(o.kind))
      t.staff += o.operations.quantity;
  }
  return `<header class="report-heading"><p>FIELD / EVENT OPERATIONS PLAN</p><h1>${esc(p.title)}</h1><div>${esc(plan.documentNo || "문서번호 미지정")} · 개정 ${esc(plan.revision)} · ${PLAN_STATUS[plan.status]}</div></header><section class="report-meta">${["venue", "startDate", "endDate", "startTime", "endTime", "organizer", "agency", "manager", "phone", "expectedVisitors"].map((k) => `<div><span>${PLAN_FIELDS[k]}</span><b>${esc(plan[k] || "—")}${k === "expectedVisitors" && plan[k] ? "명" : ""}</b></div>`).join("")}</section><h2>운영 규모 · 지도 표시 요소 기준</h2>${summaryHTML(p, true)}${p.meta.note ? `<h2>운영 메모</h2><p class="report-note">${esc(p.meta.note)}</p>` : ""}<h2>담당팀별 배치</h2><table><thead><tr><th>담당팀</th><th>배치 지점</th><th>인원</th></tr></thead><tbody>${[...teams].map(([name, t]) => `<tr><td>${esc(name)}</td><td>${t.sites}곳</td><td>${t.staff}명</td></tr>`).join("")}</tbody></table><h2>상세 배치 명세</h2><table class="deployment-table"><thead><tr><th>종류·명칭</th><th>담당팀·연락처</th><th>수량·규모</th><th>운영시간</th><th>상태</th><th>업무지시</th></tr></thead><tbody>${
    s.objects
      .map((o) => {
        const op = o.operations,
          c = parkingCapacity(o, p);
        return `<tr><td>${o.type === "marker" ? markerSymbol(o.kind, 28) : ""}<b>${esc(o.name)}</b><small>${esc(o.group)}</small></td><td>${esc(op.team || "미지정")}<small>${esc(op.contact)}</small></td><td>${esc(objectMeasure(o))}${c ? `<small>${num(c.count)}대 · ${c.estimated ? "면적 추정" : "직접 입력"}</small>` : ""}</td><td>${esc(op.start || plan.startTime || "—")}<br/>~ ${esc(op.end || plan.endTime || "—")}</td><td>${DEPLOY_STATUS[op.status]}</td><td class="report-note">${esc(op.note)}</td></tr>`;
      })
      .join("") || '<tr><td colspan="6">배치한 요소가 없습니다.</td></tr>'
  }</tbody></table><footer class="report-footer">작성·출력 ${new Date().toLocaleString("ko-KR")} · FIELD · 주차 추정값과 배치 계획은 현장 여건에 따라 확인·조정하세요.</footer>`;
}
export function openReport(p, onCSV) {
  closeReport();
  const host = document.createElement("section");
  host.id = "operations-report";
  host.innerHTML = `<nav class="report-controls"><button id="report-print">PDF / 인쇄</button><button id="report-csv">배치표 CSV</button><button id="report-close">편집으로 돌아가기</button></nav><article class="report-paper">${reportHTML(p)}</article>`;
  document.body.append(host);
  document.body.classList.add("report-mode");
  document.getElementById("report-close").onclick = closeReport;
  document.getElementById("report-csv").onclick = onCSV;
  document.getElementById("report-print").onclick = () => {
    let style = document.getElementById("page-size");
    if (!style) {
      style = document.createElement("style");
      style.id = "page-size";
      document.head.append(style);
    }
    style.textContent = "@page { size: A4 landscape; margin: 12mm; }";
    window.print();
  };
}
export function closeReport() {
  document.getElementById("operations-report")?.remove();
  document.body.classList.remove("report-mode");
}

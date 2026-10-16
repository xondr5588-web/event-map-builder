import { area, length, meters, squareMeters, center } from "./geometry.js";
import { kindInfo } from "./catalog.js";
export const PLAN_FIELDS = {
  startDate: "행사 시작일",
  endDate: "행사 종료일",
  startTime: "운영 시작시간",
  endTime: "운영 종료시간",
  venue: "행사 장소",
  organizer: "주최·주관",
  agency: "운영 대행사",
  manager: "총괄 담당자",
  phone: "비상 연락처",
  documentNo: "문서번호",
  revision: "개정번호",
  expectedVisitors: "예상 방문객",
  parkingAreaPerCar: "주차 1대당 계획면적 (m²)",
};
export const PLAN_STATUS = {
  draft: "작성 중",
  review: "검토 중",
  final: "확정본",
};
export const DEPLOY_STATUS = {
  planned: "계획",
  confirmed: "확정",
  deployed: "배치 완료",
};
export const STAFF_KINDS = new Set([
  "parkingStaff",
  "safetyStaff",
  "guideStaff",
]);
export const visibleObjects = (p) =>
  p.objects.filter((o) => o.visible && p.settings.layers[o.type]);
export function parkingCapacity(o, p) {
  if (o.type !== "area" || !["parking", "vip"].includes(o.kind)) return null;
  const manual = o.operations?.capacity;
  return {
    count:
      manual == null
        ? Math.floor(area(o.path) / (p.meta.plan?.parkingAreaPerCar || 30))
        : manual,
    estimated: manual == null,
  };
}
export function operationalSummary(p) {
  const objects = visibleObjects(p),
    resources = new Map();
  let staff = 0,
    parking = 0,
    estimatedParking = 0,
    routeLength = 0,
    cones = 0;
  const teams = new Set();
  for (const o of objects) {
    if (o.operations?.team) teams.add(o.operations.team);
    const capacity = parkingCapacity(o, p);
    if (capacity) {
      parking += capacity.count;
      if (capacity.estimated) estimatedParking += capacity.count;
    }
    if (o.type === "line") routeLength += length(o.path);
    if (o.type === "line" && o.kind === "cone")
      cones += Math.ceil(length(o.path) / o.style.spacing) + 1;
    if (o.type === "marker") {
      const quantity = o.operations?.quantity || 1;
      if (STAFF_KINDS.has(o.kind)) staff += quantity;
      resources.set(o.kind, (resources.get(o.kind) || 0) + quantity);
    }
  }
  const warnings = [];
  const unassigned = objects.filter(
    (o) =>
      o.type === "marker" && STAFF_KINDS.has(o.kind) && !o.operations?.team,
  ).length;
  if (unassigned) warnings.push(`담당팀 미지정 인력 지점 ${unassigned}곳`);
  if (parking && !objects.some((o) => ["gateIn", "carIn"].includes(o.kind)))
    warnings.push("주차 진입 지점이 표시되지 않았습니다.");
  if (parking && !objects.some((o) => ["gateOut", "carOut"].includes(o.kind)))
    warnings.push("주차 출차 지점이 표시되지 않았습니다.");
  if (objects.length && !objects.some((o) => o.kind === "medical"))
    warnings.push("응급의료 위치를 확인하세요.");
  return {
    objects,
    staff,
    parking,
    estimatedParking,
    routeLength,
    cones,
    teams: teams.size,
    resources: [...resources].map(([kind, count]) => ({
      kind,
      count,
      name: kindInfo({ type: "marker", kind })[0],
    })),
    warnings,
  };
}
const csvCell = (value) => {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
export function deploymentCSV(p) {
  const rows = [
    [
      "행사명",
      "문서번호",
      "개정",
      "종류",
      "명칭",
      "담당팀",
      "수량·인원",
      "연락처",
      "운영 시작",
      "운영 종료",
      "배치 상태",
      "주차 수용대수",
      "대수 산정",
      "면적(m²)",
      "길이(m)",
      "위도",
      "경도",
      "그룹",
      "지도 표시",
      "업무지시",
    ],
  ];
  for (const o of p.objects) {
    const op = o.operations || {},
      c = o.position || center(o.path),
      capacity = parkingCapacity(o, p);
    rows.push([
      p.title,
      p.meta.plan?.documentNo,
      p.meta.plan?.revision,
      kindInfo(o)[0],
      o.name,
      op.team,
      o.type === "marker" ? op.quantity || 1 : "",
      op.contact,
      op.start,
      op.end,
      DEPLOY_STATUS[op.status] || "계획",
      capacity?.count ?? "",
      capacity ? (capacity.estimated ? "면적 추정" : "직접 입력") : "",
      o.type === "area" ? Math.round(area(o.path)) : "",
      o.type === "line" ? Math.round(length(o.path)) : "",
      c.lat.toFixed(6),
      c.lng.toFixed(6),
      o.group,
      o.visible && p.settings.layers[o.type] ? "표시" : "숨김",
      op.note,
    ]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
export function objectMeasure(o) {
  return o.type === "area"
    ? squareMeters(area(o.path))
    : o.type === "line"
      ? meters(length(o.path))
      : `${o.operations?.quantity || 1}${STAFF_KINDS.has(o.kind) ? "명" : "개"}`;
}

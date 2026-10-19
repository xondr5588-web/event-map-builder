import { newObject, uid, clone } from "./model.js";
import { center, pointsOf, validCoord } from "./geometry.js";
const R = 6371008.8,
  RAD = Math.PI / 180;
export function localPoint(origin, x, y, rotation = 0) {
  const t = rotation * RAD,
    a = x * Math.cos(t) - y * Math.sin(t),
    b = x * Math.sin(t) + y * Math.cos(t);
  const p = {
    lat: origin.lat - b / R / RAD,
    lng: origin.lng + a / (R * RAD * Math.cos(origin.lat * RAD)),
  };
  if (!validCoord(p)) throw new Error("배치가 지도 범위를 벗어났습니다.");
  return p;
}
export function localXY(origin, p) {
  return {
    x: (p.lng - origin.lng) * RAD * R * Math.cos(origin.lat * RAD),
    y: -(p.lat - origin.lat) * RAD * R,
  };
}
const bounded = (v, min, max) =>
  Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
export function nextNumber(existing, prefix, start = 1) {
  const used = new Set(existing.map((o) => o.details?.number));
  let n = start;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}
export function createFacilityBatch(config, origin, existing = []) {
  const {
    width = 3,
    depth = 3,
    rows = 1,
    columns = 5,
    gapX = 1,
    gapY = 3,
    rotation = 0,
    start = 1,
    prefix = "B",
    kind = "booth",
    name = "행사부스",
    group = "부스 배치",
  } = config;
  if (
    !validCoord(origin) ||
    ![width, depth].every((n) => bounded(n, 0.5, 1000)) ||
    ![rows, columns].every(
      (n) => Number.isInteger(Number(n)) && bounded(n, 1, 200),
    ) ||
    Number(rows) * Number(columns) > 200 ||
    ![gapX, gapY].every((n) => bounded(n, 0, 1000)) ||
    !bounded(rotation, -360, 360) ||
    !Number.isInteger(Number(start)) ||
    !bounded(start, 1, 99999)
  )
    throw new Error("규격·간격·수량을 확인하세요. 한 번에 최대 200개입니다.");
  if (existing.length + rows * columns > 10000)
    throw new Error("객체 한도(10,000개)를 초과합니다.");
  const out = [],
    bundle = uid();
  let serial = Number(start);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const x = (c - (columns - 1) / 2) * (Number(width) + Number(gapX)),
        y = (r - (rows - 1) / 2) * (Number(depth) + Number(gapY));
      const path = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) =>
        localPoint(origin, x + (a * width) / 2, y + (b * depth) / 2, rotation),
      );
      const number = nextNumber(
        [...existing, ...out],
        String(prefix).slice(0, 20),
        serial,
      );
      serial = Number(number.slice(String(prefix).slice(0, 20).length)) + 1;
      const o = newObject("area", kind, path, `${name} ${number}`);
      o.bundle = bundle;
      o.group = String(group).slice(0, 80);
      o.facility = {
        width: Number(width),
        depth: Number(depth),
        rotation: Number(rotation),
        mode: "rectangle",
      };
      o.details = { number, description: "", audience: "both", listed: true };
      o.label.text = number;
      o.style.opacity = 0.78;
      out.push(o);
    }
  return out;
}
export function transformGroup(
  objects,
  { rotate = 0, align = "", distribute = "" } = {},
) {
  const editable = objects.filter((o) => !o.locked);
  if (!editable.length) throw new Error("잠금 해제한 객체를 선택하세요.");
  if ((align || distribute) && editable.length < (distribute ? 3 : 2))
    throw new Error(
      distribute
        ? "균등 간격에는 3개 이상이 필요합니다."
        : "정렬에는 2개 이상이 필요합니다.",
    );
  const origin = center(editable.flatMap(pointsOf)),
    centers = editable.map((o) => localXY(origin, center(pointsOf(o)))),
    xs = centers.map((p) => p.x),
    ys = centers.map((p) => p.y);
  const targets = centers.map((p) => ({ ...p }));
  if (align) {
    const axis = ["left", "center", "right"].includes(align) ? "x" : "y";
    const values = axis === "x" ? xs : ys;
    const target = ["left", "top"].includes(align)
      ? Math.min(...values)
      : ["right", "bottom"].includes(align)
        ? Math.max(...values)
        : (Math.min(...values) + Math.max(...values)) / 2;
    targets.forEach((p) => (p[axis] = target));
  }
  if (distribute) {
    const axis = distribute === "horizontal" ? "x" : "y",
      order = centers
        .map((p, i) => ({ v: p[axis], i }))
        .sort((a, b) => a.v - b.v);
    const lo = order[0].v,
      span = order.at(-1).v - lo;
    order.forEach(
      (o, k) => (targets[o.i][axis] = lo + (span * k) / (order.length - 1)),
    );
  }
  return editable.map((original, i) => {
    const o = clone(original),
      dx = targets[i].x - centers[i].x,
      dy = targets[i].y - centers[i].y;
    const move = (p) => {
      const q = localXY(origin, p);
      return localPoint(origin, q.x + dx, q.y + dy, rotate);
    };
    if (o.position) o.position = move(o.position);
    else o.path = o.path.map(move);
    if (o.label.position) o.label.position = move(o.label.position);
    if (rotate) {
      o.rotation = (o.rotation + rotate) % 360;
      if (o.facility)
        o.facility.rotation = (o.facility.rotation + rotate) % 360;
    }
    return o;
  });
}
export function resizeFacility(o, width, depth, rotation) {
  if (o.locked) throw new Error("먼저 잠금을 해제하세요.");
  if (
    ![width, depth].every((n) => bounded(n, 0.5, 1000)) ||
    !bounded(rotation, -360, 360)
  )
    throw new Error("시설 규격을 확인하세요.");
  const origin = center(o.path);
  o.path = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) =>
    localPoint(origin, (a * width) / 2, (b * depth) / 2, rotation),
  );
  o.facility = {
    width: Number(width),
    depth: Number(depth),
    rotation: Number(rotation),
    mode: "rectangle",
  };
}

// Editable starting layout, positioned as one transaction; never replaces existing work.
export function createVenueKit(origin, existing = [], preset = "festival") {
  const festival = preset === "festival",
    title = festival ? "지역 축제" : "플리마켓",
    objects = [];
  const addBatch = (config, x, y) =>
    objects.push(
      ...createFacilityBatch(config, localPoint(origin, x, y), [
        ...existing,
        ...objects,
      ]),
    );
  addBatch(
    {
      kind: "booth",
      name: festival ? "체험부스" : "판매부스",
      rows: 2,
      columns: 6,
      width: 3,
      depth: 3,
      gapX: 1,
      gapY: 9,
      prefix: "B",
      group: `${title} 부스`,
    },
    0,
    12,
  );
  addBatch(
    {
      kind: "stage",
      name: "메인 무대",
      rows: 1,
      columns: 1,
      width: 10,
      depth: 6,
      prefix: "S",
      group: "무대",
    },
    0,
    -22,
  );
  addBatch(
    {
      kind: "seating",
      name: "관람석",
      rows: 1,
      columns: 1,
      width: 18,
      depth: 12,
      prefix: "A",
      group: "관람 구역",
    },
    0,
    -9,
  );
  addBatch(
    {
      kind: "food",
      name: "먹거리",
      rows: 1,
      columns: 4,
      width: 3,
      depth: 3,
      gapX: 1,
      prefix: "F",
      group: "먹거리",
    },
    0,
    29,
  );
  const resources = [
    ["info", "안내소", -22, 20, "I"],
    ["medical", "응급의료", 22, -12, "M"],
    ["toilet", "화장실", 25, 26, "W"],
    ["police", "경찰부스", -25, -12, "P"],
    ["fire", "소방 대기소", 25, -23, "E"],
    ["command", "운영본부", -25, -23, "C"],
    ["assembly", "비상 집결지", 32, 6, "Z"],
  ];
  for (const [k, name, x, y, prefix] of resources) {
    const o = newObject("marker", k, [localPoint(origin, x, y)], name);
    o.details.number = nextNumber([...existing, ...objects], prefix);
    o.details.listed = true;
    objects.push(o);
  }
  const note = newObject(
    "marker",
    "note",
    [localPoint(origin, 0, 40)],
    "배치 안내",
  );
  note.annotation.text =
    "기본 배치안 · 현장에 맞게 시설 위치와 동선을 확인하세요";
  note.annotation.width = 300;
  objects.push(note);
  if (existing.length + objects.length > 10000)
    throw new Error("객체 수 한도를 초과합니다.");
  return objects;
}

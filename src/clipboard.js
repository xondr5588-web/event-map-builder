import { clone, uid } from "./model.js";
import { pointsOf, validCoord } from "./geometry.js";

// The app clipboard never reads or overwrites the device's text clipboard.
export function makeCopies(objects, existing = []) {
  if (objects.length + existing.length > 10000)
    throw new Error("프로젝트당 객체는 10,000개까지 붙여넣을 수 있습니다.");
  const vertices = [...existing, ...objects].reduce(
    (n, o) => n + pointsOf(o).length,
    0,
  );
  if (vertices > 200000)
    throw new Error("프로젝트의 꼭짓점 한도(200,000개)를 초과합니다.");
  const names = new Set(existing.map((o) => o.name));
  return objects.map((original) => {
    const o = clone(original),
      base = `${original.name} 사본`;
    let name = base,
      n = 2;
    while (names.has(name)) name = `${base} ${n++}`;
    names.add(name);
    o.id = uid();
    o.name = name;
    if (o.label.text === original.name) o.label.text = name;
    o.locked = false;
    o.visible = true;
    return o;
  });
}

// Translate all geometry in the same projection as the displayed map. Explicit
// geographic label anchors move too; pixel label offsets remain unchanged.
export function positionCopies(
  objects,
  map,
  target = null,
  offset = { x: 0, y: 0 },
) {
  if (!objects.length) return [];
  if (target && !validCoord(target))
    throw new Error("붙여넣기 위치가 올바르지 않습니다.");
  const points = objects.flatMap(pointsOf).map((p) => map.project(p));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const origin = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    at = target ? map.project(target) : origin,
    dx = at.x - origin.x + offset.x,
    dy = at.y - origin.y + offset.y;
  const move = (p) => {
    const q = map.project(p),
      moved = map.unproject({ x: q.x + dx, y: q.y + dy });
    if (!validCoord(moved))
      throw new Error("붙여넣기 위치가 지도 범위를 벗어났습니다.");
    return moved;
  };
  return objects.map((o) => ({
    ...o,
    ...(o.type === "marker"
      ? { position: move(o.position) }
      : { path: o.path.map(move) }),
    label: {
      ...o.label,
      ...(o.label.position ? { position: move(o.label.position) } : {}),
    },
  }));
}

import test from "node:test";
import assert from "node:assert/strict";
import { makeCopies, positionCopies } from "../src/clipboard.js";
import {
  newProject,
  newObject,
  clone,
  exportProject,
  parseImport,
} from "../src/model.js";
import { world, unworld, pointsOf } from "../src/geometry.js";
import { History } from "../src/history.js";
const map = {
  project: (p) => world(p, 17),
  unproject: (p) => unworld(p, 17),
};
function drawing() {
  const p = newProject(),
    a = { lat: 35.2, lng: 128.22 },
    b = { lat: 35.201, lng: 128.221 },
    c = { lat: 35.201, lng: 128.22 };
  p.objects = [
    newObject("marker", "parkingStaff", [a], "동측 A팀"),
    newObject("marker", "police", [b], "경찰 협조"),
    newObject("line", "vehicle", [a, b], "진입 동선"),
    newObject("area", "parking", [a, b, c], "주차 A"),
  ];
  const o = p.objects[0];
  o.locked = true;
  o.rotation = 45;
  o.style.markerSize = 48;
  o.label = {
    ...o.label,
    text: " A구역 대기 ",
    dx: 32,
    dy: -20,
    manual: true,
    position: b,
  };
  o.group = "교통 운영 1팀";
  o.operations.team = "동측 배치";
  o.operations.quantity = 3;
  return p;
}
test("copies are independent snapshots with fresh IDs, unlocked state and all field data", () => {
  const p = drawing(),
    before = clone(p);
  const copies = makeCopies(p.objects, p.objects);
  assert.equal(new Set([...p.objects, ...copies].map((o) => o.id)).size, 8);
  for (let i = 0; i < copies.length; i++) {
    assert.equal(copies[i].locked, false);
    assert.equal(copies[i].visible, true);
    assert.deepEqual(copies[i].operations, p.objects[i].operations);
    assert.deepEqual(copies[i].style, p.objects[i].style);
    assert.equal(copies[i].rotation, p.objects[i].rotation);
    assert.equal(copies[i].group, p.objects[i].group);
  }
  assert.equal(copies[0].label.text, " A구역 대기 ");
  assert.equal(copies[1].label.text, copies[1].name);
  copies[0].operations.team = "사본 수정";
  copies[0].style.markerSize = 24;
  assert.deepEqual(p, before);
});
test("repeated and multi-object copies use collision-free names while preserving custom labels", () => {
  const p = drawing(),
    source = p.objects[0];
  const first = makeCopies([source], p.objects);
  const next = makeCopies([source, source], [...p.objects, ...first]);
  assert.deepEqual(
    [first[0].name, ...next.map((o) => o.name)],
    ["동측 A팀 사본", "동측 A팀 사본 2", "동측 A팀 사본 3"],
  );
  assert.equal(next[0].label.text, source.label.text);
});
test("positioning a mixed selection preserves projected spacing, manual label anchors and pixel offsets", () => {
  const p = drawing(),
    before = clone(p),
    target = { lat: 35.25, lng: 128.3 };
  const moved = positionCopies(p.objects, map, target),
    origin = map.project(p.objects[0].position),
    placed = map.project(moved[0].position),
    dx = placed.x - origin.x,
    dy = placed.y - origin.y;
  for (let i = 0; i < p.objects.length; i++) {
    pointsOf(p.objects[i]).forEach((point, j) => {
      const a = map.project(point),
        b = map.project(pointsOf(moved[i])[j]);
      assert.ok(Math.abs(b.x - a.x - dx) < 1e-6);
      assert.ok(Math.abs(b.y - a.y - dy) < 1e-6);
    });
  }
  const oldLabel = map.project(p.objects[0].label.position),
    label = map.project(moved[0].label.position);
  assert.ok(Math.abs(label.x - oldLabel.x - dx) < 1e-6);
  assert.ok(Math.abs(label.y - oldLabel.y - dy) < 1e-6);
  assert.equal(moved[0].label.dx, 32);
  assert.equal(moved[0].label.dy, -20);
  assert.deepEqual(p, before);
});
test("nearby duplication shifts geometry exactly without mutating clipboard templates", () => {
  const p = drawing(),
    before = clone(p.objects),
    copies = positionCopies(p.objects, map, null, { x: 36, y: 36 });
  const a = map.project(p.objects[0].position),
    b = map.project(copies[0].position);
  assert.ok(Math.abs(b.x - a.x - 36) < 1e-6);
  assert.ok(Math.abs(b.y - a.y - 36) < 1e-6);
  assert.deepEqual(p.objects, before);
  assert.throws(
    () => positionCopies(p.objects, map, { lat: NaN, lng: 128 }),
    /위치/,
  );
  assert.deepEqual(positionCopies([], map, null), []);
});
test("a whole paste round-trips JSON and forms a single Undo/Redo step", () => {
  const p = drawing(),
    before = clone(p),
    history = new History();
  p.objects.push(
    ...positionCopies(makeCopies(p.objects, p.objects), map, {
      lat: 35.3,
      lng: 128.4,
    }),
  );
  history.record(before, p, "객체 붙여넣기");
  const imported = parseImport(exportProject(p)).projects[0];
  assert.deepEqual(imported.objects, p.objects);
  const undone = history.undo(p);
  assert.deepEqual(undone.objects, before.objects);
  assert.deepEqual(history.redo(undone).objects, p.objects);
});
test("copy limits prevent creating a project that cannot be imported later", () => {
  const o = drawing().objects[0];
  assert.throws(() => makeCopies([o], Array(10000).fill(o)), /10,000/);
  const line = { ...o, type: "line", path: Array(200000).fill(o.position) };
  assert.throws(() => makeCopies([o], [line]), /200,000/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  migrate,
  newProject,
  newObject,
  exportProject,
  parseImport,
  clone,
} from "../src/model.js";
import { History } from "../src/history.js";
import { distance, area, world, unworld, samples } from "../src/geometry.js";
const a = { lat: 35, lng: 128 },
  b = { lat: 35, lng: 128.001 },
  c = { lat: 35.001, lng: 128 };
const legacy = {
  areas: [{ id: "same", kind: "parking", name: "A", path: [a, b, c] }],
  lines: [{ id: "same", kind: "oneway", name: "차량", path: [a, b] }],
  markers: [
    {
      id: "m",
      kind: "staff",
      name: "담당자",
      ...a,
      rotation: 30,
      labelText: "근무자",
      labelDx: 22,
      labelDy: -30,
      labelVisible: false,
    },
  ],
  meta: { title: "구버전", note: "운영 메모" },
};
test("v10 data retains coordinates, labels, rotation and names; repairs duplicate IDs", () => {
  const { project: p, warnings } = migrate(legacy);
  assert.equal(p.title, "구버전");
  assert.equal(p.objects.length, 3);
  assert.deepEqual(p.objects[0].path, [a, b, c]);
  assert.equal(new Set(p.objects.map((x) => x.id)).size, 3);
  assert.equal(warnings.length, 1);
  assert.equal(p.objects[2].kind, "parkingStaff");
  assert.equal(p.objects[2].rotation, 30);
  assert.deepEqual(p.objects[2].label, {
    text: "근무자",
    visible: false,
    dx: 22,
    dy: -30,
    manual: true,
  });
});
test("oldest parking / flow / staff data is migrated", () => {
  const p = migrate({
    parking: [{ name: "관계자", path: [a, b, c] }],
    flow: [{ name: "라바콘", path: [a, b] }],
    staff: [{ name: "직원", ...a }],
  }).project;
  assert.deepEqual(
    p.objects.map((o) => o.kind),
    ["vip", "cone", "parkingStaff"],
  );
});
test("autosave envelope and label geographic anchors are supported", () => {
  const raw = clone(legacy);
  raw.markers[0].labelLat = 35.01;
  raw.markers[0].labelLng = 128.01;
  assert.deepEqual(
    migrate({ data: raw, ts: 123 }).project.objects[2].label.position,
    { lat: 35.01, lng: 128.01 },
  );
});
test("roundtrip preserves all current fields", () => {
  const p = newProject("행사");
  p.objects = [
    newObject("area", "vip", [a, b, c]),
    newObject("marker", "stage", [b]),
  ];
  p.objects[0].locked = true;
  p.objects[0].style.opacity = 0;
  p.objects[1].label.position = c;
  assert.deepEqual(parseImport(exportProject(p)).projects[0], p);
});
test("strict import rejects malformed JSON, invalid geometry, null coords and future schema", () => {
  for (const raw of [
    "not json",
    "{}",
    JSON.stringify({ schemaVersion: 99, objects: [] }),
    JSON.stringify({ markers: [{ lat: null, lng: 128 }] }),
    JSON.stringify({ areas: [{ name: "오류", path: [a, b] }] }),
    JSON.stringify({ markers: [{ lat: 100, lng: 128 }] }),
  ])
    assert.throws(() => parseImport(raw));
});
test("empty legacy project is valid", () =>
  assert.equal(
    migrate({ areas: [], lines: [], markers: [] }).project.objects.length,
    0,
  ));
test("history undoes creation, style, label movement, deletion and redo in order", () => {
  const h = new History(),
    p = newProject();
  const initial = clone(p);
  p.objects.push(newObject("marker", "parkingStaff", [a]));
  h.record(initial, p, "create");
  const created = clone(p);
  p.objects[0].label.dx = 60;
  p.objects[0].style.color = "#ffffff";
  h.record(created, p, "style");
  const styled = clone(p);
  p.objects = [];
  h.record(styled, p, "delete");
  let current = h.undo(p);
  assert.deepEqual(current.objects, styled.objects);
  current = h.undo(current);
  assert.deepEqual(current.objects, created.objects);
  current = h.undo(current);
  assert.equal(current.objects.length, 0);
  for (let i = 0; i < 3; i++) current = h.redo(current);
  assert.equal(current.objects.length, 0);
});
test("redo clears after new change, and history is bounded", () => {
  const h = new History(5);
  let p = newProject();
  for (let i = 0; i < 20; i++) {
    const prev = clone(p);
    p.objects.push(newObject("marker", "stage", [a]));
    h.record(prev, p, "create");
  }
  assert.equal(h.undoStack.length, 5);
  p = h.undo(p);
  const before = clone(p);
  p.title = "수정";
  h.record(before, p, "title");
  assert.equal(h.redoStack.length, 0);
});
test("bulk reordering and settings are undoable", () => {
  const h = new History(),
    p = newProject();
  p.objects = [
    newObject("marker", "stage", [a]),
    newObject("marker", "control", [b]),
  ];
  const old = clone(p);
  p.objects.reverse();
  p.settings.layers.marker = false;
  h.record(old, p, "reorder");
  assert.deepEqual(h.undo(p), old);
});
test("measurements and projection are finite and accurate at local scale", () => {
  assert.ok(
    Math.abs(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 2,
  );
  assert.ok(area([a, b, c]) > 4000 && area([a, b, c]) < 6000);
  const p = unworld(world(a, 16), 16);
  assert.ok(Math.abs(p.lat - a.lat) < 1e-9);
  assert.ok(Math.abs(p.lng - a.lng) < 1e-9);
  assert.equal(samples([a, a], 7).length, 0);
  assert.ok(samples([a, b], 1, 20).length <= 20);
});

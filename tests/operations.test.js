import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newObject,
  migrate,
  exportProject,
  parseImport,
  clone,
} from "../src/model.js";
import { zoomScale, elementScale } from "../src/scaling.js";
import {
  parkingCapacity,
  operationalSummary,
  deploymentCSV,
} from "../src/operations.js";
import { History } from "../src/history.js";
const point = { lat: 35.2, lng: 128.2 };
test("map scale doubles every level, combines object size and keeps a fixed-screen option", () => {
  const p = newProject(),
    o = newObject("marker", "parkingStaff", [point]);
  assert.equal(elementScale(p, o, 16), 1);
  assert.equal(elementScale(p, o, 17), 2);
  assert.equal(elementScale(p, o, 14), 0.25);
  o.style.scale = 2;
  p.settings.symbolSize = 1.5;
  assert.equal(elementScale(p, o, 17), 6);
  p.settings.scaleWithMap = false;
  assert.equal(zoomScale(p, 19), 1);
  assert.equal(elementScale(p, o, 19), 3);
});
test("pre-upgrade projects preserve their saved appearance and gain operational defaults", () => {
  const p = newProject();
  p.view.zoom = 18;
  delete p.settings.referenceZoom;
  delete p.settings.scaleWithMap;
  delete p.settings.symbolSize;
  delete p.meta.plan;
  const o = newObject("marker", "parkingStaff", [point]);
  delete o.operations;
  delete o.style.scale;
  p.objects = [o];
  const n = migrate(p).project;
  assert.equal(n.settings.referenceZoom, 18);
  assert.equal(elementScale(n, n.objects[0], 18), 1);
  assert.equal(n.objects[0].operations.quantity, 1);
  assert.equal(n.meta.plan.parkingAreaPerCar, 30);
  assert.deepEqual(parseImport(exportProject(n)).projects[0], n);
});
test("parking estimates use the configured density and manual zero capacity is preserved", () => {
  const p = newProject(),
    o = newObject("area", "parking", [
      point,
      { lat: 35.201, lng: 128.2 },
      { lat: 35.201, lng: 128.201 },
      { lat: 35.2, lng: 128.201 },
    ]);
  const first = parkingCapacity(o, p);
  p.meta.plan.parkingAreaPerCar = 60;
  assert.ok(parkingCapacity(o, p).count <= first.count / 2);
  o.operations.capacity = 0;
  assert.deepEqual(parkingCapacity(o, p), { count: 0, estimated: false });
  o.operations.capacity = 123;
  p.objects = [o];
  assert.equal(migrate(p).project.objects[0].operations.capacity, 123);
});
test("summary counts people separately from facilities and excludes hidden layers", () => {
  const p = newProject();
  for (const [k, q] of [
    ["parkingStaff", 4],
    ["safetyStaff", 3],
    ["police", 2],
  ]) {
    const o = newObject("marker", k, [point]);
    o.operations.quantity = q;
    o.operations.team = "A팀";
    p.objects.push(o);
  }
  const s = operationalSummary(p);
  assert.equal(s.staff, 7);
  assert.equal(s.teams, 1);
  assert.equal(s.resources.find((r) => r.kind === "police").count, 2);
  p.objects[0].visible = false;
  assert.equal(operationalSummary(p).staff, 3);
  p.settings.layers.marker = false;
  assert.equal(operationalSummary(p).staff, 0);
});
test("CSV includes deployment fields, unicode, coordinates and neutralizes spreadsheet formulas", () => {
  const p = newProject("행사");
  const o = newObject("marker", "guideStaff", [point], '=HYPERLINK("x")');
  o.operations.team = "가팀";
  o.operations.note = "주의\n안내";
  o.operations.quantity = 6;
  p.objects = [o];
  const csv = deploymentCSV(p);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("가팀"));
  assert.ok(csv.includes("\"'=HYPERLINK("));
  assert.ok(csv.includes("35.200000"));
  assert.ok(csv.includes("주의\n안내"));
});
test("operational plan and assignments participate in undo, redo and file roundtrip", () => {
  let p = newProject();
  p.objects = [newObject("marker", "parkingStaff", [point])];
  const h = new History(),
    before = clone(p);
  p.meta.plan.organizer = "김해시";
  p.meta.plan.documentNo = "운영-01";
  p.objects[0].operations.team = "교통1팀";
  p.objects[0].operations.quantity = 8;
  h.record(before, p, "배치 계획");
  const undo = h.undo(p);
  assert.equal(undo.objects[0].operations.quantity, 1);
  const redo = h.redo(undo);
  assert.equal(redo.meta.plan.organizer, "김해시");
  assert.equal(redo.objects[0].operations.quantity, 8);
  assert.deepEqual(
    parseImport(exportProject(redo)).projects[0].objects,
    redo.objects,
  );
});

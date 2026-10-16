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
import { zoomScale, elementScale, labelScale } from "../src/scaling.js";
import {
  parkingCapacity,
  operationalSummary,
  deploymentCSV,
} from "../src/operations.js";
import { History } from "../src/history.js";
const point = { lat: 35.2, lng: 128.2 };
test("explicit proportional mode retains zoom ratios and saved size preferences", () => {
  const p = newProject(),
    o = newObject("marker", "parkingStaff", [point]);
  p.settings.autoSize = false;
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
test("pre-upgrade projects gain automatic sizing while retaining coordinates and saved preferences", () => {
  const p = newProject();
  p.view.zoom = 18;
  delete p.settings.autoSize;
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
  assert.equal(n.settings.autoSize, true);
  assert.deepEqual(n.objects[0].position, point);
  assert.equal(n.objects[0].style.scale, 1);
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
    ["booth", 5],
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
  assert.equal(s.resources.find((r) => r.kind === "booth").count, 5);
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

test("automatic annotations remain bounded across zoom, large preferences and compact viewports", () => {
  const p = newProject(),
    o = newObject("marker", "control", [point]);
  for (const viewport of [
    { width: 390, height: 851 },
    { width: 320, height: 568 },
    { width: 844, height: 286 },
    { width: 1130, height: 830 },
  ]) {
    const small = viewport.width <= 600 || viewport.height <= 450;
    let previous = 0;
    for (let zoom = 6; zoom <= 21; zoom++) {
      const scale = elementScale(p, o, zoom, viewport),
        label = labelScale(p, o, zoom, viewport);
      assert.ok(scale >= previous);
      previous = scale;
      assert.ok(55 * scale <= (small ? 42 : 49));
      assert.ok(12 * label >= 9.9 && 12 * label <= 13.5);
    }
  }
  p.settings.symbolSize = 3;
  o.style.scale = 4;
  const before = clone(p);
  assert.ok(55 * elementScale(p, o, 21, { width: 390, height: 851 }) <= 42);
  assert.ok(labelScale(p, o, 21, { width: 390, height: 851 }) <= 1.05);
  assert.deepEqual(p, before);
  p.settings.scaleWithMap = false;
  assert.equal(elementScale(p, o, 6), elementScale(p, o, 21));
  p.settings.autoSize = false;
  assert.equal(
    parseImport(exportProject(p)).projects[0].settings.autoSize,
    false,
  );
});

test("manual marker sizes bypass automatic caps, stay fixed across zoom and leave lines and labels alone", () => {
  const p = newProject(),
    marker = newObject("marker", "police", [point]);
  const line = newObject("line", "vehicle", [
    point,
    { lat: 35.201, lng: 128.201 },
  ]);
  const oldLine = elementScale(p, line, 17),
    oldLabel = labelScale(p, marker, 17);
  p.settings.markerSize = 72;
  for (const zoom of [6, 17, 21])
    assert.equal(
      elementScale(p, marker, zoom, { width: 320, height: 568 }),
      72 / 50,
    );
  assert.equal(elementScale(p, line, 17), oldLine);
  assert.equal(labelScale(p, marker, 17), oldLabel);
  marker.style.markerSize = 20;
  assert.equal(elementScale(p, marker, 17), 0.4);
  p.settings.markerSize = 96;
  assert.equal(elementScale(p, marker, 21), 0.4);
  marker.style.markerSize = null;
  assert.equal(elementScale(p, marker, 21), 96 / 50);
  p.settings.markerSize = null;
  assert.ok(elementScale(p, marker, 21) < 1);
});
test("manual sizes migrate safely, persist in JSON and undo independently of assignments and coordinates", () => {
  const p = newProject();
  p.objects = [newObject("marker", "fire", [point])];
  p.objects[0].operations.team = "소방 A팀";
  const original = clone(p),
    h = new History();
  p.settings.markerSize = 24;
  p.objects[0].style.markerSize = 48;
  h.record(original, p, "sizes");
  assert.deepEqual(parseImport(exportProject(p)).projects[0], p);
  assert.deepEqual(h.undo(p), original);
  assert.deepEqual(h.redo(original), p);
  p.settings.markerSize = 999;
  p.objects[0].style.markerSize = -2;
  const clean = migrate(p).project;
  assert.equal(clean.settings.markerSize, 96);
  assert.equal(clean.objects[0].style.markerSize, 16);
  assert.deepEqual(clean.objects[0].position, point);
  assert.equal(clean.objects[0].operations.team, "소방 A팀");
  delete p.settings.markerSize;
  delete p.objects[0].style.markerSize;
  assert.equal(migrate(p).project.settings.markerSize, null);
  assert.equal(migrate(p).project.objects[0].style.markerSize, null);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newObject,
  migrate,
  parseImport,
  exportProject,
  clone,
} from "../src/model.js";
import {
  createFacilityBatch,
  transformGroup,
  resizeFacility,
} from "../src/venue.js";
import { distance, area, center, boundsXY } from "../src/geometry.js";
import {
  normalizeProgram,
  programConflicts,
  parseProgramTable,
  programCSV,
  isDisplayed,
  directory,
  programVenue,
} from "../src/event-data.js";
import { publicationProject } from "../src/event-data.js";
import { makeCopies } from "../src/clipboard.js";
import { History } from "../src/history.js";
const origin = { lat: 35.2, lng: 128.2 };
test("meter-based rotated batch preserves dimensions, sequence, center and import/export", () => {
  const p = newProject();
  p.objects = createFacilityBatch(
    {
      rows: 3,
      columns: 8,
      width: 3,
      depth: 6,
      gapX: 2,
      gapY: 5,
      rotation: 37,
      start: 7,
      prefix: "A",
    },
    origin,
  );
  assert.equal(p.objects.length, 24);
  assert.equal(p.objects[0].details.number, "A7");
  assert.equal(p.objects.at(-1).details.number, "A30");
  for (const o of p.objects) {
    assert.ok(Math.abs(distance(o.path[0], o.path[1]) - 3) < 0.01);
    assert.ok(Math.abs(distance(o.path[1], o.path[2]) - 6) < 0.01);
    assert.ok(Math.abs(area(o.path) - 18) < 0.05);
  }
  assert.ok(distance(center(p.objects.flatMap((o) => o.path)), origin) < 0.01);
  assert.deepEqual(parseImport(exportProject(p)).projects[0], p);
  assert.throws(
    () => createFacilityBatch({ rows: 20, columns: 20 }, origin),
    /200/,
  );
});
test("facility copies retain internal grouping but allocate independent groups and numbers", () => {
  const first = createFacilityBatch({ rows: 1, columns: 3 }, origin),
    copies = makeCopies(first, first);
  assert.notEqual(copies[0].bundle, first[0].bundle);
  assert.equal(copies[0].bundle, copies[2].bundle);
  assert.equal(
    new Set([...first, ...copies].map((o) => o.details.number)).size,
    6,
  );
  const next = createFacilityBatch({ rows: 1, columns: 3 }, origin, first);
  assert.equal(next[0].details.number, "B4");
});
test("group rotation, alignment, distribution and locked objects use one history operation", () => {
  const p = newProject();
  p.objects = createFacilityBatch({ rows: 1, columns: 3, gapX: 2 }, origin);
  p.objects[0].locked = true;
  const before = clone(p),
    updated = transformGroup(p.objects, { rotate: 90 });
  const byId = new Map(updated.map((o) => [o.id, o]));
  p.objects = p.objects.map((o) => byId.get(o.id) || o);
  assert.deepEqual(p.objects[0], before.objects[0]);
  assert.notDeepEqual(p.objects[1].path, before.objects[1].path);
  const h = new History();
  h.record(before, p, "rotate");
  const undone = h.undo(p);
  assert.deepEqual(undone.objects, before.objects);
  Object.assign(p, h.redo(undone));
  assert.equal(p.objects[1].facility.rotation, 90);
  const a = transformGroup(
    before.objects.map((o) => ({ ...o, locked: false })),
    { align: "middle", distribute: "horizontal" },
  );
  assert.ok(Math.abs(center(a[0].path).lat - center(a[2].path).lat) < 1e-8);
  resizeFacility(p.objects[1], 8, 4, 20);
  assert.ok(Math.abs(area(p.objects[1].path) - 32) < 0.05);
});
test("version 1 migrates with safe visitor defaults and keeps old geometry and data", () => {
  const p = newProject(),
    o = newObject("marker", "parkingStaff", [origin]);
  p.objects = [o];
  p.schemaVersion = 1;
  delete p.meta.event;
  delete p.objects[0].details;
  const n = migrate(p).project;
  assert.equal(n.schemaVersion, 2);
  assert.deepEqual(n.objects[0].position, origin);
  assert.equal(n.objects[0].details.audience, "internal");
  assert.ok(n.meta.event);
  assert.throws(() => migrate({ ...p, schemaVersion: 50 }), /버전/);
});
test("CSV quoted descriptions, Excel TSV, invalid date/time and cross-day conflicts", () => {
  const list = parseProgramTable(
    '날짜,시작,종료,프로그램,장소,설명\n2026-10-19,10:00,11:00,개막식,무대,"안내, 설명\n두번째 줄"',
  );
  assert.equal(list[0].description, "안내, 설명\n두번째 줄");
  const other = parseProgramTable(
    "날짜\t시작\t종료\t프로그램\t장소\n2026-10-19\t10:30\t11:30\t공연\t무대",
  );
  assert.equal(programConflicts([...list, ...other]).length, 1);
  assert.throws(
    () => normalizeProgram({ ...list[0], date: "2026-02-30" }),
    /날짜/,
  );
  assert.throws(() => normalizeProgram({ ...list[0], end: "09:00" }), /종료/);
  const night = normalizeProgram({
    ...list[0],
    start: "23:00",
    end: "01:00",
    endDate: "2026-10-20",
  });
  assert.equal(
    programConflicts([
      night,
      normalizeProgram({
        ...other[0],
        date: "2026-10-20",
        endDate: "2026-10-20",
        start: "00:30",
        end: "02:00",
      }),
    ]).length,
    1,
  );
  const p = newProject();
  assert.equal(
    parseProgramTable(programCSV(list, p))[0].description,
    list[0].description,
  );
});
test("visitor publication redacts assignments, hidden internal objects, private notes and programs", () => {
  const p = newProject();
  p.meta.plan.phone = "010-SECRET";
  p.meta.plan.manager = "INTERNAL_MANAGER";
  p.meta.note = "INTERNAL_NOTE";
  const staff = newObject("marker", "parkingStaff", [origin]),
    booth = createFacilityBatch({ rows: 1, columns: 1 }, origin)[0];
  booth.operations.contact = "PRIVATE_CONTACT";
  p.objects = [staff, booth];
  p.meta.event.programs = [
    normalizeProgram({
      date: "2026-10-19",
      start: "10:00",
      end: "11:00",
      title: "PRIVATE_PROGRAM",
      public: false,
    }),
  ];
  const safe = publicationProject(p);
  const json = JSON.stringify(safe);
  for (const secret of [
    "010-SECRET",
    "INTERNAL_MANAGER",
    "INTERNAL_NOTE",
    "PRIVATE_CONTACT",
    "PRIVATE_PROGRAM",
    "parkingStaff",
  ])
    assert.ok(!json.includes(secret), secret);
  assert.equal(safe.objects.length, 1);
  assert.equal(directory(safe).length, 1);
  assert.equal(isDisplayed(p, staff, { mode: "visitor" }), false);
  p.objects[1].name = "새 무대";
  assert.equal(programVenue({ placeId: booth.id }, p), "새 무대");
});

test("publication bounds support the full 200,000-vertex import limit", () => {
  const points = Array.from({ length: 200000 }, (_, i) => ({
    x: i - 100000,
    y: i % 10,
  }));
  assert.deepEqual(boundsXY(points), {
    left: -100000,
    right: 99999,
    top: 0,
    bottom: 9,
  });
});

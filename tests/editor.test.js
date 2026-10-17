import test from "node:test";
import assert from "node:assert/strict";
import { Editor } from "../src/editor.js";
import { newProject, newObject, clone } from "../src/model.js";
import { History } from "../src/history.js";

function fixture({ locked = false, multi = false } = {}) {
  let p = newProject();
  p.objects = [newObject("marker", "parkingStaff", [{ lat: 35, lng: 128 }])];
  p.objects[0].locked = locked;
  const history = new History(),
    calls = { pan: 0, renamed: [], views: 0 };
  const svg = {
    addEventListener() {},
    focus() {},
    setPointerCapture() {},
    clientWidth: 400,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }),
  };
  const map = {
    view: { zoom: 16 },
    project: (q) => ({
      x: 200 + (q.lng - 128) * 1000,
      y: 300 - (q.lat - 35) * 1000,
    }),
    unproject: (q) => ({
      lat: 35 - (q.y - 300) / 1000,
      lng: 128 + (q.x - 200) / 1000,
    }),
    panPixels() {
      calls.pan++;
    },
    zoom() {},
  };
  const editor = new Editor(
    svg,
    map,
    {},
    {
      project: () => p,
      restore: (x) => {
        p = x;
      },
      commit: (before, label) => history.record(before, p, label),
      viewChanged: () => calls.views++,
      modeChanged() {},
      selectionChanged() {},
      multi: () => multi,
      rename: (id) => calls.renamed.push(id),
      haptic() {},
    },
  );
  editor.request = () => {};
  function event(x = 200, y = 300, handle = null, id = 1, hit = true) {
    const object = {
      dataset: { object: p.objects[0].id },
      querySelector: () => null,
    };
    return {
      clientX: x,
      clientY: y,
      pointerId: id,
      button: 0,
      pointerType: "mouse",
      preventDefault() {},
      target: {
        closest: (s) =>
          s === "[data-object]"
            ? hit
              ? object
              : null
            : s === "[data-handle]" && handle
              ? { dataset: { handle } }
              : null,
      },
    };
  }
  return { editor, event, map, calls, history, project: () => p };
}
test("ordinary marker drag selects and moves without edit mode; a tap allocates no preview", () => {
  const f = fixture(),
    before = clone(f.project());
  f.editor.down(f.event());
  assert.equal(f.editor.editing, false);
  assert.equal(f.editor.preview, undefined);
  assert.equal(f.editor.selection.has(before.objects[0].id), true);
  f.editor.move(f.event(235, 280));
  f.editor.up(f.event(235, 280));
  assert.notDeepEqual(
    f.project().objects[0].position,
    before.objects[0].position,
  );
  assert.equal(f.calls.pan, 0);
  assert.equal(f.history.undoStack.length, 1);
  assert.deepEqual(f.history.undo(f.project()).objects, before.objects);
});
test("label taps request name editing while a small tap preserves marker coordinates", () => {
  const f = fixture(),
    before = clone(f.project());
  f.editor.down(f.event(200, 334, "label"));
  f.editor.up(f.event(200, 334, "label"));
  assert.deepEqual(f.calls.renamed, [before.objects[0].id]);
  assert.deepEqual(f.project(), before);
  assert.equal(f.history.undoStack.length, 0);
});
test("locked, pan-mode and multiselect marker gestures never move objects", () => {
  for (const options of [{ locked: true }, { multi: true }, {}]) {
    const f = fixture(options),
      before = clone(f.project());
    if (!options.locked && !options.multi) f.editor.setMode("pan");
    f.editor.down(f.event());
    f.editor.move(f.event(230, 320));
    f.editor.up(f.event(230, 320));
    assert.deepEqual(f.project(), before);
    assert.equal(f.calls.pan, 1);
    assert.equal(f.history.undoStack.length, 0);
  }
});
test("cancelled marker drag and a second finger discard previews without history", () => {
  const f = fixture(),
    before = clone(f.project());
  f.editor.down(f.event());
  f.editor.move(f.event(235, 280));
  f.editor.cancelGesture();
  assert.deepEqual(f.project(), before);
  assert.equal(f.history.undoStack.length, 0);
  f.editor.down(f.event());
  f.editor.move(f.event(235, 280));
  f.editor.down(f.event(260, 300, null, 2));
  assert.equal(f.editor.preview, null);
  assert.equal(f.editor.drag, null);
  f.editor.up(f.event());
  f.editor.up(f.event(260, 300, null, 2));
  assert.deepEqual(f.project(), before);
  assert.equal(f.history.undoStack.length, 0);
});
test("pending name changes finish before starting a drag snapshot", () => {
  const f = fixture();
  f.editor.cb.beforePointer = () => {
    f.project().objects[0].name = "새 이름";
    return true;
  };
  f.editor.down(f.event());
  f.editor.move(f.event(230, 320));
  f.editor.up(f.event(230, 320));
  assert.equal(f.project().objects[0].name, "새 이름");
  assert.equal(f.history.undo(f.project()).objects[0].name, "새 이름");
});

import test from "node:test";
import assert from "node:assert/strict";
import { MapAdapter } from "../src/map.js";
test("SDK overlay-pane offsets are converted relative to the current map center", () => {
  const previous = globalThis.window;
  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  }
  class LatLng {
    constructor(lat, lng) {
      this.a = lat;
      this.b = lng;
    }
    lat() {
      return this.a;
    }
    lng() {
      return this.b;
    }
  }
  globalThis.window = { naver: { maps: { Point, LatLng } } };
  try {
    let c = new LatLng(35, 128);
    const projection = {
      fromCoordToOffset: (q) =>
        new Point(q.lng() * 100 + 1234, -q.lat() * 100 - 987),
      fromOffsetToCoord: (q) =>
        new LatLng(-(q.y + 987) / 100, (q.x - 1234) / 100),
    };
    const adapter = Object.create(MapAdapter.prototype);
    adapter.el = { clientWidth: 800, clientHeight: 600 };
    adapter.online = true;
    adapter.map = { getProjection: () => projection, getCenter: () => c };
    assert.deepEqual(adapter.project({ lat: 35, lng: 128 }), {
      x: 400,
      y: 300,
    });
    c = new LatLng(35.2, 127.7);
    assert.deepEqual(adapter.project({ lat: 35, lng: 128 }), {
      x: 430,
      y: 320,
    });
    const original = { lat: 35.6, lng: 128.4 },
      roundtrip = adapter.unproject(adapter.project(original));
    assert.ok(Math.abs(roundtrip.lat - original.lat) < 1e-10);
    assert.ok(Math.abs(roundtrip.lng - original.lng) < 1e-10);
  } finally {
    globalThis.window = previous;
  }
});

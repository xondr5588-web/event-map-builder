export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const RAD = Math.PI / 180,
  R = 6371008.8;
export function validCoord(p) {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 85 &&
    Math.abs(p.lng) <= 180
  );
}
export function distance(a, b) {
  const q =
    Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 +
    Math.cos(a.lat * RAD) *
      Math.cos(b.lat * RAD) *
      Math.sin(((b.lng - a.lng) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(clamp(q, 0, 1)));
}
export const length = (p) =>
  p.reduce((s, v, i) => s + (i ? distance(p[i - 1], v) : 0), 0);
export function area(p) {
  if (p.length < 3) return 0;
  const scale = Math.cos((p.reduce((s, v) => s + v.lat, 0) / p.length) * RAD);
  const points = p.map((v) => ({
    x: (v.lng - p[0].lng) * RAD * R * scale,
    y: (v.lat - p[0].lat) * RAD * R,
  }));
  return (
    Math.abs(
      points.reduce((s, v, i) => {
        const n = points[(i + 1) % points.length];
        return s + v.x * n.y - n.x * v.y;
      }, 0),
    ) / 2
  );
}
export const center = (p) =>
  p.length
    ? {
        lat: p.reduce((s, v) => s + v.lat, 0) / p.length,
        lng: p.reduce((s, v) => s + v.lng, 0) / p.length,
      }
    : { lat: 0, lng: 0 };
export const pointsOf = (o) => (o.type === "marker" ? [o.position] : o.path);
export const meters = (n) =>
  n >= 1000
    ? `${(n / 1000).toFixed(2)} km`
    : `${Math.round(n).toLocaleString()} m`;
export const squareMeters = (n) =>
  n >= 10000
    ? `${(n / 10000).toFixed(2)} ha`
    : `${Math.round(n).toLocaleString()} m²`;
export function world(p, zoom) {
  const s = 256 * 2 ** zoom,
    y = Math.sin(clamp(p.lat, -85, 85) * RAD);
  return {
    x: ((p.lng + 180) / 360) * s,
    y: (0.5 - Math.log((1 + y) / (1 - y)) / (4 * Math.PI)) * s,
  };
}
export function unworld(p, zoom) {
  const s = 256 * 2 ** zoom;
  return {
    lng: (((((p.x / s) * 360) % 360) + 360) % 360) - 180,
    lat: clamp(
      Math.atan(Math.sinh(Math.PI * (1 - (2 * p.y) / s))) / RAD,
      -85,
      85,
    ),
  };
}
export function nearestSegment(p, path, closed = false) {
  let result = { index: 0, distance: Infinity, point: p };
  for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
    const a = path[i],
      b = path[(i + 1) % path.length],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = clamp(
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      0,
      1,
    );
    const q = { x: a.x + t * dx, y: a.y + t * dy },
      d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < result.distance) result = { index: i, distance: d, point: q };
  }
  return result;
}
export function samples(path, spacing = 40, max = 100) {
  const total = length(path);
  if (total < 0.05) return [];
  const step = Math.max(spacing, total / max),
    out = [];
  let passed = 0,
    target = step / 2;
  for (let i = 1; i < path.length; i++) {
    const d = distance(path[i - 1], path[i]);
    while (d > 0 && target <= passed + d && out.length < max) {
      const t = (target - passed) / d;
      out.push({
        point: {
          lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
          lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
        },
        from: path[i - 1],
        to: path[i],
      });
      target += step;
    }
    passed += d;
  }
  return out;
}

// Iterable bounds avoid spreading a large venue's vertices into function arguments.
export function boundsXY(points) {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return { left, right, top, bottom };
}

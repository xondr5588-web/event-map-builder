import { clamp } from "./geometry.js";
// Drawing annotations need bounded screen sizes rather than unlimited map magnification.
const compact = (viewport = {}) =>
  (viewport.width > 0 && viewport.width <= 600) ||
  (viewport.height > 0 && viewport.height <= 450);
const sizePreference = (project, object) =>
  (project.settings.symbolSize || 1) * (object.style.scale || 1);
export function zoomScale(project, zoom) {
  const settings = project.settings || {};
  const reference = Number.isFinite(settings.referenceZoom)
    ? settings.referenceZoom
    : 16;
  if (settings.scaleWithMap === false) return 1;
  const delta = clamp(zoom, 6, 21) - reference;
  return settings.autoSize === false
    ? 2 ** delta
    : clamp(2 ** (delta * 0.18), 0.7, 1.35);
}
export function elementScale(project, object, zoom, viewport) {
  const scale = zoomScale(project, zoom) * sizePreference(project, object);
  if (project.settings.autoSize === false) return scale;
  const small = compact(viewport);
  return object.type === "marker"
    ? clamp(scale * (small ? 0.6 : 0.68), 0.42, small ? 0.76 : 0.88)
    : clamp(scale, 0.55, small ? 1.35 : 1.6);
}
export function labelScale(project, object, zoom, viewport) {
  if (project.settings.autoSize === false)
    return elementScale(project, object, zoom, viewport);
  const small = compact(viewport);
  return clamp(
    zoomScale(project, zoom) *
      sizePreference(project, object) *
      (small ? 0.9 : 0.95),
    small ? 0.83 : 0.88,
    1.05,
  );
}

import { clamp } from "./geometry.js";
export function zoomScale(project, zoom) {
  const settings = project.settings || {};
  const reference = Number.isFinite(settings.referenceZoom)
    ? settings.referenceZoom
    : 16;
  return settings.scaleWithMap === false
    ? 1
    : 2 ** (clamp(zoom, 6, 21) - reference);
}
export function elementScale(project, object, zoom) {
  return (
    zoomScale(project, zoom) *
    (project.settings.symbolSize || 1) *
    (object.style.scale || 1)
  );
}

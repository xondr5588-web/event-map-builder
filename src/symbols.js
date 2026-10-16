import policeEmblem from "./assets/police-emblem.svg?raw";
import fireEmblem from "./assets/fire-emblem.svg?raw";
const fireBody = fireEmblem
  .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
const emblemBody = policeEmblem
  .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
// Full-colour map pictograms. UI command icons remain separate from field symbols.
const ink = "#17354e",
  white = "#ffffff";
const text = (s, x = 20, y = 26, size = 12, fill = white) =>
  `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="800" text-anchor="middle" fill="${fill}">${s}</text>`;
// Matching full-body proportions; equipment identifies the role even without colour.
const person = (vest, guide = false) =>
  `<g data-symbol="${guide ? "guide-staff" : "parking-staff"}"><path d="M14 28v10h5l1-9 1 9h5V28" fill="${ink}"/><path d="${guide ? "m13 18-5 11m19-11 5-9" : "m13 18-5 11m19-11 5 11"}" stroke="${ink}" stroke-width="5" stroke-linecap="round"/><circle cx="8" cy="31" r="2.6" fill="#eebf9d"/><circle cx="32" cy="${guide ? 8 : 31}" r="2.6" fill="#eebf9d"/><circle cx="20" cy="9" r="6" fill="#eebf9d"/><path d="M14 6q6-6 12 0v2H13z" fill="${ink}"/><path d="M13 16 17 14h6l4 2 2 16H11z" fill="${vest}" stroke="${ink}" stroke-width="1.5"/><path d="m16 16 1 14m7-14-1 14M12 25h16" stroke="#fff8ce" stroke-width="2.5"/>${guide ? text("i", 20, 23, 9, ink) : `<path d="M32 28V16" stroke="#f36935" stroke-width="3.5" stroke-linecap="round"/><path d="M32 21v-4" stroke="white" stroke-width="2"/>${text("P", 20, 23, 8, ink)}`}</g>`;
const car = (direction) =>
  `<path d="m6 12 3-7h18l3 7v15H6z" fill="#fafcfe" stroke="${ink}" stroke-width="1.8"/><path d="m10 8-2 8h20l-2-8z" fill="#84b6d1"/><path d="M8 27v4m20-4v4" stroke="${ink}" stroke-width="4"/><path d="M8 20h5m10 0h5" stroke="#e7b640" stroke-width="2.8"/><g transform="translate(30 28)"><circle r="9" fill="${direction === "in" ? "#177c57" : "#c9463b"}" stroke="white" stroke-width="2"/><path d="${direction === "in" ? "M0-5v10m-4-4 4 4 4-4" : "M0 5v-10m-4 4 4-4 4 4"}" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round"/></g>`;
const parking = (out = false) =>
  `<rect x="3" y="3" width="26" height="31" rx="4" fill="#176baf" stroke="white" stroke-width="1.4"/>${text("P", 16, 27, 25)}<g transform="translate(29 29)"><circle r="10" fill="${out ? "#ba4437" : "#187c58"}" stroke="white" stroke-width="2"/><path d="${out ? "M-5 0H5m-4-4 4 4-4 4" : "M5 0H-5m4-4-4 4 4 4"}" fill="none" stroke="white" stroke-width="2.6" stroke-linejoin="round"/></g>`;
const artwork = {
  parkingStaff: person("#f68b2c"),
  safetyStaff: `<g data-symbol="security-guard"><path d="M14 28v10h5l1-9 1 9h5V28" fill="#172b3e"/><path d="m13 18-5 11m19-11 5 11" stroke="#21374d" stroke-width="5" stroke-linecap="round"/><circle cx="8" cy="31" r="2.6" fill="#eebf9d"/><circle cx="32" cy="31" r="2.6" fill="#eebf9d"/><circle cx="20" cy="9" r="6" fill="#eebf9d"/><path d="M14 7V5q5-6 12 0v2l-3-2-7 2z" fill="#172b3e"/><path d="M13 16 17 14h6l4 2 2 16H11z" fill="#21374d" stroke="#14293b" stroke-width="1.2"/><path d="M17 15h6l-3 13z" fill="white"/><path d="m19 17 1-1 1 1-1 2zm1 2 2 6-2 3-2-3z" fill="#162c3f"/><path d="m16 15-3 4 7 9m4-13 3 4-7 9" fill="none" stroke="#5b7387" stroke-width="1.2"/><rect x="14" y="8" width="5.4" height="3.6" rx="1" fill="#152535"/><rect x="20.6" y="8" width="5.4" height="3.6" rx="1" fill="#152535"/><path d="M19 9h2" stroke="#152535" stroke-width="1.5"/><path d="M27 9v4q0 3-3 4v5" stroke="#a2b7c4" stroke-width="1.2" fill="none"/><circle cx="27" cy="9" r="1.3" fill="#486476"/></g>`,
  guideStaff: person("#8870b0", true),
  carIn: car("in"),
  carOut: car("out"),
  gateIn: parking(),
  gateOut: parking(true),
  control: `<path d="M8 26v12m24-12v12" stroke="${ink}" stroke-width="3"/><rect x="2" y="18" width="36" height="10" rx="2" fill="white" stroke="#b9403a" stroke-width="1.5"/><path d="m4 26 6-6m3 6 6-6m3 6 6-6m3 6 6-6" stroke="#d95346" stroke-width="4"/><circle cx="20" cy="10" r="9" fill="#ce3e36" stroke="white" stroke-width="1.5"/><path d="M14 10h12" stroke="white" stroke-width="3"/>`,
  vipGate: `<path d="M6 36V8h28v28M4 36h8m16 0h8" fill="none" stroke="${ink}" stroke-width="4"/><rect x="9" y="4" width="22" height="12" rx="3" fill="#b88b28"/>${text("VIP", 20, 13, 9)}<path d="M20 20v12m-5-5 5 5 5-5" fill="none" stroke="#2b8d6c" stroke-width="3"/>`,
  stage: `<path d="M3 13 20 3l17 10" stroke="${ink}" stroke-width="3" fill="#e9ca79"/><path d="M7 13v21m26-21v21" stroke="${ink}" stroke-width="3"/><path d="M9 14h22v17H9z" fill="#7968ac"/><path d="M9 14q10 16 11 0 1 16 11 0" fill="#bc8bd0"/><path d="M3 33h34v5H3z" fill="${ink}"/>`,
  booth: `<g data-symbol="event-booth"><path d="M20 6V1h9l-2 2 2 2h-9" fill="#dd5c45" stroke="${ink}" stroke-width="1"/><path d="M5 18v19m30-19v19" stroke="${ink}" stroke-width="2.5"/><path d="m2 17 10-11h16l10 11z" fill="#f4faf7" stroke="${ink}" stroke-width="1.5"/><path d="M12 6h5l-4 11H2zm11 0h5l10 11H27z" fill="#ef8a42"/><path d="M3 17h34v5H3z" fill="#fff8e8" stroke="${ink}" stroke-width="1.2"/><path d="M4 17h6v5H4zm12 0h7v5h-7zm13 0h7v5h-7z" fill="#ef8a42"/><path d="M7 22h26v13H7z" fill="#fff5df"/><path d="M7 28h26v8H7z" fill="#efa05e" stroke="${ink}" stroke-width="1.2"/><path d="M6 27h28M4 37h32" stroke="${ink}" stroke-width="2"/><rect x="14" y="30" width="12" height="4" rx="1" fill="white"/></g>`,
  medical: `<g data-symbol="medical-station"><path d="m3 17 10-11h14l10 11z" fill="#e4f1ed" stroke="${ink}" stroke-width="1.5"/><path d="M6 17h28v20H6z" fill="white" stroke="${ink}" stroke-width="1.5"/><path d="M4 17h32" stroke="#328362" stroke-width="3"/><path d="M16 37V24h8v13" fill="#d9ebe4" stroke="#328362" stroke-width="1.5"/><path d="M20 8v7m-3.5-3.5h7" stroke="#328362" stroke-width="2.6"/></g>`,
  fire: `<svg data-symbol="fire-emblem" x="1" y="9.6" width="38" height="20.8" viewBox="0 0 2048 1120">${fireBody}</svg>`,
  command: `<g data-symbol="command-post"><path d="M27 8V2m-4 3 4 3 4-3" fill="none" stroke="${ink}" stroke-width="1.7"/><path d="m3 17 10-11h14l10 11z" fill="#416c84" stroke="${ink}" stroke-width="1.5"/><path d="M6 17h28v20H6z" fill="#f5f8fa" stroke="${ink}" stroke-width="1.5"/><path d="M4 17h32" stroke="${ink}" stroke-width="2"/><path d="M16 37V24h8v13" fill="#6894a7" stroke="${ink}" stroke-width="1.5"/>${text("HQ", 20, 15, 7)}</g>`,
  info: `<g data-symbol="information-desk"><path d="m3 17 10-11h14l10 11z" fill="#80b4d8" stroke="${ink}" stroke-width="1.5"/><path d="M6 17h28v20H6z" fill="#f5f8fa" stroke="${ink}" stroke-width="1.5"/><path d="M4 17h32v4H4z" fill="#327cb4" stroke="${ink}" stroke-width="1.3"/><circle cx="20" cy="29" r="6" fill="#327cb4"/>${text("i", 20, 33, 12)}</g>`,
  toilet: `<rect x="2" y="3" width="36" height="34" rx="4" fill="#e9f0f3" stroke="${ink}" stroke-width="1.4"/><path d="M20 6v28" stroke="#b9cbd5"/><circle cx="11" cy="11" r="3" fill="#3272a4"/><path d="M7 17h8v9H7zm2 9v7m4-7v7" fill="#3272a4" stroke="#3272a4" stroke-width="2"/><circle cx="29" cy="11" r="3" fill="#bb657e"/><path d="M29 16 23 28h12zm-3 11v6m6-6v6" fill="#bb657e" stroke="#bb657e" stroke-width="2"/>`,
  assembly: `<rect x="2" y="2" width="36" height="36" rx="4" fill="#25875d"/><path d="m6 6 7 7m-7-1h7V6m21 0-7 7m7-1h-7V6M6 34l7-7m-7 1h7v6m21 0-7-7m7 1h-7v6" fill="none" stroke="white" stroke-width="2"/><circle cx="20" cy="17" r="3" fill="white"/><path d="M15 27v-5q5-4 10 0v5" fill="white"/>`,
  shuttle: `<g data-symbol="shuttle-stop"><path d="M28 24v14m-5 0h10" stroke="${ink}" stroke-width="2.5"/><rect x="7" y="2" width="26" height="26" rx="4" fill="#4284b6" stroke="${ink}" stroke-width="1.5"/><rect x="12" y="6" width="16" height="17" rx="3" fill="white"/><path d="M14 9h12v7H14z" fill="#a7d4e6"/><path d="M14 23v2m12-2v2" stroke="white" stroke-width="2.5"/><circle cx="15" cy="20" r="1.5" fill="#4284b6"/><circle cx="25" cy="20" r="1.5" fill="#4284b6"/></g>`,
  police: `<svg data-symbol="police-emblem" x="1" y="0" width="38" height="38" viewBox="0 0 300 300">${emblemBody}</svg>`,
};
export const markerArtwork = (kind) =>
  `<g data-marker-kind="${Object.hasOwn(artwork, kind) ? kind : "info"}" stroke-linejoin="round" stroke-linecap="round">${artwork[kind] || artwork.info}</g>`;
export function markerSymbol(kind, size = 32) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 40 40">${markerArtwork(kind)}</svg>`;
}

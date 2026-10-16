import policeEmblem from "./assets/police-emblem.svg?raw";
const emblemBody = policeEmblem
  .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
// Full-colour map pictograms. UI command icons remain separate from field symbols.
const ink = "#17354e",
  white = "#ffffff";
const text = (s, x = 20, y = 26, size = 12, fill = white) =>
  `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="800" text-anchor="middle" fill="${fill}">${s}</text>`;
const person = (vest, helmet = false, badge = "") =>
  `<path d="M14 28v10h5l1-9 1 9h5V28" fill="${ink}"/><path d="m13 17-7 12m21-12 7 12" stroke="${ink}" stroke-width="5" stroke-linecap="round"/><circle cx="20" cy="9" r="5" fill="#eebf9d"/><path d="M13 15h14l3 16H10z" fill="${vest}" stroke="${ink}" stroke-width="1.2"/><path d="m15 16 2 13m8-13-2 13M11 25h18" stroke="#f9fbdb" stroke-width="2.6"/><circle cx="6" cy="29" r="2.6" fill="white"/><circle cx="34" cy="29" r="2.6" fill="white"/>${helmet ? '<path d="M13 8a7 7 0 0114 0v2H13z" fill="#ffcc38" stroke="#916e14"/><path d="M11 10h18" stroke="#916e14" stroke-width="2"/>' : '<path d="M14 6q6-6 12 0v2H13z" fill="#23465d"/>'}${badge ? text(badge, 20, 22, 7, ink) : ""}`;
const car = (direction) =>
  `<path d="m6 12 3-7h18l3 7v15H6z" fill="#fafcfe" stroke="${ink}" stroke-width="1.8"/><path d="m10 8-2 8h20l-2-8z" fill="#84b6d1"/><path d="M8 27v4m20-4v4" stroke="${ink}" stroke-width="4"/><path d="M8 20h5m10 0h5" stroke="#e7b640" stroke-width="2.8"/><g transform="translate(30 28)"><circle r="9" fill="${direction === "in" ? "#177c57" : "#c9463b"}" stroke="white" stroke-width="2"/><path d="${direction === "in" ? "M0-5v10m-4-4 4 4 4-4" : "M0 5v-10m-4 4 4-4 4 4"}" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round"/></g>`;
const parking = (out = false) =>
  `<rect x="3" y="3" width="26" height="31" rx="4" fill="#176baf" stroke="white" stroke-width="1.4"/>${text("P", 16, 27, 25)}<g transform="translate(29 29)"><circle r="10" fill="${out ? "#ba4437" : "#187c58"}" stroke="white" stroke-width="2"/><path d="${out ? "M-5 0H5m-4-4 4 4-4 4" : "M5 0H-5m4-4-4 4 4 4"}" fill="none" stroke="white" stroke-width="2.6" stroke-linejoin="round"/></g>`;
const artwork = {
  parkingStaff: person("#f68b2c", false, "P"),
  safetyStaff: person("#e5ce2c", true),
  guideStaff: person("#9774ba", false, "i"),
  carIn: car("in"),
  carOut: car("out"),
  gateIn: parking(),
  gateOut: parking(true),
  control: `<path d="M8 26v12m24-12v12" stroke="${ink}" stroke-width="3"/><rect x="2" y="18" width="36" height="10" rx="2" fill="white" stroke="#b9403a" stroke-width="1.5"/><path d="m4 26 6-6m3 6 6-6m3 6 6-6m3 6 6-6" stroke="#d95346" stroke-width="4"/><circle cx="20" cy="10" r="9" fill="#ce3e36" stroke="white" stroke-width="1.5"/><path d="M14 10h12" stroke="white" stroke-width="3"/>`,
  vipGate: `<path d="M6 36V8h28v28M4 36h8m16 0h8" fill="none" stroke="${ink}" stroke-width="4"/><rect x="9" y="4" width="22" height="12" rx="3" fill="#b88b28"/>${text("VIP", 20, 13, 9)}<path d="M20 20v12m-5-5 5 5 5-5" fill="none" stroke="#2b8d6c" stroke-width="3"/>`,
  stage: `<path d="M3 13 20 3l17 10" stroke="${ink}" stroke-width="3" fill="#e9ca79"/><path d="M7 13v21m26-21v21" stroke="${ink}" stroke-width="3"/><path d="M9 14h22v17H9z" fill="#7968ac"/><path d="M9 14q10 16 11 0 1 16 11 0" fill="#bc8bd0"/><path d="M3 33h34v5H3z" fill="${ink}"/>`,
  medical: `<rect x="2" y="12" width="35" height="21" rx="4" fill="white" stroke="${ink}" stroke-width="1.6"/><path d="M4 17h10v11H4zm24-1h7v8h-7z" fill="#a5d1e1"/><circle cx="10" cy="34" r="4" fill="${ink}"/><circle cx="30" cy="34" r="4" fill="${ink}"/><rect x="14" y="6" width="10" height="4" rx="1" fill="#df4a5b"/><path d="M18 18v10m-5-5h10" stroke="#31825a" stroke-width="3"/>`,
  fire: `<path d="M2 18h23V9h9l5 10v13H2z" fill="#db513e" stroke="${ink}" stroke-width="1.4"/><path d="M27 12h5l4 8h-9z" fill="#b6d9e7"/><path d="M5 13h17M7 9l14 12" stroke="#a8b6bd" stroke-width="2.5"/><circle cx="10" cy="33" r="4.5" fill="${ink}"/><circle cx="31" cy="33" r="4.5" fill="${ink}"/>${text("119", 14, 29, 9)}`,
  command: `<path d="M2 16 20 3l18 13" fill="#3c6982" stroke="${ink}" stroke-width="1.5"/><path d="M6 17h28v19H6z" fill="#f6f9f5" stroke="${ink}" stroke-width="1.5"/><path d="M15 23h10v13H15z" fill="#44788c"/>${text("HQ", 20, 16, 10)}`,
  info: `<path d="M4 16 20 5l16 11v20H4z" fill="#f7faf6" stroke="${ink}" stroke-width="2"/><rect x="5" y="14" width="30" height="7" fill="#327cb4"/>${text("i", 20, 34, 16, "#246aa2")}`,
  toilet: `<rect x="2" y="3" width="36" height="34" rx="4" fill="#e9f0f3" stroke="${ink}" stroke-width="1.4"/><path d="M20 6v28" stroke="#b9cbd5"/><circle cx="11" cy="11" r="3" fill="#3272a4"/><path d="M7 17h8v9H7zm2 9v7m4-7v7" fill="#3272a4" stroke="#3272a4" stroke-width="2"/><circle cx="29" cy="11" r="3" fill="#bb657e"/><path d="M29 16 23 28h12zm-3 11v6m6-6v6" fill="#bb657e" stroke="#bb657e" stroke-width="2"/>`,
  assembly: `<rect x="2" y="2" width="36" height="36" rx="4" fill="#25875d"/><path d="m6 6 7 7m-7-1h7V6m21 0-7 7m7-1h-7V6M6 34l7-7m-7 1h7v6m21 0-7-7m7 1h-7v6" fill="none" stroke="white" stroke-width="2"/><circle cx="20" cy="17" r="3" fill="white"/><path d="M15 27v-5q5-4 10 0v5" fill="white"/>`,
  shuttle: `<rect x="4" y="3" width="32" height="31" rx="6" fill="#4284b6" stroke="${ink}" stroke-width="1.5"/><path d="M8 10h24v13H8z" fill="#c6e5ef"/><path d="M20 10v13" stroke="#4284b6" stroke-width="2"/><path d="M8 34v4m24-4v4" stroke="${ink}" stroke-width="5"/><circle cx="11" cy="28" r="2" fill="#ffdc7a"/><circle cx="29" cy="28" r="2" fill="#ffdc7a"/>${text("BUS", 20, 9, 6)}`,
  police: `<svg data-symbol="police-emblem" x="1" y="0" width="38" height="38" viewBox="0 0 300 300">${emblemBody}</svg>`,
};
export const markerArtwork = (kind) => artwork[kind] || artwork.info;
export function markerSymbol(kind, size = 32) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 40 40">${markerArtwork(kind)}</svg>`;
}

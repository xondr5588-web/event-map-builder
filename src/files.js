import { exportProject } from "./model.js";
export function fileName(title, ext = "json") {
  return `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "운영도"}.${ext}`;
}
export function download(text, name, mime = "application/json") {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function shareProject(p) {
  const file = new File([exportProject(p)], fileName(p.title), {
    type: "application/json",
  });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: p.title });
    return true;
  }
  download(file, file.name);
  return false;
}
export async function exportOverlayPNG(svg, title) {
  const copy = svg.cloneNode(true);
  copy.querySelector(".handles")?.remove();
  copy.querySelector(".draft")?.remove();
  copy.querySelectorAll(".paste-preview").forEach((n) => n.remove());
  copy.querySelectorAll("[data-locked-indicator]").forEach((n) => n.remove());
  copy
    .querySelectorAll(".selected")
    .forEach((n) => n.classList.remove("selected"));
  const size = svg.getBoundingClientRect();
  copy.setAttribute("width", size.width * 2);
  copy.setAttribute("height", size.height * 2);
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent =
    ".object-hit,.label-touch{display:none}.object-label rect{fill:white;stroke:#b9c8ca}.object-label text{font:600 12px sans-serif;fill:#163432}.marker-halo{fill:white}";
  copy.prepend(style);
  const source = new Blob([new XMLSerializer().serializeToString(copy)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size.width * 2);
    canvas.height = Math.ceil(size.height * 2);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("PNG 변환에 실패했습니다.");
    download(blob, fileName(`${title}_운영요소`, "png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

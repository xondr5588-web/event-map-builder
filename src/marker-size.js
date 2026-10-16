import { elementScale } from "./scaling.js";
import { icon } from "./icons.js";

// One committed change per drag; intermediate sizes exist only in the renderer.
export class MarkerSizeControl {
  constructor(
    root,
    { project, selection, map, renderer, mutate, request, closed },
  ) {
    Object.assign(this, {
      root,
      project,
      selection,
      map,
      renderer,
      mutate,
      request,
      closed,
    });
    this.scope = "all";
    root.addEventListener("input", (e) => {
      if (e.target.id !== "marker-size-slider") return;
      const value = Number(e.target.value);
      this.renderer.markerSizePreview = {
        scope: this.scope,
        value,
        ids: new Set(
          this.markers()
            .filter((o) => !o.locked)
            .map((o) => o.id),
        ),
      };
      root.querySelector("output").textContent = `${value}px`;
      this.request();
    });
    root.addEventListener("change", (e) => {
      if (e.target.id === "marker-size-slider")
        this.apply(Number(e.target.value));
    });
    root.addEventListener("pointercancel", () => this.cancelPreview());
    root.addEventListener("focusout", (e) => {
      if (
        e.target.id === "marker-size-slider" &&
        this.renderer.markerSizePreview
      )
        this.apply(Number(e.target.value));
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.sizeScope) {
        this.cancelPreview();
        this.scope = b.dataset.sizeScope;
        this.sync();
      }
      if (b.dataset.sizePreset) this.apply(Number(b.dataset.sizePreset));
      if (b.hasAttribute("data-size-auto")) this.apply(null);
      if (b.hasAttribute("data-size-unify")) {
        this.cancelPreview();
        this.mutate("개별 마커 크기 통일", (p) =>
          p.objects.forEach((o) => {
            if (o.type === "marker" && !o.locked) o.style.markerSize = null;
          }),
        );
        this.sync();
      }
      if (b.hasAttribute("data-size-close")) this.close();
    });
  }
  markers() {
    return this.selection().filter((o) => o.type === "marker");
  }
  open(scope = "all") {
    this.scope = scope;
    this.root.hidden = false;
    this.sync();
    document
      .querySelector('[data-action="marker-size"]')
      .setAttribute("aria-expanded", "true");
    this.root.querySelector("[data-size-close]").focus({ preventScroll: true });
  }
  close() {
    if (this.root.hidden) return;
    this.cancelPreview();
    this.root.hidden = true;
    document
      .querySelector('[data-action="marker-size"]')
      .setAttribute("aria-expanded", "false");
    this.closed();
  }
  cancelPreview() {
    this.renderer.markerSizePreview = null;
    this.request();
  }
  apply(value) {
    const preview = this.renderer.markerSizePreview;
    const scope = preview?.scope || this.scope;
    const ids =
      preview?.ids ||
      new Set(
        this.markers()
          .filter((o) => !o.locked)
          .map((o) => o.id),
      );
    this.renderer.markerSizePreview = null;
    this.mutate(
      scope === "all" ? "전체 마커 크기 변경" : "선택 마커 크기 변경",
      (p) => {
        if (scope === "all") p.settings.markerSize = value;
        else
          p.objects.forEach((o) => {
            if (ids.has(o.id) && !o.locked) o.style.markerSize = value;
          });
      },
    );
    this.request();
    this.sync();
  }
  sync() {
    if (this.root.hidden || this.renderer.markerSizePreview) return;
    const focused =
      this.root.contains(document.activeElement) &&
      document.activeElement.id === "marker-size-slider";
    const markers = this.markers(),
      p = this.project();
    if (!markers.length) this.scope = "all";
    const selected = this.scope === "selected",
      first = selected ? markers[0] : null;
    const example = first || { type: "marker", style: { scale: 1 } };
    const stored = selected ? first.style.markerSize : p.settings.markerSize;
    const value = Math.max(
      16,
      Math.min(
        96,
        Math.round(
          (50 * elementScale(p, example, this.map.view.zoom, this.map.size)) /
            2,
        ) * 2,
      ),
    );
    const disabled = selected && markers.every((o) => o.locked);
    const overrides = p.objects.filter(
      (o) => o.type === "marker" && o.style.markerSize != null,
    );
    this.root.innerHTML = `<div class="size-heading"><b id="marker-size-heading">마커 크기</b><button type="button" data-size-close aria-label="크기 패널 닫기">${icon("close", 18)}</button></div>
      <div class="size-tabs" role="group" aria-label="크기 적용 대상"><button type="button" data-size-scope="all" aria-pressed="${!selected}">전체</button><button type="button" data-size-scope="selected" aria-pressed="${selected}" ${!markers.length ? "disabled" : ""}>선택 ${markers.length ? `(${markers.length})` : ""}</button></div>
      <label class="size-value" for="marker-size-slider"><span>${selected ? "선택한 마커" : "기본 마커"}<small>${stored == null ? (selected ? "전체 설정 사용 중" : "자동 크기 사용 중") : "화면 크기 고정"}</small></span><output for="marker-size-slider">${value}px</output></label>
      <input id="marker-size-slider" type="range" min="16" max="96" step="2" value="${value}" aria-label="${selected ? "선택 마커 크기" : "전체 마커 크기"}" ${disabled ? "disabled" : ""}/>
      <div class="size-presets">${[
        [24, "작게"],
        [32, "보통"],
        [48, "크게"],
      ]
        .map(
          ([n, label]) =>
            `<button type="button" data-size-preset="${n}" ${disabled ? "disabled" : ""}>${label}<small>${n}px</small></button>`,
        )
        .join("")}</div>
      <div class="size-footer"><button type="button" data-size-auto ${disabled ? "disabled" : ""}>${selected ? "전체 크기 따르기" : "자동 크기로"}</button>${!selected && overrides.length ? `<button type="button" data-size-unify>개별 크기도 통일</button>` : ""}</div>
      <p class="size-hint">${disabled ? "잠긴 마커는 개별 크기를 바꿀 수 없습니다." : selected ? "선택한 마커만 변경합니다. 잠긴 마커는 유지됩니다." : "새 마커에도 적용 · 개별 지정한 크기는 유지"}<br/>수동 크기는 지도를 확대해도 유지됩니다.</p>`;
    if (focused)
      this.root
        .querySelector("#marker-size-slider")
        .focus({ preventScroll: true });
  }
}

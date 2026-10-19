import { icon } from "./icons.js";
import { escapeHTML as esc } from "./renderer.js";
import { elementScale } from "./scaling.js";

export class MarkerQuickEdit {
  constructor(shell, cb) {
    this.shell = shell;
    this.stage = shell.closest("#stage");
    this.cb = cb;
    this.actions = document.createElement("div");
    this.actions.id = "marker-quick-actions";
    this.actions.setAttribute("role", "toolbar");
    this.actions.setAttribute("aria-label", "선택 마커 빠른 편집");
    this.actions.hidden = true;
    this.form = document.createElement("form");
    this.form.id = "marker-name-editor";
    this.form.setAttribute("aria-label", "마커 이름 수정");
    this.form.hidden = true;
    shell.append(this.actions, this.form);
    this.actions.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      const o = this.marker();
      if (!o) return;
      if (b.dataset.markerAction === "rename") this.openName(o.id);
      if (b.dataset.markerAction === "copy") this.cb.copy();
      if (b.dataset.markerAction === "duplicate") this.cb.duplicate();
      if (b.dataset.markerAction === "lock") {
        this.cb.cancelGesture();
        this.cb.mutate(o.locked ? "마커 잠금 해제" : "마커 잠금", (p) => {
          const marker = p.objects.find((x) => x.id === o.id);
          if (marker) marker.locked = !o.locked;
        });
        this.sync();
      }
    });
    this.form.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.form.addEventListener("compositionend", () => {
      this.composing = false;
    });
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!this.composing) this.finishName();
    });
    this.form.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.cancelName();
      }
    });
    this.form.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-cancel-name]")) this.cancelling = true;
    });
    this.form.addEventListener("pointercancel", () => {
      this.cancelling = false;
    });
    this.form.addEventListener("click", (e) => {
      if (e.target.closest("[data-cancel-name]")) this.cancelName();
    });
    this.form.addEventListener("focusout", () =>
      queueMicrotask(() => {
        if (
          !this.form.hidden &&
          !this.cancelling &&
          !this.form.contains(document.activeElement)
        )
          this.finishName();
      }),
    );
    window.visualViewport?.addEventListener("resize", () =>
      this.positionName(),
    );
    window.visualViewport?.addEventListener("scroll", () =>
      this.positionName(),
    );
  }
  marker() {
    const ids = this.cb.selection(),
      p = this.cb.project();
    return ids.size === 1
      ? p.objects.find(
          (o) =>
            ids.has(o.id) &&
            o.type === "marker" &&
            o.visible &&
            p.settings.layers.marker,
        )
      : null;
  }
  bounds() {
    const r = this.shell.getBoundingClientRect(),
      v = window.visualViewport;
    return {
      width: this.shell.clientWidth,
      height: Math.max(
        85,
        Math.min(
          this.shell.clientHeight,
          v ? v.offsetTop + v.height - r.top : this.shell.clientHeight,
        ),
      ),
    };
  }
  place(node, x, y) {
    const { width, height } = this.bounds();
    const w = node.offsetWidth,
      h = node.offsetHeight;
    const controls = this.shell.querySelector(".map-controls");
    const right =
      node === this.actions && controls
        ? Math.min(
            width - 8,
            controls.getBoundingClientRect().left -
              this.shell.getBoundingClientRect().left -
              8,
          )
        : width - 8;
    node.style.left = `${Math.max(8, Math.min(right - w, x - w / 2))}px`;
    node.style.top = `${Math.max(8, Math.min(height - h - 8, y))}px`;
  }
  labelRect(id) {
    const label = this.cb.svg.querySelector(
      `[data-object="${CSS.escape(id)}"] .object-label > rect:not(.label-touch)`,
    );
    const rect = label?.getBoundingClientRect();
    return rect?.width > 0 ? rect : null;
  }
  sync() {
    const o = this.marker(),
      allowed = this.cb.visible();
    this.stage?.classList.toggle("marker-selected", !!o);
    if (
      !this.form.hidden &&
      (!allowed || !o || o.id !== this.editingId || o.locked)
    )
      this.cancelName(false);
    this.actions.hidden =
      !o || !allowed || !this.form.hidden || this.cb.dragging();
    this.positionName();
    if (this.actions.hidden) return;
    const key = `${o.id}:${o.locked}`;
    if (key !== this.key) {
      const focus = this.actions.contains(document.activeElement)
        ? document.activeElement.dataset.markerAction
        : null;
      this.actions.innerHTML = `<button type="button" data-marker-action="rename" ${o.locked ? "disabled" : ""}>${icon("edit", 16)}이름</button><button type="button" data-marker-action="duplicate" title="가까이에 사본 만들기 (Ctrl/⌘ D)">${icon("duplicate", 16)}복제</button><button type="button" data-marker-action="copy" title="복사 (Ctrl/⌘ C)">${icon("copy", 16)}복사</button><button type="button" data-marker-action="lock" aria-pressed="${o.locked}">${icon(o.locked ? "unlock" : "lock", 16)}${o.locked ? "잠금 해제" : "잠금"}</button>`;
      this.actions.dataset.markerId = o.id;
      this.key = key;
      if (focus)
        this.actions
          .querySelector(`[data-marker-action="${focus}"]`)
          ?.focus({ preventScroll: true });
    }
    const q = this.cb.map.project(o.position),
      { width, height } = this.bounds();
    const stage = this.stage;
    stage?.classList.toggle("marker-on-right", q.x > width / 2);
    if (q.x < -30 || q.y < -30 || q.x > width + 30 || q.y > height + 30) {
      this.actions.hidden = true;
      return;
    }
    const radius =
      27.5 *
      elementScale(
        this.cb.project(),
        o,
        this.cb.map.view.zoom,
        this.cb.map.size,
      );
    let y = q.y - radius - this.actions.offsetHeight - 8;
    let minimum = matchMedia("(max-height:520px) and (max-width:1000px)")
      .matches
      ? 60
      : 125;
    const shell = this.shell.getBoundingClientRect();
    const notice = document.getElementById("map-notice");
    if (notice && !notice.hidden)
      minimum = Math.max(
        minimum,
        notice.getBoundingClientRect().bottom - shell.top + 8,
      );
    if (
      stage &&
      matchMedia(
        "(min-width:761px) and (max-width:1150px) and (min-height:521px)",
      ).matches
    ) {
      const below = q.y <= height / 2;
      const label = this.labelRect(o.id);
      const available = below
        ? height -
          34 -
          (label ? label.bottom - shell.top : q.y + radius + 45) -
          12
        : q.y - radius - 14 - 125;
      stage.style.setProperty(
        "--marker-inspector-top",
        below ? "auto" : "125px",
      );
      stage.style.setProperty(
        "--marker-inspector-bottom",
        below ? "34px" : "auto",
      );
      stage.style.setProperty(
        "--marker-inspector-height",
        `${Math.max(60, Math.min(330, available))}px`,
      );
    }
    if (y < minimum) {
      const label = this.labelRect(o.id),
        shell = this.shell.getBoundingClientRect();
      y = Math.max(
        minimum,
        label ? label.bottom - shell.top + 7 : q.y + radius + 45,
      );
    }
    this.place(this.actions, q.x, y);
    this.positionName();
  }
  openName(id) {
    const o = this.cb
      .project()
      .objects.find((o) => o.id === id && o.type === "marker");
    if (!o) return;
    if (o.locked) {
      this.cb.toast("잠금을 해제하면 이름과 위치를 바꿀 수 있습니다.");
      return;
    }
    if (!this.form.hidden && this.editingId === id) {
      this.form.querySelector("input").focus();
      return;
    }
    if (this.cb.prepareName() === false) return;
    this.editingId = id;
    this.cancelling = false;
    this.composing = false;
    this.originalText = o.label.text || o.name;
    this.form.innerHTML = `<label for="marker-name-input">마커 이름</label><div class="marker-name-row"><input id="marker-name-input" aria-label="마커 이름" value="${esc(o.label.text || o.name)}" maxlength="120" required autocomplete="off" enterkeyhint="done"/><button type="submit" aria-label="이름 저장">${icon("check", 19)}</button><button type="button" data-cancel-name aria-label="이름 수정 취소">${icon("close", 19)}</button></div>`;
    this.form.hidden = false;
    this.actions.hidden = true;
    this.positionName();
    const input = this.form.querySelector("input");
    input.focus({ preventScroll: true });
    input.select();
  }
  positionName() {
    if (this.form.hidden || !this.editingId) return;
    const label = this.labelRect(this.editingId),
      shell = this.shell.getBoundingClientRect();
    const o = this.cb.project().objects.find((o) => o.id === this.editingId);
    if (!o) return;
    const p = this.cb.map.project(o.position);
    let y = label ? label.bottom - shell.top + 5 : p.y + 30;
    if (y + this.form.offsetHeight > this.bounds().height - 8)
      y = (label ? label.top - shell.top : p.y) - this.form.offsetHeight - 6;
    this.place(
      this.form,
      label ? label.left + label.width / 2 - shell.left : p.x,
      y,
    );
  }
  finishName() {
    if (this.form.hidden) return true;
    const raw = this.form.querySelector("input").value;
    const value = raw.trim();
    if (!value) {
      this.cb.toast("마커 이름을 입력해 주세요.");
      this.form.querySelector("input").focus({ preventScroll: true });
      return false;
    }
    const id = this.editingId;
    const changed = raw !== this.originalText;
    this.form.hidden = true;
    this.editingId = null;
    this.composing = false;
    if (changed)
      this.cb.mutate("마커 이름 변경", (p) => {
        const o = p.objects.find((x) => x.id === id && !x.locked);
        if (o) {
          o.name = value;
          o.label.text = value;
        }
      });
    this.cb.request();
    this.sync();
    return true;
  }
  cancelName(focus = true) {
    this.form.hidden = true;
    this.editingId = null;
    this.cancelling = false;
    this.composing = false;
    if (focus) {
      this.cb.svg.focus({ preventScroll: true });
      this.sync();
    }
  }
}

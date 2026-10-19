import { escapeHTML as esc } from "./renderer.js";
import {
  createFacilityBatch,
  transformGroup,
  resizeFacility,
  createVenueKit,
} from "./venue.js";
import { newObject, clone } from "./model.js";
import {
  directory,
  programVenue,
  programConflicts,
  normalizeProgram,
  parseProgramTable,
  programCSV,
} from "./event-data.js";
import { openPublication, exportSchematicPNG } from "./publication.js";
import { download, fileName } from "./files.js";
import { pointsOf } from "./geometry.js";
const btn = (a, t, extra = "") =>
  `<button data-studio="${a}" ${extra}>${t}</button>`;
const input = (key, label, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}/></label>`;
const form = (id, html, label = "저장") =>
  `<form data-studio-form="${id}" class="stack">${html}<button type="submit" class="primary">${label}</button></form>`;
const kinds = {
  booth: "행사부스",
  stage: "무대",
  seating: "관람석",
  parkingSlot: "주차면",
  food: "먹거리 부스",
};
export class EventStudio {
  constructor(cb) {
    this.cb = cb;
    this.tab = "facilities";
    this.query = "";
    this.pager = 1;
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-studio]");
      if (!b || b.disabled) return;
      e.preventDefault();
      this.run(() => this.action(b.dataset.studio, b.dataset.id, b));
    });
    document.addEventListener("submit", (e) => {
      const f = e.target.closest("[data-studio-form]");
      if (!f) return;
      e.preventDefault();
      this.run(() =>
        this.submit(
          f.dataset.studioForm,
          Object.fromEntries(new FormData(f)),
          f,
        ),
      );
    });
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.studioFile) {
        this.run(() => this.file(t.dataset.studioFile, t.files[0]));
      }
    });
    document.addEventListener("input", (e) => {
      if (e.target.id === "facility-query") {
        this.query = e.target.value;
        this.pager = 1;
        const pos = e.target.selectionStart;
        this.cb.render();
        const t = document.getElementById("facility-query");
        t?.focus();
        t?.setSelectionRange(pos, pos);
      }
    });
  }
  async run(fn) {
    try {
      await fn();
    } catch (e) {
      this.cb.toast(e.message || "처리하지 못했습니다.");
    }
  }
  render() {
    return `<div class="studio-intro"><span class="eyebrow">EVENT STUDIO</span><h2>행사 빠른 제작</h2><p>시설 배치부터 안내도 출력까지.</p></div><div class="studio-tabs" role="tablist" aria-label="행사 제작">${[
      ["facilities", "시설"],
      ["programs", "프로그램"],
      ["background", "배경·보기"],
      ["publish", "출력"],
    ]
      .map(([a, t]) =>
        btn(
          "tab",
          t,
          `data-id="${a}" role="tab" aria-selected="${this.tab === a}" class="${this.tab === a ? "active" : ""}"`,
        ),
      )
      .join("")}</div><div class="studio-content">${this[this.tab]()}</div>`;
  }
  facilities() {
    const p = this.cb.project(),
      items = directory(p).filter((o) =>
        `${o.details.number} ${o.name} ${o.group}`
          .toLowerCase()
          .includes(this.query.toLowerCase()),
      ),
      selected = this.cb.selection();
    return `<div class="studio-feature"><b>행사장 기본 구성</b><p>무대·관람석·부스·의료·안내 시설로 시작하세요.</p>${btn("kit", "지역 축제 기본 구성", 'data-id="festival"')}${btn("kit", "플리마켓 기본 구성", 'data-id="market"')}</div><div class="studio-feature"><b>규격 부스 일괄 배치</b><p>실제 미터 규격으로 배치하고 번호를 자동 연결합니다.</p>${btn("batch", "부스·무대 배치", 'class="primary"')}${btn("note", "안내 문구 추가")}</div>${selected.length ? `<div class="studio-feature"><b>${selected.length}개 선택</b><div class="row wrap">${btn("select-group", "같은 그룹 선택")}${btn("transform", "그룹 정렬·회전")}${btn("details", "시설 정보 수정", `data-id="${selected[0].id}"`)}</div></div>` : ""}<div class="section-title">시설 안내 목록 <span>${items.length}곳</span></div><input id="facility-query" type="search" aria-label="시설 검색" placeholder="번호 · 이름 · 그룹 검색" value="${esc(this.query)}"/><div class="facility-list">${
      items
        .slice(0, this.pager * 40)
        .map(
          (o) =>
            `<article><button data-studio="locate" data-id="${o.id}"><span class="facility-chip" style="--facility-color:${o.style.color}">${esc(o.details.number || "·")}</span><span><b>${esc(o.name)}</b><small>${esc(o.group)}${o.facility ? ` · ${o.facility.mode === "rectangle" ? `${o.facility.width}×${o.facility.depth}m` : "자유 규격"}` : ""}</small></span></button>${btn("details", "수정", `data-id="${o.id}" aria-label="${esc(o.name)} 정보 수정"`)}</article>`,
        )
        .join("") ||
      '<p class="muted">부스를 배치하거나 객체의 시설 정보를 등록하세요.</p>'
    }</div>${items.length > this.pager * 40 ? btn("more", "더 보기") : ""}<div class="help-card">지도에서 시설을 선택한 뒤 드래그해 이동하세요. 같은 그룹을 선택하면 함께 이동합니다. 번호를 바꾸면 지도와 안내 목록에 함께 반영됩니다.</div>`;
  }
  programs() {
    const p = this.cb.project(),
      items = p.meta.event.programs,
      conflicts = programConflicts(items);
    return `<div class="row wrap">${btn("program", "프로그램 추가", 'class="primary"')}${btn("import-program", "CSV / 엑셀 붙여넣기")}${btn("export-program", "CSV 저장")}</div>${
      conflicts.length
        ? `<div class="studio-warning" role="status">동일 장소에서 시간이 겹치는 프로그램 ${conflicts.length}쌍${conflicts
            .slice(0, 5)
            .map(
              ([a, b]) => `<small>${esc(a.title)} ↔ ${esc(b.title)}</small>`,
            )
            .join("")}</div>`
        : ""
    }<p class="muted small">시설을 장소로 연결하면 시설 이름 변경도 일정에 반영됩니다.</p><div class="studio-programs">${
      [...items]
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
        .slice(0, this.pager * 40)
        .map(
          (s) =>
            `<article><div class="program-stamp">${esc(s.date)}<b>${esc(s.start)}–${esc(s.end)}</b></div><b>${esc(s.title)}</b><small>${esc(programVenue(s, p))} · ${s.public ? "공개" : "내부용"}</small><p>${esc(s.description)}</p><div class="row">${btn("program", "수정", `data-id="${s.id}"`)}${btn("delete-program", "삭제", `data-id="${s.id}" class="danger"`)}</div></article>`,
        )
        .join("") ||
      '<div class="empty-state">공연·체험·운영 일정을 추가하세요.</div>'
    }</div>${items.length > this.pager * 40 ? btn("more", "더 보기") : ""}`;
  }
  background() {
    const p = this.cb.project(),
      b = p.meta.event.background;
    return `<div class="section-title">배경 그림</div><p class="muted small">직접 제작했거나 사용 권한이 있는 행사장 이미지(PNG·JPEG·WebP)를 불러오세요.</p><label class="studio-file">배경 그림 선택<input type="file" accept="image/png,image/jpeg,image/webp" data-studio-file="background"/></label>${b ? form("background", `<p class="small">${esc(b.name)}</p><div class="two-col">${input("width", "실제 너비 (m)", b.width, "number", 'min="1" max="50000" required')}${input("height", "실제 높이 (m)", b.height, "number", 'min="1" max="50000" required')}${input("rotation", "회전 (°)", b.rotation, "number", 'min="-360" max="360"')}${input("opacity", "불투명도 (%)", Math.round(b.opacity * 100), "number", 'min="10" max="100"')}</div><label class="check-label"><input name="enabled" type="checkbox" ${b.enabled ? "checked" : ""}/>그림 표시</label><div class="row">${btn("background-center", "그림을 지도 중심으로")}${btn("background-delete", "그림 삭제", 'class="danger"')}</div>`, "배경 적용") : ""}<div class="section-title">작업 보기</div><div class="studio-views">${[
      ["all", "전체 운영"],
      ["visitor", "방문객 안내"],
      ["emergency", "비상 대응"],
    ]
      .map(([a, t]) =>
        btn(
          "view",
          t,
          `data-id="${a}" class="${(p.settings.viewMode || "all") === a ? "active" : ""}"`,
        ),
      )
      .join(
        "",
      )}</div><p class="small muted">방문객 보기에서는 내부용 시설과 인력 배치를 숨깁니다. 전체 계획 수량은 유지됩니다.</p><div class="section-title">저장한 위치</div>${btn("save-view", "현재 위치 저장")}${p.meta.event.views.map((v, i) => `<div class="saved-view">${btn("load-view", esc(v.name), `data-id="${i}"`)}${btn("delete-view", "삭제", `data-id="${i}"`)}</div>`).join("")}`;
  }
  publish() {
    const d = this.cb.project().meta.event.document;
    return (
      form(
        "document",
        `${input("subtitle", "부제 / 안내문 제목", d.subtitle, "text", 'maxlength="160"')}<label>하단 안내 문구<textarea name="notice" rows="3" maxlength="2000">${esc(d.notice)}</textarea></label>${input("accent", "출력 강조색", d.accent, "color")}`,
        "출력 정보 저장",
      ) +
      `<div class="section-title">안내도 만들기</div><div class="stack"><label>용도<select id="publication-audience"><option value="visitor">방문객 안내 · 내부 정보 제외</option><option value="operation">운영팀 내부용</option></select></label><label>템플릿<select id="publication-template"><option value="guide">종합 안내도 + 시설 목록 + 시간표</option><option value="operation">운영 배치도 + 수량</option><option value="schedule">프로그램 시간표</option></select></label><label>용지<select id="publication-paper"><option>A4 landscape</option><option>A4 portrait</option><option>A3 landscape</option><option>A3 portrait</option></select></label>${btn("preview", "안내도 미리보기 / PDF", 'class="primary"')}${btn("png", "완성 배치도 PNG 저장")}${btn("html", "읽기 전용 안내 파일 저장")}<div class="row">${btn("frame", "현재 화면을 출력 범위로")}${btn("clear-frame", "전체 시설 맞춤")}</div><p class="small muted">직접 올린 그림과 시설을 출력합니다. 네이버 지도 배경이 필요한 출력은 상단 인쇄를 사용하세요. 방문객 파일에는 연락처·업무지시·내부용 객체가 포함되지 않습니다.</p></div>`
    );
  }
  options() {
    return {
      visitor:
        document.getElementById("publication-audience")?.value !== "operation",
      template:
        document.getElementById("publication-template")?.value || "guide",
      paper:
        document.getElementById("publication-paper")?.value || "A4 landscape",
    };
  }
  change(label, fn) {
    this.cb.mutate(label, fn);
    this.cb.render();
  }
  async action(action, id) {
    const p = this.cb.project(),
      c = this.cb;
    if (action === "tab") {
      this.tab = id;
      this.pager = 1;
      c.render();
    }
    if (action === "more") {
      this.pager++;
      c.render();
    }
    if (action === "kit") {
      c.closePanel();
      c.place(createVenueKit(c.map.view.center, p.objects, id));
      c.toast(
        "기본 배치안을 확인한 뒤 지도를 눌러 배치하세요. 현장에 맞게 위치를 수정하세요.",
      );
    }
    if (action === "batch") {
      c.modal(
        "규격 시설 일괄 배치",
        form(
          "batch",
          `<label>시설 종류<select name="kind">${Object.entries(kinds)
            .map(([k, t]) => `<option value="${k}">${t}</option>`)
            .join(
              "",
            )}</select></label><div class="two-col">${input("width", "너비 (m)", 3, "number", 'min="0.5" max="1000" step="0.1" required')}${input("depth", "깊이 (m)", 3, "number", 'min="0.5" max="1000" step="0.1" required')}${input("rows", "줄 수", 2, "number", 'min="1" max="200" required')}${input("columns", "한 줄 개수", 5, "number", 'min="1" max="200" required')}${input("gapX", "가로 간격 (m)", 1, "number", 'min="0" max="1000" step="0.1" required')}${input("gapY", "줄 간격 (m)", 5, "number", 'min="0" max="1000" step="0.1" required')}${input("rotation", "회전 (°)", 0, "number", 'min="-360" max="360"')}${input("start", "시작 번호", 1, "number", 'min="1" max="99999" required')}</div><div class="two-col">${input("prefix", "번호 접두사", "B", "text", 'maxlength="20"')}${input("group", "그룹 이름", "체험 부스", "text", 'maxlength="80" required')}</div><p class="small muted">다음 단계에서 지도를 눌러 배치합니다. 완료 전 미리보기로 위치를 확인하세요. 한 번에 최대 200개.</p>`,
          "지도에서 배치",
        ),
      );
    }
    if (action === "note") {
      const o = newObject("marker", "note", [c.map.view.center], "안내 문구");
      o.annotation.text = "안내 문구를 입력하세요";
      o.details.audience = "both";
      c.place([o]);
      c.closeModal();
    }
    if (action === "select-group") {
      const selection = c.selection(),
        first = selection[0];
      if (!first?.bundle && !first?.group)
        throw new Error("그룹이 지정된 시설을 선택하세요.");
      c.select(
        p.objects
          .filter((o) =>
            first.bundle ? o.bundle === first.bundle : o.group === first.group,
          )
          .map((o) => o.id),
      );
      c.toast("그룹을 선택했습니다. 드래그해 함께 이동하세요.");
    }
    if (action === "transform") {
      c.modal(
        "선택 시설 정렬·회전",
        form(
          "transform",
          `${input("rotate", "선택 중심 기준 회전 (°)", 0, "number", 'min="-360" max="360"')}<label>중심 정렬<select name="align"><option value="">변경 안 함</option><option value="left">왼쪽</option><option value="center">가로 중심</option><option value="right">오른쪽</option><option value="top">위쪽</option><option value="middle">세로 중심</option><option value="bottom">아래쪽</option></select></label><label>균등 간격<select name="distribute"><option value="">변경 안 함</option><option value="horizontal">가로</option><option value="vertical">세로</option></select></label><p class="small muted">잠긴 객체는 유지합니다. 실행취소로 되돌릴 수 있습니다.</p>`,
          "적용",
        ),
      );
    }
    if (action === "locate") {
      c.select([id]);
      c.map.fit(p.objects.filter((o) => o.id === id).flatMap(pointsOf));
      c.closePanel();
    }
    if (action === "details") {
      const o = p.objects.find((o) => o.id === id);
      if (!o) return;
      if (o.locked) throw new Error("먼저 잠금을 해제하세요.");
      const d = o.details;
      c.modal(
        "시설 안내 정보",
        form(
          "details",
          `<input type="hidden" name="id" value="${o.id}">${input("name", "시설 이름", o.name, "text", 'required maxlength="120"')}${input("number", "시설 번호", d.number, "text", 'maxlength="30"')}<label>안내 설명<textarea name="description" maxlength="2000" rows="3">${esc(d.description)}</textarea></label><label>공개 범위<select name="audience">${[
            ["both", "공통"],
            ["visitor", "방문객용"],
            ["internal", "내부용"],
          ]
            .map(
              ([k, t]) =>
                `<option value="${k}" ${d.audience === k ? "selected" : ""}>${t}</option>`,
            )
            .join(
              "",
            )}</select></label><label class="check-label"><input name="listed" type="checkbox" ${d.listed ? "checked" : ""}/>시설 안내 목록에 포함</label>${o.facility ? `<div class="two-col">${input("width", "너비 (m)", o.facility.width, "number", 'min="0.5" max="1000" step="0.1"')}${input("depth", "깊이 (m)", o.facility.depth, "number", 'min="0.5" max="1000" step="0.1"')}${input("rotation", "회전 (°)", o.facility.rotation, "number", 'min="-360" max="360"')}</div><label class="check-label"><input name="resize" type="checkbox"/>입력 규격의 사각형으로 다시 만들기</label>` : ""}`,
        ),
      );
    }
    if (action === "program")
      this.programDialog(p.meta.event.programs.find((s) => s.id === id));
    if (action === "delete-program")
      c.confirm("프로그램 삭제", "삭제 후 실행취소로 복구할 수 있습니다.", () =>
        this.change(
          "프로그램 삭제",
          (p) =>
            (p.meta.event.programs = p.meta.event.programs.filter(
              (s) => s.id !== id,
            )),
        ),
      );
    if (action === "import-program")
      c.modal(
        "프로그램 일괄 가져오기",
        `<p class="small muted">엑셀에서 복사해 붙여넣거나 CSV를 선택하세요. 필수 제목: 날짜, 시작, 종료, 프로그램. 선택: 종료일, 장소, 분류, 설명, 공개.</p><label class="studio-file">CSV / TSV 파일 선택<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" data-studio-file="programs"></label>${form("import-program", '<textarea name="table" rows="8" required placeholder="날짜&#9;시작&#9;종료&#9;프로그램&#9;장소\n2026-10-19&#9;10:00&#9;11:00&#9;개막식&#9;메인 무대"></textarea>', "검증 후 추가")}`,
      );
    if (action === "export-program")
      download(
        programCSV(p.meta.event.programs, p),
        fileName(`${p.title}_프로그램`, "csv"),
        "text/csv;charset=utf-8",
      );
    if (action === "background-center")
      this.change(
        "배경 위치 이동",
        (p) => (p.meta.event.background.center = clone(c.map.view.center)),
      );
    if (action === "background-delete")
      c.confirm(
        "배경 그림 삭제",
        "그림을 삭제합니다. 실행취소로 복구할 수 있습니다.",
        () => this.change("배경 삭제", (p) => (p.meta.event.background = null)),
      );
    if (action === "view")
      this.change("작업 보기 변경", (p) => (p.settings.viewMode = id));
    if (action === "save-view") {
      if (p.meta.event.views.length >= 20)
        throw new Error("위치는 20개까지 저장할 수 있습니다.");
      c.modal(
        "현재 위치 저장",
        form(
          "view",
          input("name", "위치 이름", "", "text", 'required maxlength="60"'),
        ),
      );
    }
    if (action === "load-view") {
      const v = p.meta.event.views[Number(id)];
      if (v) {
        c.map.setView(clone(v.view));
        this.change("저장한 보기 적용", (p) => {
          p.view = clone(v.view);
          p.settings.viewMode = v.mode;
        });
      }
    }
    if (action === "delete-view")
      this.change("위치 삭제", (p) => p.meta.event.views.splice(Number(id), 1));
    if (action === "frame") {
      const m = c.map;
      this.change(
        "출력 범위 저장",
        (p) =>
          (p.meta.event.document.frame = [
            m.unproject({ x: 0, y: 0 }),
            m.unproject({ x: m.size.width, y: m.size.height }),
          ]),
      );
      c.toast("현재 지도의 범위를 저장했습니다.");
    }
    if (action === "clear-frame") {
      this.change(
        "출력 범위 해제",
        (p) => (p.meta.event.document.frame = null),
      );
      c.toast("전체 시설을 출력에 맞춥니다.");
    }
    if (action === "preview") {
      const options = this.options();
      c.closePanel();
      openPublication(p, options);
    }
    if (action === "png") {
      await exportSchematicPNG(p, this.options());
      c.toast("배경 그림을 포함한 배치도 PNG를 저장했습니다.");
    }
    if (action === "html") {
      const { publicationHTML } = await import("./publication.js");
      download(
        publicationHTML(p, this.options()),
        fileName(`${p.title}_안내`, "html"),
        "text/html;charset=utf-8",
      );
    }
  }
  programDialog(s = {}) {
    const p = this.cb.project();
    this.cb.modal(
      "프로그램 편집",
      form(
        "program",
        `<input type="hidden" name="id" value="${esc(s.id || "")}">${input("title", "프로그램 이름", s.title, "text", 'required maxlength="120"')}<div class="two-col">${input("date", "시작일", s.date || p.meta.plan.startDate, "date", "required")}${input("endDate", "종료일 (같은 날이면 비움)", s.endDate, "date")}${input("start", "시작", s.start || "10:00", "time", "required")}${input("end", "종료", s.end || "11:00", "time", "required")}</div><label>연결할 시설<select name="placeId"><option value="">직접 장소 입력</option>${p.objects
          .filter((o) => o.type !== "line" && o.kind !== "note")
          .map(
            (o) =>
              `<option value="${o.id}" ${s.placeId === o.id ? "selected" : ""}>${esc(o.details?.number)} ${esc(o.name)}</option>`,
          )
          .join(
            "",
          )}</select></label>${input("venue", "장소 이름", s.venue, "text", 'maxlength="120"')}${input("category", "분류", s.category, "text", 'maxlength="50"')}<label>설명<textarea name="description" rows="3" maxlength="2000">${esc(s.description || "")}</textarea></label><label class="check-label"><input type="checkbox" name="public" ${s.public !== false ? "checked" : ""}/>방문객 안내에 공개</label>`,
      ),
    );
  }
  async submit(id, v) {
    const c = this.cb,
      p = c.project();
    if (id === "batch") {
      const objects = createFacilityBatch(
        {
          ...v,
          rows: Number(v.rows),
          columns: Number(v.columns),
          name: kinds[v.kind],
        },
        c.map.view.center,
        p.objects,
      );
      c.closeModal();
      c.closePanel();
      c.place(objects);
      return;
    }
    if (id === "transform") {
      const updated = transformGroup(c.selection(), {
        rotate: Number(v.rotate),
        align: v.align,
        distribute: v.distribute,
      });
      this.change("그룹 정렬·회전", (p) => {
        const byId = new Map(updated.map((o) => [o.id, o]));
        p.objects = p.objects.map((o) => byId.get(o.id) || o);
      });
    }
    if (id === "details") {
      if (
        v.number &&
        p.objects.some((o) => o.id !== v.id && o.details?.number === v.number)
      )
        throw new Error("이미 사용 중인 시설 번호입니다.");
      this.change("시설 안내 수정", (p) => {
        const o = p.objects.find((o) => o.id === v.id);
        if (!o || o.locked) return;
        const old = o.name;
        if (o.label.text === old) o.label.text = v.name;
        if (o.label.text === o.details.number)
          o.label.text = v.number || v.name;
        o.name = v.name.trim();
        o.details = {
          number: v.number.trim(),
          description: v.description,
          audience: v.audience,
          listed: !!v.listed,
        };
        if (o.facility && v.resize)
          resizeFacility(
            o,
            Number(v.width),
            Number(v.depth),
            Number(v.rotation),
          );
      });
    }
    if (id === "program") {
      const s = normalizeProgram({ ...v, public: !!v.public });
      if (
        !p.meta.event.programs.some((x) => x.id === s.id) &&
        p.meta.event.programs.length >= 2000
      )
        throw new Error("프로그램은 2,000개까지 저장합니다.");
      this.change("프로그램 저장", (p) => {
        const i = p.meta.event.programs.findIndex((x) => x.id === s.id);
        if (i < 0) p.meta.event.programs.push(s);
        else p.meta.event.programs[i] = s;
      });
    }
    if (id === "import-program") {
      this.importPrograms(parseProgramTable(v.table));
      return;
    }
    if (id === "background") {
      const width = Number(v.width),
        height = Number(v.height),
        rotation = Number(v.rotation),
        opacity = Number(v.opacity) / 100;
      if (
        ![width, height].every((n) => n >= 1 && n <= 50000) ||
        !Number.isFinite(rotation) ||
        Math.abs(rotation) > 360 ||
        !(opacity >= 0.1 && opacity <= 1)
      )
        throw new Error("배경 규격을 확인하세요.");
      this.change("배경 규격 변경", (p) =>
        Object.assign(p.meta.event.background, {
          width,
          height,
          rotation,
          opacity,
          enabled: !!v.enabled,
        }),
      );
      c.toast("배경을 적용했습니다.");
      return;
    }
    if (id === "view")
      this.change("현재 위치 저장", (p) =>
        p.meta.event.views.push({
          name: v.name.trim(),
          view: clone(c.map.view),
          mode: p.settings.viewMode || "all",
        }),
      );
    if (id === "document") {
      this.change("출력 정보 저장", (p) =>
        Object.assign(p.meta.event.document, v),
      );
      c.toast("출력 정보를 저장했습니다.");
      return;
    }
    c.closeModal();
  }
  importPrograms(items) {
    const p = this.cb.project();
    if (p.meta.event.programs.length + items.length > 2000)
      throw new Error("프로그램 총 2,000개를 초과합니다.");
    const byName = new Map(p.objects.map((o) => [o.name, o.id]));
    this.change("프로그램 일괄 가져오기", (p) =>
      p.meta.event.programs.push(
        ...items.map((s) => ({ ...s, placeId: byName.get(s.venue) || "" })),
      ),
    );
    this.cb.closeModal();
    this.tab = "programs";
    this.cb.render();
    this.cb.toast(`${items.length}개 프로그램을 추가했습니다.`);
  }
  async file(kind, file) {
    if (!file) return;
    if (kind === "programs") {
      if (file.size > 4000000) throw new Error("CSV는 4MB 이하로 가져오세요.");
      this.importPrograms(parseProgramTable(await file.text()));
      return;
    }
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 20000000
    )
      throw new Error("PNG·JPEG·WebP 20MB 이하 이미지를 선택하세요.");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 80000000)
        throw new Error(
          "이미지 해상도가 너무 큽니다. 8천만 화소 이하를 선택하세요.",
        );
      const ratio = Math.min(
          1,
          2400 / Math.max(image.naturalWidth, image.naturalHeight),
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL("image/webp", 0.88);
      if (data.length > 4000000)
        throw new Error("압축한 이미지가 너무 큽니다. 작은 파일을 선택하세요.");
      this.change(
        "배경 그림 가져오기",
        (p) =>
          (p.meta.event.background = {
            data,
            name: file.name,
            center: clone(this.cb.map.view.center),
            width: 200,
            height: (200 * image.naturalHeight) / image.naturalWidth,
            rotation: 0,
            opacity: 1,
            enabled: true,
          }),
      );
      this.cb.toast("배경 그림을 추가했습니다. 실제 규격을 입력하세요.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

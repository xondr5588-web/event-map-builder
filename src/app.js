import "./styles.css";
import { PRIVATE_MODE, verifyPrivateAccess } from "./access.js";
import { CATALOG, TYPE_LABELS, kindInfo } from "./catalog.js";
import {
  clone,
  newProject,
  newObject,
  migrate,
  parseImport,
  exportProject,
  uid,
} from "./model.js";
import { History } from "./history.js";
import {
  Repository,
  ConflictError,
  writeJournal,
  clearJournal,
  recoverJournals,
  protectSession,
} from "./storage.js";
import { MapAdapter, MAP_CLIENT_ID, PLACE_URL } from "./map.js";
import { Renderer, escapeHTML as esc } from "./renderer.js";
import { Editor } from "./editor.js";
import { PrintView } from "./print.js";
import { icon } from "./icons.js";
import { markerSymbol } from "./symbols.js";
import {
  planningHTML,
  summaryHTML,
  operationsFields,
  openReport,
  closeReport,
} from "./planning-ui.js";
import { deploymentCSV, PLAN_STATUS } from "./operations.js";
import {
  pointsOf,
  area,
  length,
  meters,
  squareMeters,
  center,
  clamp,
} from "./geometry.js";
import { download, fileName, shareProject, exportOverlayPNG } from "./files.js";
const $ = (id) => document.getElementById(id),
  mobile = () =>
    matchMedia("(max-width:760px), (max-height:520px) and (max-width:1000px)")
      .matches;
const time = (ts) =>
  new Date(ts).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const button = (action, label, ic, cls = "") =>
  `<button data-action="${action}" class="${cls}">${ic ? icon(ic, 17) : ""}${label}</button>`;
let project = newProject(),
  history = new History(),
  repo,
  map,
  renderer,
  editor,
  printer;
let panel = "tools",
  multi = false,
  objectQuery = "",
  objectType = "",
  objectPage = 1,
  saveTimer,
  viewTimer,
  savePromise = Promise.resolve(),
  dirty = false,
  saving = false,
  readOnly = false,
  saveError = false,
  generation = 0,
  clipboard = [],
  searchSerial = 0,
  installPrompt = null,
  swRegistration = null;
let lastCheckpoint = 0,
  lastCheckpointKey = "",
  currentToolName = "",
  recent = [],
  favorite = [];
try {
  recent = JSON.parse(localStorage.getItem("emb:recent") || "[]");
  favorite = JSON.parse(localStorage.getItem("emb:favorites") || "[]");
} catch {
  recent = [];
  favorite = [];
}
recent = Array.isArray(recent)
  ? recent.filter((x) => x && CATALOG[x.type]?.[x.kind]).slice(0, 4)
  : [];
favorite = Array.isArray(favorite)
  ? favorite.filter((k) => CATALOG.marker[k])
  : [];
function icons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((n) => {
    n.innerHTML = icon(n.dataset.icon);
    n.removeAttribute("data-icon");
  });
}
icons();
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 4000);
}
function alertPersistent(msg) {
  $("persistent-alert").innerHTML =
    `${esc(msg)} ${button("export", "JSON 백업", "download")} ${button("retry-save", "저장 재시도", "save")} ${button("dismiss-alert", "닫기")}`;
  $("persistent-alert").hidden = false;
}
function status(msg, error = false) {
  $("save-status").textContent = msg;
  $("save-status").style.color = error ? "#b15b27" : "";
}
function safe(run) {
  return async (...args) => {
    try {
      return await run(...args);
    } catch (e) {
      console.error(e);
      toast(e.message || "작업에 실패했습니다.");
    }
  };
}
function modal(title, html) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  if (!$("modal").open) $("modal").showModal();
}
function confirmDialog(title, text, action, confirmLabel = "확인") {
  modal(
    title,
    `<p class="muted">${esc(text)}</p><div class="dialog-actions">${button("close-modal", "취소")}${button("confirm-dialog", confirmLabel, null, "primary")}</div>`,
  );
  $("modal-body").querySelector('[data-action="confirm-dialog"]').onclick =
    safe(async () => {
      $("modal").close();
      await action();
    });
}
function inputDialog(title, value, label, action) {
  modal(
    title,
    `<form id="name-form" class="stack"><label>${esc(label)}<input id="dialog-input" value="${esc(value)}" required maxlength="120"/></label><div class="dialog-actions">${button("close-modal", "취소")}<button type="submit" class="primary">저장</button></div></form>`,
  );
  $("dialog-input").select();
  $("name-form").onsubmit = safe(async (e) => {
    e.preventDefault();
    const v = $("dialog-input").value.trim();
    if (!v) return;
    $("modal").close();
    await action(v);
  });
}
function journal() {
  try {
    writeJournal(localStorage, project);
  } catch {
    status("종료 전 복구 저장 공간 부족 · 저장 중", true);
  }
}
function markDirty() {
  if (readOnly) return;
  project.updatedAt = Date.now();
  generation++;
  dirty = true;
  journal();
  status("저장 중…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush().catch(() => {}), 350);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!repo || readOnly) return false;
  savePromise = savePromise
    .catch(() => {})
    .then(async () => {
      if (!dirty) return true;
      saving = true;
      let ok = true;
      try {
        while (dirty) {
          const version = generation,
            snapshot = clone(project);
          let saved;
          try {
            saved = await repo.save(snapshot, snapshot.revision);
          } catch (e) {
            if (!(e instanceof ConflictError)) throw e;
            const oldId = project.id,
              oldRevision = snapshot.revision;
            snapshot.id = uid();
            snapshot.revision = 0;
            snapshot.title += " (충돌 복구 사본)";
            saved = await repo.save(snapshot, 0);
            project.id = saved.id;
            project.title = saved.title;
            clearJournal(localStorage, oldId, oldRevision);
            alertPersistent(
              "다른 창의 변경을 덮어쓰지 않도록 현재 작업을 별도 프로젝트로 보관했습니다.",
            );
          }
          project.revision = saved.revision;
          if (version === generation) {
            project.updatedAt = saved.updatedAt;
            dirty = false;
            clearJournal(localStorage, project.id, saved.revision);
          } else journal();
          try {
            localStorage.setItem("emb:last-project", project.id);
          } catch {}
        }
        status(`자동저장 완료 · ${time(project.updatedAt)}`);
        saveError = false;
        $("project-title").textContent = project.title;
      } catch (e) {
        ok = false;
        saveError = true;
        status("저장 실패 · JSON 백업 필요", true);
        alertPersistent(
          `저장에 실패했습니다. 현재 작업은 화면에 유지됩니다. ${e.message}`,
        );
      } finally {
        saving = false;
      }
      return ok;
    });
  return savePromise;
}
function commit(before, label) {
  if (readOnly) {
    project = before;
    return;
  }
  if (history.record(before, project, label)) {
    markDirty();
    refresh(false);
  }
}
function mutate(label, fn) {
  if (readOnly) {
    toast("저장소를 사용할 수 없습니다. JSON 백업 후 다시 열어 주세요.");
    return;
  }
  const before = clone(project);
  fn(project);
  commit(before, label);
}
function refresh(panelToo = true) {
  $("stage").classList.toggle("has-objects", project.objects.length > 0);
  $("project-title").textContent = project.title;
  $("object-count").textContent = project.objects.length;
  document
    .querySelectorAll('[data-action="undo"]')
    .forEach((b) => (b.disabled = !history.undoStack.length));
  document
    .querySelectorAll('[data-action="redo"]')
    .forEach((b) => (b.disabled = !history.redoStack.length));
  for (const id of editor?.selection || [])
    if (!project.objects.some((o) => o.id === id)) editor.selection.delete(id);
  editor?.request();
  renderCommand();
  renderInspector();
  if (panelToo || panel === "objects") renderPanel();
  if (panel === "plan" && $("plan-summary"))
    $("plan-summary").innerHTML = summaryHTML(project);
}
function viewChanged() {
  if (!map || printer?.active) return;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    if (JSON.stringify(project.view) !== JSON.stringify(map.view)) {
      project.view = clone(map.view);
      markDirty();
    }
  }, 450);
}
function changedMap() {
  editor?.request();
  $("zoom-level").textContent = map.view.zoom;
  $("coordinates").textContent =
    `${map.view.center.lat.toFixed(6)}, ${map.view.center.lng.toFixed(6)}`;
}
function showPanel(name) {
  panel = name;
  $("panel").classList.add("open");
  renderPanel();
  document
    .querySelectorAll("[data-panel]")
    .forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
}
function closePanel() {
  $("panel").classList.remove("open");
  document
    .querySelectorAll("#mobile-nav button")
    .forEach((b) => b.classList.remove("active"));
}
function toolCard(type, kind, wide = false) {
  const info = kindInfo({ type, kind }),
    active = editor?.tool?.type === type && editor?.tool?.kind === kind;
  return `<button class="tool-card ${active ? "active" : ""} ${wide ? "wide" : ""}" data-tool="${type}:${kind}" style="--tool-color:${info[1]}" aria-label="${esc(info[0])} 만들기"><span class="tool-icon">${type === "marker" ? markerSymbol(kind, 34) : icon(info[2], 21)}</span><span class="tool-text">${esc(info[0])}</span></button>`;
}
function renderTools() {
  return `<div class="panel-intro"><b>현장을 그리다.</b>구역과 동선, 사람을 지도 위에 배치하세요.</div><label class="tool-name">새 객체 이름 <span class="small muted">비워두면 자동으로 이름을 붙입니다.</span><input id="tool-name" placeholder="예: 제1주차장" maxlength="120" value="${esc(currentToolName)}"/></label>${favorite.length ? `<div class="section-title">즐겨찾는 마커</div><div class="tool-grid">${favorite.map((k) => toolCard("marker", k)).join("")}</div>` : ""}${
    recent.length
      ? `<div class="section-title">최근 사용</div><div class="tool-grid">${recent
          .slice(0, 2)
          .map((t) => toolCard(t.type, t.kind))
          .join("")}</div>`
      : ""
  }${Object.entries(CATALOG)
    .map(
      ([type, kinds]) =>
        `<div class="section-title">${TYPE_LABELS[type]}<span>${type === "area" ? "AREA" : type === "line" ? "ROUTE" : "PEOPLE & FACILITIES"}</span></div><div class="tool-grid">${Object.keys(
          kinds,
        )
          .map((k) => toolCard(type, k))
          .join("")}</div>`,
    )
    .join(
      "",
    )}<div class="section-title">빠른 배치</div>${button("io", "주차장 IN / OUT 함께 만들기", "in")}<div class="help-card"><strong>지도 이동도 편집도, 자연스럽게</strong>도구를 고른 뒤 지도를 눌러 점을 추가하세요.<br>구역·동선은 완료 버튼으로 저장합니다.<br>마커는 연속 배치할 수 있습니다.</div>`;
}
function metric(o) {
  return o.type === "area"
    ? squareMeters(area(o.path))
    : o.type === "line"
      ? meters(length(o.path))
      : `${o.position.lat.toFixed(5)}, ${o.position.lng.toFixed(5)}`;
}
function renderObjects() {
  const filtered = project.objects.filter(
    (o) =>
      (!objectType || o.type === objectType) &&
      `${o.name} ${kindInfo(o)[0]} ${o.group}`
        .toLowerCase()
        .includes(objectQuery.toLowerCase()),
  );
  const visible = filtered.slice(0, objectPage * 60);
  return `<input id="object-search" class="object-filter" type="search" placeholder="이름 · 종류 · 그룹 찾기" aria-label="객체 검색" value="${esc(objectQuery)}"/><div class="layer-controls">${Object.entries(
    TYPE_LABELS,
  )
    .map(
      ([t, n]) =>
        `<label><input type="checkbox" data-layer="${t}" ${project.settings.layers[t] ? "checked" : ""}/>${n}</label>`,
    )
    .join(
      "",
    )}<label><input type="checkbox" data-setting="labels" ${project.settings.labels ? "checked" : ""}/>라벨</label></div><div class="row"><select id="object-type" aria-label="객체 종류 필터"><option value="">전체 종류</option>${Object.entries(
    TYPE_LABELS,
  )
    .map(
      ([t, n]) =>
        `<option value="${t}" ${t === objectType ? "selected" : ""}>${n}</option>`,
    )
    .join(
      "",
    )}</select><button data-action="multi" class="${multi ? "active" : ""}" style="white-space:nowrap;font-size:12px">다중 선택</button></div>${editor.selection.size ? `<div class="bulk-bar"><span>${editor.selection.size}개 선택</span>${button("properties", "속성")}${button("duplicate", "복제")}${button("delete", "삭제")}</div>` : ""}<div class="object-list">${visible.map((o) => `<div class="object-row ${editor.selection.has(o.id) ? "selected" : ""}" style="--object-color:${o.style.color}"><input type="checkbox" data-select="${o.id}" aria-label="${esc(o.name)} 선택" ${editor.selection.has(o.id) ? "checked" : ""}/><button class="object-link" data-object-open="${o.id}" title="선택하고 지도에서 보기">${o.type === "marker" ? markerSymbol(o.kind, 28) : icon(kindInfo(o)[2], 18)}<span>${esc(o.name)}${o.locked ? " 🔒" : ""}<small>${esc(metric(o))}${o.group ? ` · ${esc(o.group)}` : ""}</small></span></button><button class="object-visibility" data-visible="${o.id}" aria-label="${esc(o.name)} ${o.visible ? "숨기기" : "보이기"}">${icon(o.visible ? "eye" : "hidden", 17)}</button></div>`).join("") || `<div class="empty-state">${icon("layers", 28)}${project.objects.length ? "검색 결과가 없습니다." : "아직 배치한 객체가 없습니다.<br>만들기에서 첫 구역을 추가해 보세요."}</div>`}</div>${filtered.length > visible.length ? `<button data-action="more-objects" style="margin-top:12px;width:100%">더 보기 (${visible.length} / ${filtered.length})</button>` : ""}<div class="help-card">여러 객체를 선택해 색상·그룹을 한 번에 바꿀 수 있습니다. 눈 아이콘으로 잠시 숨기세요.</div>`;
}
async function renderProjects() {
  const host = $("panel-content");
  host.innerHTML = `<div class="row">${button("new-project", "새 프로젝트", "plus", "primary")}${button("import", "가져오기", "upload")}</div><div class="section-title">최근 프로젝트</div><div id="project-list" aria-live="polite">불러오는 중…</div><div class="section-title">안전하게 보관하기</div><div class="row wrap">${button("backup", "전체 백업", "download")}${button("trash-list", "휴지통", "trash")}</div>`;
  const target = $("project-list");
  if (!repo) {
    target.textContent = "저장소를 연결하지 못했습니다.";
    return;
  }
  const list = await repo.list();
  if (!target.isConnected) return;
  target.innerHTML =
    list
      .map(
        (p) =>
          `<article class="project-card ${p.id === project.id ? "active" : ""}"><button class="project-open" data-project-open="${p.id}">${esc(p.title)}</button><div class="meta">${time(p.updatedAt)} · 객체 ${p.objects.length}개${p.id === project.id ? " · 현재 작업" : ""}</div><div class="row"><button data-project-rename="${p.id}">이름 변경</button><button data-project-copy="${p.id}">복제</button><button data-project-delete="${p.id}" class="danger">삭제</button></div></article>`,
      )
      .join("") || '<p class="muted">저장된 프로젝트가 없습니다.</p>';
}
function renderPanel() {
  if (!editor) return;
  if (panel === "projects") {
    renderProjects().catch((e) => toast(e.message));
    return;
  }
  const body = $("panel-content"),
    scroll = body.scrollTop;
  body.innerHTML =
    panel === "plan"
      ? planningHTML(project)
      : panel === "objects"
        ? renderObjects()
        : panel === "properties"
          ? inspectorHTML()
          : renderTools();
  body.scrollTop = scroll;
}
function selectedObjects() {
  return project.objects.filter((o) => editor.selection.has(o.id));
}
function inspectorHTML() {
  const objects = selectedObjects(),
    o = objects[0];
  if (!o)
    return `<div class="empty-state">지도에서 객체를 선택해 주세요.</div>`;
  const many = objects.length > 1,
    locked = objects.every((o) => o.locked);
  return `<div class="inspector-heading"><span>${many ? `${objects.length}개 객체 선택` : esc(kindInfo(o)[0])}</span>${button("deselect", "", "close")}</div><div class="stack">${!many ? `<label>객체 이름<input data-prop="name" value="${esc(o.name)}" maxlength="120" ${o.locked ? "disabled" : ""}/></label><label>라벨<input data-prop="label.text" value="${esc(o.label.text)}" maxlength="120" ${o.locked ? "disabled" : ""}/></label>` : ""}<div class="two-col"><label>색상<input type="color" data-prop="style.color" value="${o.style.color}" ${locked ? "disabled" : ""}/></label><label>그룹<input data-prop="group" value="${esc(o.group)}" maxlength="80" placeholder="예: 주차 A팀" ${locked ? "disabled" : ""}/></label></div><div class="two-col">${objects.some((x) => x.type !== "marker") ? `<label>선 두께<input type="number" data-prop="style.width" min="1" max="30" value="${o.style.width}" ${locked ? "disabled" : ""}/></label><label>불투명도 (%)<input type="number" data-prop="style.opacity" min="0" max="100" value="${Math.round(o.style.opacity * 100)}" ${locked ? "disabled" : ""}/></label>` : ""}${!many && o.type === "line" ? `<label>${o.kind === "cone" ? "라바콘" : "화살표"} 간격 (m)<input type="number" data-prop="style.spacing" min="1" max="500" value="${o.style.spacing}" ${o.locked ? "disabled" : ""}/></label>` : ""}${!many && o.type === "marker" ? `<label>회전 (°)<input type="number" data-prop="rotation" step="15" value="${o.rotation}" ${o.locked ? "disabled" : ""}/></label>` : ""}</div><div class="row wrap"><label class="check-label"><input type="checkbox" data-prop="label.visible" ${objects.every((o) => o.label.visible) ? "checked" : ""} ${locked ? "disabled" : ""}/>라벨 표시</label><label class="check-label"><input type="checkbox" data-prop="locked" ${locked ? "checked" : ""}/>잠금</label></div></div>${!many ? `<div class="inspector-metric">${esc(metric(o))}</div>` : ""}<div class="inspector-actions">${!many ? `${button("edit", "위치 편집", "edit", "primary")}${button("fit-selection", "선택 맞춤", "fit")}` : ""}${button("duplicate", "복제", "copy")}${button("delete", "삭제", "trash", "danger")}${!many && o.type === "line" ? button("reverse", "방향 반전", "arrow") : ""}${!many && o.type === "marker" ? button("favorite", favorite.includes(o.kind) ? "즐겨찾기 해제" : "즐겨찾기", "star") : ""}${button("front", "맨 앞으로", "up")}${button("back", "맨 뒤로", "down")}</div>${!many ? `<details style="margin-top:13px"><summary class="muted">라벨 위치 조절</summary><div class="two-col" style="margin-top:10px"><label>가로 (px)<input type="number" data-prop="label.dx" min="-5000" max="5000" value="${Math.round(o.label.dx)}" ${o.locked ? "disabled" : ""}/></label><label>세로 (px)<input type="number" data-prop="label.dy" min="-5000" max="5000" value="${Math.round(o.label.dy)}" ${o.locked ? "disabled" : ""}/></label></div>${button("reset-label", "라벨 위치 초기화")}</details>` : ""}<label class="element-size-field">요소 크기 (%)<input type="number" data-prop="style.scale" min="25" max="400" value="${Math.round(o.style.scale * 100)}" ${locked ? "disabled" : ""}/></label>${operationsFields(objects, project)}`;
}
function renderInspector() {
  if (!editor) return;
  const show =
    editor.selection.size > 0 &&
    !editor.tool &&
    !editor.editing &&
    !printer?.active;
  $("inspector").hidden = !show;
  if (show) $("inspector").innerHTML = inspectorHTML();
  if (mobile() && panel === "properties" && show) renderPanel();
}
function renderCommand() {
  if (!editor) return;
  $("stage").classList.toggle(
    "editor-engaged",
    !!editor.tool || editor.editing,
  );
  const bar = $("command-bar");
  document
    .querySelectorAll('[data-action="select"]')
    .forEach((b) =>
      b.classList.toggle("active", editor.mode === "select" && !editor.tool),
    );
  document
    .querySelectorAll('[data-action="pan"]')
    .forEach((b) => b.classList.toggle("active", editor.mode === "pan"));
  let text = "";
  if (editor.tool) {
    const name = editor.io
      ? `${editor.io} · ${editor.points.length ? "OUT" : "IN"} 위치`
      : kindInfo(editor.tool)[0];
    text = `<div class="command-title">${icon(kindInfo(editor.tool)[2], 17)}<b>${esc(name)}</b><small>${editor.tool.type === "marker" ? "연속 배치" : `${editor.points.length}개 점 · ${editor.metric()}`}</small></div><div class="command-actions">${button("cancel", "취소")}${editor.tool.type !== "marker" ? button("back-point", "한 점 취소") : ""}${button("center-point", editor.tool.type === "marker" ? "중심에 배치" : "중심에 점 추가")}${!editor.io ? button("finish", "완료", "check", "primary") : ""}</div><div class="command-hint">지도를 탭하여 배치 · 드래그로 이동 · 두 손가락으로 확대</div>`;
  } else if (editor.editing) {
    text = `<div class="command-title">${icon("edit", 17)}<b>위치 편집</b><small>점·객체·라벨 드래그</small></div><div class="command-actions">${button("cancel", "편집 종료")}${editor.vertex >= 0 ? button("delete-vertex", `${editor.vertex + 1}번 점 삭제`) : ""}${button("finish", "완료", "check", "primary")}</div><div class="command-hint">작은 +를 눌러 점 추가 · 점을 선택하면 삭제할 수 있습니다.</div>`;
  } else if (mobile() && editor.selection.size) {
    text = `<div class="command-title"><b>${editor.selection.size === 1 ? esc(selectedObjects()[0]?.name || "객체") : editor.selection.size + "개 선택"}</b>${button("deselect", "", "close")}</div><div class="command-actions">${button("properties", "속성", "settings")}${editor.selection.size === 1 ? button("edit", "위치 편집", "edit") : button("duplicate", "복제", "copy")}${button("delete", "삭제", "trash")}</div>`;
  }
  bar.hidden = !text;
  bar.innerHTML = text;
  let cross = $("center-crosshair");
  if (editor.tool && !cross) {
    cross = document.createElement("div");
    cross.className = "center-crosshair";
    cross.id = "center-crosshair";
    $("map-shell").append(cross);
  } else if (!editor.tool) cross?.remove();
}
function useTool(type, kind) {
  currentToolName = $("tool-name")?.value.trim() ?? currentToolName;
  editor.setMode("draw", { type, kind });
  editor.selection.clear();
  recent = [
    { type, kind },
    ...recent.filter((t) => t.type !== type || t.kind !== kind),
  ].slice(0, 4);
  try {
    localStorage.setItem("emb:recent", JSON.stringify(recent));
  } catch {}
  closePanel();
  renderInspector();
  renderCommand();
  if (!mobile()) renderPanel();
}
function onSelection() {
  renderInspector();
  renderCommand();
  if (panel === "objects") renderPanel();
}
async function openProject(p) {
  if (!(await flush())) {
    toast(
      "저장이 완료되지 않아 프로젝트 전환을 중단했습니다. JSON으로 백업해 주세요.",
    );
    return;
  }
  clearTimeout(viewTimer);
  project = migrate(p).project;
  history = new History();
  dirty = false;
  generation++;
  editor.cancel();
  editor.selection.clear();
  map.setView(project.view);
  try {
    localStorage.setItem("emb:last-project", p.id);
  } catch {}
  status(`저장됨 · ${time(p.updatedAt)}`);
  closePanel();
  panel = "tools";
  refresh();
}
async function createProject() {
  if (!(await flush())) return;
  const p = await repo.save(newProject(), 0);
  await openProject(p);
  showPanel("tools");
  inputDialog("새 프로젝트", p.title, "프로젝트 이름", (name) =>
    mutate("프로젝트 이름 변경", (p) => (p.title = name)),
  );
}
function duplicateSelection() {
  const selected = selectedObjects();
  if (!selected.length) return;
  mutate("객체 복제", (p) => {
    const ids = [];
    for (const o of selected) {
      const copy = clone(o);
      copy.id = uid();
      copy.name += " 사본";
      if (copy.label.text === o.name) copy.label.text = copy.name;
      copy.locked = false;
      const shift = (c) => {
        const q = map.project(c);
        return map.unproject({ x: q.x + 28, y: q.y + 28 });
      };
      if (copy.position) copy.position = shift(copy.position);
      else copy.path = copy.path.map(shift);
      if (copy.label.position) copy.label.position = shift(copy.label.position);
      p.objects.push(copy);
      ids.push(copy.id);
    }
    editor.selection = new Set(ids);
  });
}
function deleteSelection() {
  const removable = selectedObjects().filter((o) => !o.locked);
  if (!removable.length) {
    toast("잠긴 객체는 잠금을 해제한 후 삭제하세요.");
    return;
  }
  const del = () => {
    mutate(
      "객체 삭제",
      (p) =>
        (p.objects = p.objects.filter(
          (o) => !removable.some((s) => s.id === o.id),
        )),
    );
    editor.selection.clear();
    editor.editing = false;
    refresh();
    toast(`${removable.length}개 삭제 · 실행 취소로 복구할 수 있습니다.`);
  };
  if (removable.length > 1)
    confirmDialog(
      "선택한 객체 삭제",
      `${removable.length}개 객체를 삭제할까요? 잠긴 객체는 유지됩니다.`,
      del,
      "삭제",
    );
  else del();
}
async function saveVersion() {
  if (!(await flush())) return;
  await repo.checkpoint(project);
  lastCheckpoint = Date.now();
  lastCheckpointKey = `${project.id}:${project.revision}`;
  toast("현재 버전을 보관했습니다.");
}
async function showVersions() {
  if (!(await flush())) return;
  const versions = await repo.versions(project.id);
  modal(
    "저장 버전 / 복구",
    `<p class="muted">복구 전 현재 작업도 버전으로 보관합니다.</p><div class="stack">${versions.map((v) => `<div class="version-row"><span class="grow">${esc(v.label)}<small>${time(v.ts)} · 객체 ${v.data.objects.length}개</small></span><button data-version="${v.id}">복구</button></div>`).join("") || '<p class="muted">아직 저장한 버전이 없습니다. 상단 저장 버튼으로 보관하세요.</p>'}</div>`,
  );
}
function more() {
  modal(
    "프로젝트 도구",
    `<div class="menu-grid">${button("import", "JSON 가져오기", "upload")}${button("export", "JSON 내보내기", "download")}${button("backup", "전체 프로젝트 백업", "folder")}${button("share", "프로젝트 파일 공유", "share")}${button("save", "현재 버전 저장", "save")}${button("versions", "이전 버전 복구", "history")}${button("print", "인쇄 / PDF", "print")}${button("png", "운영요소 PNG", "marker")}${button("settings", "지도 · 저장 설정", "settings")}${button("help", "사용법 · 단축키", "info")}${button("install", "홈 화면 설치", "plus")}${swRegistration?.waiting ? button("update-app", "업데이트 적용", "check") : ""}</div>`,
  );
  $("modal-body")
    .querySelector(".menu-grid")
    .insertAdjacentHTML(
      "afterbegin",
      `${button("plan", "행사 운영계획", "folder")}${button("operations-report", "운영계획서 / PDF", "print")}${button("deployment-csv", "배치 명세 CSV", "download")}`,
    );
  if (PRIVATE_MODE) {
    const logout = document.createElement("a");
    logout.href = "/signout-with-chatgpt?return_to=%2F";
    logout.target = "_top";
    logout.className = "private-logout";
    logout.textContent = "소유자 전용 · 로그아웃";
    logout.onclick = async (event) => {
      event.preventDefault();
      if (!(await flush())) return;
      map?.destroy();
      window.location.assign(logout.href);
    };
    $("modal-body").append(logout);
  }
}
function settings() {
  modal(
    "지도 · 저장 설정",
    `<div class="stack"><label class="check-label"><input type="checkbox" data-setting="snap" ${project.settings.snap ? "checked" : ""}/>인접한 점에 붙이기 (스냅)</label><label class="check-label"><input type="checkbox" id="haptic" ${localStorage.getItem("emb:haptic") !== "off" ? "checked" : ""}/>터치 진동</label><label>운영 메모<textarea id="project-note" rows="3" maxlength="2000">${esc(project.meta.note)}</textarea></label><p class="muted">지도 공개 식별자: <code>${esc(MAP_CLIENT_ID)}</code><br>장소명 검색 서버: ${PLACE_URL ? "연결 설정됨" : "미설정 (주소·좌표 검색 사용 가능)"}<br>데이터는 현재 브라우저에 저장됩니다. 다른 기기로 옮길 때 JSON 파일을 사용하세요.</p><div class="row wrap">${button("persist", "저장 공간 보호 요청", "lock")}${button("retry-map", "지도 다시 연결", "map")}${button("export-legacy", "이전 원본 백업", "download")}</div></div>`,
  );
  $("modal-body")
    .querySelector(".stack")
    .insertAdjacentHTML(
      "afterbegin",
      `<div class="scale-settings"><b>지도 축척과 요소 크기</b><label class="check-label"><input type="checkbox" data-setting="scaleWithMap" ${project.settings.scaleWithMap ? "checked" : ""}/>지도 축척에 따라 요소 크기 변경</label><label>전체 요소 크기 (%)<input type="number" data-view-setting="symbolSize" min="25" max="300" value="${Math.round(project.settings.symbolSize * 100)}"/></label><button data-action="reference-zoom">현재 지도 확대 수준을 기준으로</button><p class="small muted">기준 확대 ${project.settings.referenceZoom} · 마커·라벨·선 굵기·동선 장식에 적용합니다. 선택용 터치 영역은 최소 크기를 유지합니다.</p></div>`,
    );
}
function help() {
  modal(
    "FIELD 사용법",
    `<ol class="help-list"><li><b>주소·좌표를 검색</b>해 현장으로 이동하세요. 장소명 검색은 설정된 검색 서버를 사용합니다.</li><li><b>만들기 → 종류 선택</b> 후 지도에 점을 놓으세요. 구역은 3점, 동선은 2점 이상 놓고 완료합니다.</li><li><b>객체 선택 → 위치 편집</b>에서 마커, 도형, 흰 점, 라벨을 드래그하세요. 작은 +를 누르면 점이 추가됩니다.</li><li>스마트폰은 하단 메뉴로 도구창을 열고 닫습니다. 객체를 길게 눌러 편집을 시작할 수도 있습니다. 두 손가락으로 확대하고, 지도 빈 곳을 밀어 이동하세요.</li><li>모든 변경은 자동저장됩니다. 중요한 시점에는 <b>버전 저장</b>을 누르고, JSON 파일도 보관하세요.</li><li><b>출력</b>에서 용지와 범례를 정한 뒤 PDF / 인쇄를 누르세요. 지도 저작권 표시는 유지됩니다.</li></ol><div class="muted"><kbd>V</kbd> 선택 · <kbd>H</kbd> 이동 · <kbd>F</kbd> 전체 맞춤<br><kbd>Enter</kbd> 완료 · <kbd>Esc</kbd> 취소 · <kbd>Backspace</kbd> 마지막 점 삭제<br><kbd>Ctrl/⌘ Z</kbd> 취소 · <kbd>Ctrl/⌘ Shift Z</kbd> 다시 실행<br><kbd>Ctrl/⌘ S</kbd> 버전 저장 · <kbd>Ctrl/⌘ D</kbd> 복제<br><kbd>Ctrl/⌘ C / V</kbd> 객체 복사 / 붙여넣기 · <kbd>Shift+클릭</kbd> 다중 선택</div>`,
  );
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024)
    throw new Error("파일은 50MB 이하여야 합니다.");
  const parsed = parseImport(await file.text());
  confirmDialog(
    "프로젝트 가져오기",
    `${parsed.projects.length}개 프로젝트, ${parsed.projects.reduce((s, p) => s + p.objects.length, 0)}개 객체를 새 프로젝트로 가져옵니다. 기존 프로젝트는 유지됩니다.${parsed.warnings.length ? " " + parsed.warnings.join(" ") : ""}`,
    async () => {
      if (!(await flush())) return;
      const added = await repo.importAll(
        parsed.projects,
        parsed.versions,
        parsed.legacyBackups,
      );
      const active = added.find((p) => !p.deletedAt);
      if (active) {
        await openProject(active);
        map.fit(project.objects.flatMap(pointsOf));
        viewChanged();
      }
      toast("가져오기를 완료했습니다.");
      showPanel("projects");
    },
    "가져오기",
  );
}
async function install() {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    return;
  }
  modal(
    "홈 화면에 설치",
    `<div class="stack"><p class="muted"><b>Android Chrome / Samsung Internet</b><br>브라우저 메뉴 → 앱 설치 또는 홈 화면에 추가</p><p class="muted"><b>iPhone / iPad Safari</b><br>공유 버튼 → 홈 화면에 추가 → 추가</p><p class="muted">HTTPS에서 한 번 실행한 후 앱 화면을 오프라인으로 열 수 있습니다. 배경지도와 주소 검색에는 인터넷이 필요합니다. 설치와 브라우저가 저장 공간을 별도로 사용할 수 있으므로 먼저 JSON 백업을 권장합니다.</p></div>`,
  );
}
const actions = {
  plan: () => {
    $("modal").close();
    showPanel("plan");
  },
  "deployment-csv": () =>
    download(
      deploymentCSV(project),
      fileName(`${project.title}_배치명세`, "csv"),
      "text/csv;charset=utf-8",
    ),
  "operations-report": () => {
    $("modal").close();
    if (printer.active) printer.exit();
    openReport(project, () => actions["deployment-csv"]());
  },
  "reference-zoom": () => {
    mutate("축척 기준 변경", (p) => (p.settings.referenceZoom = map.view.zoom));
    settings();
  },
  "close-modal": () => $("modal").close(),
  "close-panel": closePanel,
  "dismiss-alert": () => ($("persistent-alert").hidden = true),
  more: more,
  help: help,
  settings: settings,
  install: install,
  "new-project": createProject,
  select: () => {
    editor.setMode("select");
    renderInspector();
  },
  pan: () => {
    editor.setMode("pan");
    renderInspector();
  },
  undo: () => {
    editor.cancelGesture();
    project = history.undo(project);
    editor.points = [];
    editor.vertex = -1;
    markDirty();
    refresh();
  },
  redo: () => {
    editor.cancelGesture();
    project = history.redo(project);
    editor.points = [];
    editor.vertex = -1;
    markDirty();
    refresh();
  },
  fit: () => {
    map.fit(
      project.objects
        .filter((o) => o.visible && project.settings.layers[o.type])
        .flatMap(pointsOf),
    );
    viewChanged();
  },
  "fit-selection": () => {
    map.fit(selectedObjects().flatMap(pointsOf));
    viewChanged();
    closePanel();
  },
  "zoom-in": () => {
    map.zoom(1);
    viewChanged();
  },
  "zoom-out": () => {
    map.zoom(-1);
    viewChanged();
  },
  "map-type": () => {
    const types = ["hybrid", "normal", "satellite", "terrain"],
      labels = ["위성", "일반", "항공", "지형"],
      i = (types.indexOf(map.view.type) + 1) % 4;
    map.setView({ ...map.view, type: types[i] });
    $("map-type").textContent = labels[i];
    viewChanged();
  },
  locate: () => {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        map.moveTo({ lat: p.coords.latitude, lng: p.coords.longitude }, 17);
        viewChanged();
      },
      () => toast("위치 권한과 GPS를 확인하세요."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  },
  cancel: () => {
    editor.cancel();
    renderInspector();
  },
  finish: () => editor.finish(),
  "back-point": () => editor.back(),
  "center-point": () => editor.addPoint(map.view.center),
  "delete-vertex": () => editor.removeVertex(),
  deselect: () => {
    editor.select(null);
    if (panel === "properties") showPanel("tools");
  },
  properties: () => {
    if (mobile()) showPanel("properties");
    else renderInspector();
  },
  edit: () => {
    if (selectedObjects()[0]?.locked) {
      toast("잠금을 해제한 후 편집하세요.");
      return;
    }
    editor.startEdit();
    closePanel();
    $("inspector").hidden = true;
  },
  multi: () => {
    multi = !multi;
    renderPanel();
  },
  "more-objects": () => {
    objectPage++;
    renderPanel();
  },
  duplicate: duplicateSelection,
  delete: deleteSelection,
  reverse: () =>
    mutate("방향 반전", (p) =>
      p.objects
        .filter(
          (o) => editor.selection.has(o.id) && o.type === "line" && !o.locked,
        )
        .forEach((o) => o.path.reverse()),
    ),
  front: () =>
    mutate(
      "앞으로 이동",
      (p) =>
        (p.objects = [
          ...p.objects.filter((o) => !editor.selection.has(o.id) || o.locked),
          ...p.objects.filter((o) => editor.selection.has(o.id) && !o.locked),
        ]),
    ),
  back: () =>
    mutate(
      "뒤로 이동",
      (p) =>
        (p.objects = [
          ...p.objects.filter((o) => editor.selection.has(o.id) && !o.locked),
          ...p.objects.filter((o) => !editor.selection.has(o.id) || o.locked),
        ]),
    ),
  "reset-label": () =>
    mutate("라벨 위치 초기화", (p) =>
      p.objects
        .filter((o) => editor.selection.has(o.id) && !o.locked)
        .forEach(
          (o) =>
            (o.label = {
              ...o.label,
              dx: 0,
              dy: o.type === "marker" ? 34 : 0,
              manual: false,
              position: undefined,
            }),
        ),
    ),
  favorite: () => {
    const k = selectedObjects()[0]?.kind;
    if (!CATALOG.marker[k]) return;
    favorite = favorite.includes(k)
      ? favorite.filter((x) => x !== k)
      : [...favorite, k];
    localStorage.setItem("emb:favorites", JSON.stringify(favorite));
    renderInspector();
    if (panel === "tools") renderPanel();
  },
  save: saveVersion,
  versions: showVersions,
  export: () => download(exportProject(project), fileName(project.title)),
  share: async () => {
    try {
      await shareProject(project);
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    }
  },
  backup: async () => {
    if (!(await flush())) return;
    download(
      JSON.stringify(await repo.backup(), null, 2),
      `FIELD_전체백업_${new Date().toISOString().slice(0, 10)}.json`,
    );
  },
  import: () => {
    $("modal").close();
    $("import-file").click();
  },
  png: async () => {
    $("modal").close();
    await exportOverlayPNG($("editor"), project.title);
    toast("지도 배경을 제외한 운영요소 PNG를 저장했습니다.");
  },
  print: () => {
    $("modal").close();
    closePanel();
    printer.enter();
  },
  "print-now": () => printer.print(),
  "exit-print": () => {
    printer.exit();
    refresh();
  },
  "retry-save": async () => {
    if (!repo) {
      location.reload();
      return;
    }
    if (await flush()) {
      $("persistent-alert").hidden = true;
      toast("저장을 완료했습니다.");
    }
  },
  "retry-map": async () => {
    $("modal").close();
    if (map.online) {
      map.resize();
      return;
    }
    map.destroy();
    map = new MapAdapter($("map"), project.view, changedMap, onMapStatus);
    editor.map = map;
    renderer.map = map;
    printer.map = map;
    await map.start();
  },
  persist: async () => {
    const ok = await navigator.storage?.persist?.();
    toast(
      ok
        ? "지속적인 저장 공간이 허용되었습니다."
        : "브라우저가 저장 공간 보호를 허용하지 않았습니다. JSON으로 주기적으로 백업하세요.",
    );
  },
  "export-legacy": async () => {
    const originals = await repo.all("legacy");
    if (!originals.length) {
      toast("이전 버전에서 가져온 원본이 없습니다.");
      return;
    }
    download(JSON.stringify({ originals }, null, 2), "FIELD_이전원본백업.json");
  },
  "trash-list": async () => {
    const trashed = (await repo.list(true)).filter((p) => p.deletedAt);
    modal(
      "프로젝트 휴지통",
      trashed
        .map(
          (p) =>
            `<div class="version-row"><span class="grow">${esc(p.title)}<small>${time(p.deletedAt)} 삭제</small></span><button data-restore-project="${p.id}">복구</button></div>`,
        )
        .join("") || '<p class="muted">삭제한 프로젝트가 없습니다.</p>',
    );
  },
  io: () => {
    const parks = project.objects.filter(
      (o) => o.type === "area" && ["parking", "vip"].includes(o.kind),
    );
    if (!parks.length) {
      toast("주차장 구역을 먼저 만들어 주세요.");
      return;
    }
    modal(
      "주차장 IN / OUT",
      `<p class="muted">주차장을 고르고 지도에서 IN, OUT 위치를 차례로 누르세요.</p><select id="parking-select" aria-label="주차장 선택">${parks.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select><div class="dialog-actions">${button("start-io", "배치 시작", "in", "primary")}</div>`,
    );
  },
  "start-io": () => {
    const name = project.objects.find(
      (o) => o.id === $("parking-select").value,
    )?.name;
    if (!name) return;
    editor.setMode("draw", { type: "marker", kind: "gateIn" });
    editor.io = name;
    $("modal").close();
    closePanel();
    renderCommand();
  },
  "update-app": async () => {
    if (!(await flush())) return;
    swRegistration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
  },
};
document.addEventListener(
  "click",
  safe(async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.action) {
      e.preventDefault();
      if (actions[b.dataset.action]) await actions[b.dataset.action]();
      return;
    }
    if (b.dataset.panel) {
      if (
        panel === b.dataset.panel &&
        $("panel").classList.contains("open") &&
        mobile()
      )
        closePanel();
      else showPanel(b.dataset.panel);
      return;
    }
    if (b.dataset.tool) {
      useTool(...b.dataset.tool.split(":"));
      return;
    }
    if (b.dataset.objectOpen) {
      editor.select(b.dataset.objectOpen, multi);
      if (!multi) {
        map.fit(selectedObjects().flatMap(pointsOf));
        viewChanged();
        closePanel();
      }
      return;
    }
    if (b.dataset.visible) {
      mutate("표시 변경", (p) => {
        const o = p.objects.find((o) => o.id === b.dataset.visible);
        o.visible = !o.visible;
      });
      return;
    }
    if (b.dataset.projectOpen) {
      if (b.dataset.projectOpen === project.id) {
        closePanel();
        return;
      }
      await openProject(await repo.read("projects", b.dataset.projectOpen));
      return;
    }
    if (b.dataset.projectRename) {
      const p = await repo.read("projects", b.dataset.projectRename);
      inputDialog(
        "프로젝트 이름 변경",
        p.title,
        "프로젝트 이름",
        async (title) => {
          if (p.id === project.id) {
            mutate("프로젝트 이름 변경", (p) => (p.title = title));
            await flush();
          } else {
            p.title = title;
            await repo.save(p, p.revision);
          }
          renderPanel();
        },
      );
      return;
    }
    if (b.dataset.projectCopy) {
      if (!(await flush())) return;
      const p = clone(await repo.read("projects", b.dataset.projectCopy));
      p.id = uid();
      p.title += " 사본";
      p.revision = 0;
      p.createdAt = Date.now();
      await repo.save(p, 0);
      renderPanel();
      toast("프로젝트를 복제했습니다.");
      return;
    }
    if (b.dataset.projectDelete) {
      const id = b.dataset.projectDelete;
      confirmDialog(
        "프로젝트 삭제",
        "휴지통으로 이동합니다. 프로젝트 메뉴에서 복구할 수 있습니다.",
        async () => {
          if (!(await flush())) return;
          await repo.trash(id);
          if (id === project.id) {
            let next = (await repo.list())[0];
            if (!next) next = await repo.save(newProject(), 0);
            await openProject(next);
          }
          showPanel("projects");
        },
        "삭제",
      );
      return;
    }
    if (b.dataset.restoreProject) {
      await repo.restore(b.dataset.restoreProject);
      $("modal").close();
      showPanel("projects");
      toast("프로젝트를 복구했습니다.");
      return;
    }
    if (b.dataset.version) {
      const v = await repo.read("versions", b.dataset.version);
      confirmDialog(
        "이 버전으로 복구",
        `${time(v.ts)}의 상태로 복구합니다. 현재 상태도 별도로 보관됩니다.`,
        async () => {
          if (!(await flush())) return;
          await repo.checkpoint(project, "버전 복구 전 자동 보관");
          const before = clone(project),
            restored = migrate(v.data).project;
          restored.id = project.id;
          restored.revision = project.revision;
          project = restored;
          history.record(before, project, "버전 복구");
          editor.cancel();
          map.setView(project.view);
          markDirty();
          await flush();
          refresh();
          toast("버전을 복구했습니다.");
        },
        "복구",
      );
    }
  }),
);
document.addEventListener(
  "change",
  safe(async (e) => {
    const t = e.target;
    if (t.dataset.select) {
      editor.select(t.dataset.select, true);
      return;
    }
    if (t.dataset.layer) {
      mutate(
        "레이어 표시 변경",
        (p) => (p.settings.layers[t.dataset.layer] = t.checked),
      );
      return;
    }
    if (t.dataset.setting) {
      mutate("설정 변경", (p) => (p.settings[t.dataset.setting] = t.checked));
      return;
    }
    if (t.dataset.plan) {
      const key = t.dataset.plan;
      let value = t.type === "number" ? Number(t.value) : t.value;
      if (t.type === "number") {
        if (t.value === "" || !Number.isFinite(value)) {
          toast("유효한 숫자를 입력하세요.");
          return;
        }
        value =
          key === "parkingAreaPerCar"
            ? clamp(value, 10, 200)
            : Math.floor(clamp(value, 0, 10000000));
      }
      if (key === "status" && !PLAN_STATUS[value]) return;
      mutate("행사 운영계획 변경", (p) => (p.meta.plan[key] = value));
      return;
    }
    if (t.dataset.viewSetting === "symbolSize") {
      if (t.value === "" || !Number.isFinite(Number(t.value))) return;
      mutate(
        "전체 요소 크기 변경",
        (p) => (p.settings.symbolSize = clamp(Number(t.value), 25, 300) / 100),
      );
      return;
    }
    if (t.dataset.prop) {
      const key = t.dataset.prop;
      let v =
        t.type === "checkbox"
          ? t.checked
          : t.type === "number"
            ? Number(t.value)
            : t.value;
      if (key === "operations.capacity" && t.value === "") v = null;
      else if (t.type === "number") {
        if (!Number.isFinite(v) || t.value === "") {
          toast("숫자를 입력하세요.");
          renderInspector();
          return;
        }
        const limits = {
          "style.width": [1, 30],
          "style.opacity": [0, 100],
          "style.spacing": [1, 500],
          rotation: [-36000, 36000],
          "label.dx": [-5000, 5000],
          "label.dy": [-5000, 5000],
          "style.scale": [25, 400],
          "operations.quantity": [1, 9999],
          "operations.capacity": [0, 100000],
        };
        v = clamp(v, ...(limits[key] || [-5000, 5000]));
      }
      if (key === "style.opacity") v /= 100;
      if (key === "style.scale") v /= 100;
      if (
        ["operations.quantity", "operations.capacity"].includes(key) &&
        v !== null
      )
        v = Math.floor(v);
      mutate("속성 변경", (p) =>
        p.objects
          .filter(
            (o) =>
              editor.selection.has(o.id) && (!o.locked || key === "locked"),
          )
          .forEach((o) => {
            const parts = key.split(".");
            if (parts.length === 2) o[parts[0]][parts[1]] = v;
            else {
              if (key === "name" && o.label.text === o.name) o.label.text = v;
              o[key] = v;
            }
            if (key === "label.dx" || key === "label.dy") o.label.manual = true;
          }),
      );
      renderInspector();
      return;
    }
    if (t.id === "object-type") {
      objectType = t.value;
      objectPage = 1;
      renderPanel();
    }
    if (t.id === "import-file") {
      try {
        await importFile(t.files[0]);
      } finally {
        t.value = "";
      }
    }
    if (t.id === "project-note")
      mutate("운영 메모 변경", (p) => (p.meta.note = t.value));
    if (t.id === "haptic")
      localStorage.setItem("emb:haptic", t.checked ? "on" : "off");
  }),
);
document.addEventListener("input", (e) => {
  if (e.target.id === "tool-name") currentToolName = e.target.value;
  if (e.target.id === "object-search") {
    objectQuery = e.target.value;
    objectPage = 1;
    const pos = e.target.selectionStart;
    renderPanel();
    $("object-search").focus();
    try {
      $("object-search").setSelectionRange(pos, pos);
    } catch {}
  }
});
$("project-title").onclick = () =>
  inputDialog("프로젝트 이름", project.title, "프로젝트 이름", (title) =>
    mutate("프로젝트 이름 변경", (p) => (p.title = title)),
  );
$("search-form").onsubmit = safe(async (e) => {
  e.preventDefault();
  const query = $("address-search").value.trim();
  if (!query) return;
  const seq = ++searchSerial;
  $("search-results").hidden = false;
  $("search-results").textContent = "검색 중…";
  try {
    const results = await map.search(query);
    if (seq !== searchSerial) return;
    if (!results.length) {
      $("search-results").innerHTML =
        `<p class="muted" style="padding:12px">검색 결과가 없습니다. 도로명·지번 주소로 검색해 주세요.${!PLACE_URL ? " 장소명 검색은 설정된 검색 서버가 필요합니다." : ""}</p><a style="display:block;padding:12px;font-size:12px" target="_blank" rel="noopener noreferrer" href="https://map.naver.com/p/search/${encodeURIComponent(query)}">네이버 지도에서 장소 주소 확인 ↗</a>`;
      return;
    }
    $("search-results").innerHTML = results
      .map(
        (r, i) =>
          `<button type="button" data-search-result="${i}">${esc(r.title)}<small>${esc(r.address)}</small></button>`,
      )
      .join("");
    $("search-results").onclick = (e) => {
      const b = e.target.closest("[data-search-result]");
      if (!b) return;
      const r = results[+b.dataset.searchResult];
      map.moveTo(r.position, 17);
      viewChanged();
      $("search-results").hidden = true;
      $("address-search").blur();
    };
  } catch (error) {
    if (seq === searchSerial) {
      $("search-results").textContent = error.message;
      $("search-results").style.padding = "12px";
    }
  }
});
window.addEventListener(
  "keydown",
  safe(async (e) => {
    if (!editor) return;
    const typing =
      /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
      e.target.isContentEditable;
    if (typing) return;
    if ($("modal").open) return;
    if (document.body.classList.contains("report-mode")) {
      if (e.key === "Escape") closeReport();
      return;
    }
    const mod = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    let action;
    if (e.key === "Escape") {
      if (printer.active) printer.exit();
      else {
        editor.cancel();
        editor.select(null);
        closePanel();
      }
      $("search-results").hidden = true;
      return;
    }
    if (mod && key === "z") action = e.shiftKey ? "redo" : "undo";
    else if (mod && key === "y") action = "redo";
    else if (mod && key === "s") action = "save";
    else if (mod && key === "d") action = "duplicate";
    else if (mod && key === "c") {
      clipboard = clone(selectedObjects());
      if (clipboard.length) {
        e.preventDefault();
        toast(`${clipboard.length}개 객체 복사`);
      }
      return;
    } else if (mod && key === "v") {
      if (!clipboard.length) return;
      e.preventDefault();
      mutate("객체 붙여넣기", (p) => {
        const all = clipboard.flatMap(pointsOf),
          c = center(all),
          delta = {
            lat: map.view.center.lat - c.lat,
            lng: map.view.center.lng - c.lng,
          },
          ids = [];
        const move = (q) => ({
          lat: clamp(q.lat + delta.lat, -85, 85),
          lng: clamp(q.lng + delta.lng, -180, 180),
        });
        for (const original of clipboard) {
          const o = clone(original);
          o.id = uid();
          o.locked = false;
          if (o.position) o.position = move(o.position);
          else o.path = o.path.map(move);
          if (o.label.position) o.label.position = move(o.label.position);
          p.objects.push(o);
          ids.push(o.id);
        }
        editor.selection = new Set(ids);
      });
      return;
    } else if (!mod && e.key === "Enter") action = "finish";
    else if (!mod && e.key === "Backspace" && editor.points.length)
      action = "back-point";
    else if (!mod && (e.key === "Delete" || e.key === "Backspace"))
      action = "delete";
    else if (!mod && key === "v") action = "select";
    else if (!mod && key === "h") action = "pan";
    else if (!mod && key === "f") action = "fit";
    if (action) {
      e.preventDefault();
      await actions[action]();
    }
  }),
);
function onMapStatus(state, message) {
  $("map").style.visibility = state === "online" ? "visible" : "hidden";
  $("map-provider").textContent =
    state === "online"
      ? "NAVER Maps"
      : state === "offline"
        ? "배경지도 없음"
        : "지도 연결 확인 필요";
  $("map-notice").hidden = state !== "error";
  if (state !== "online")
    $("map-notice").innerHTML =
      `${esc(message)} ${button("retry-map", "다시 시도")}`;
  $("offline-grid").hidden = state === "online";
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener("offline", () => {
  toast("오프라인입니다. 작업은 기기에 계속 저장됩니다.");
  $("connection-label").textContent = "오프라인 · 기기 저장";
});
window.addEventListener("online", () => {
  $("connection-label").textContent = "로컬 작업 공간";
  if (!map.online)
    toast("인터넷에 연결되었습니다. 지도 다시 시도를 눌러 주세요.");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && dirty) {
    journal();
    flush().catch(() => {});
  }
});
window.addEventListener("pagehide", () => {
  if (dirty) journal();
});
window.addEventListener("beforeunload", (e) => {
  if (saveError || saving || dirty) {
    journal();
    if (saveError) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
});
window.addEventListener("resize", () => {
  renderCommand();
  if (!mobile()) $("panel").classList.remove("open");
});
window.addEventListener("error", (e) => {
  if (!e.message || /Script error/.test(e.message)) return;
  alertPersistent(
    "예기치 않은 오류가 발생했습니다. 작업을 JSON으로 백업해 주세요.",
  );
});
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  alertPersistent(
    "작업 처리 중 오류가 발생했습니다. JSON 백업 후 다시 시도해 주세요.",
  );
});
async function boot() {
  protectSession();
  let notices = [];
  try {
    repo = await new Repository().open();
    notices.push(...(await repo.migrateLegacy(localStorage)));
    notices.push(...(await recoverJournals(repo, localStorage)));
    let list = await repo.list(),
      last;
    try {
      last = localStorage.getItem("emb:last-project");
    } catch {}
    project =
      list.find((p) => p.id === last) ||
      list[0] ||
      (await repo.save(newProject(), 0));
    project = migrate(project).project;
  } catch (e) {
    readOnly = true;
    repo = null;
    alertPersistent(
      `브라우저 저장소를 열지 못했습니다: ${e.message}. 비공개 모드 또는 저장 공간을 확인하세요.`,
    );
  }
  map = new MapAdapter($("map"), project.view, changedMap, onMapStatus);
  renderer = new Renderer($("editor"), map);
  editor = new Editor($("editor"), map, renderer, {
    project: () => project,
    restore: (p) => {
      project = p;
    },
    commit,
    viewChanged,
    modeChanged: () => {
      renderCommand();
      renderInspector();
    },
    selectionChanged: onSelection,
    toolName: () => currentToolName,
    multi: () => multi,
    toast,
    haptic: () => {
      try {
        if (localStorage.getItem("emb:haptic") !== "off")
          navigator.vibrate?.(12);
      } catch {}
    },
  });
  printer = new PrintView(map, editor, () => project);
  refresh();
  status(readOnly ? "저장소 연결 실패" : "자동저장 준비됨", readOnly);
  changedMap();
  map.start();
  if (notices.length) alertPersistent(notices.join(" "));
  // Periodic recovery versions, only when a new revision exists and after a successful save.
  setInterval(async () => {
    if (
      !repo ||
      dirty ||
      saving ||
      Date.now() - lastCheckpoint < 300000 ||
      lastCheckpointKey === `${project.id}:${project.revision}` ||
      !history.undoStack.length
    )
      return;
    try {
      await repo.checkpoint(project, "자동 복구 지점");
      lastCheckpoint = Date.now();
      lastCheckpointKey = `${project.id}:${project.revision}`;
    } catch {
      status("복구 지점 저장 실패 · JSON 백업 권장", true);
    }
  }, 60000);
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register(
        new URL("sw.js", document.baseURI),
        { scope: "./" },
      );
      swRegistration.addEventListener("updatefound", () => {
        const worker = swRegistration.installing;
        worker?.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            toast("새 버전이 준비되었습니다. 더 보기에서 업데이트하세요.");
        });
      });
    } catch {
      toast(
        "오프라인 앱 캐시를 준비하지 못했습니다. 온라인으로 계속 사용할 수 있습니다.",
      );
    }
  }
}
function showAccessGate() {
  $("app").hidden = true;
  document.querySelector(".auth-screen")?.remove();
  const screen = document.createElement("main");
  screen.className = "auth-screen";
  screen.innerHTML =
    '<div><b>FIELD · 비공개 작업 공간</b><h1>소유자 로그인이 필요합니다.</h1><p>네트워크와 로그인 상태를 확인한 후 다시 연결하세요.<br/>저장된 프로젝트는 이 브라우저에 유지됩니다.</p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">ChatGPT 계정으로 로그인</a><button id="access-retry">다시 확인</button></div>';
  document.body.append(screen);
  document.getElementById("access-retry").onclick = () =>
    window.location.reload();
}
if (PRIVATE_MODE) $("app").hidden = true;
try {
  await verifyPrivateAccess();
  $("app").hidden = false;
  await boot();
  if (PRIVATE_MODE) {
    $("connection-label").textContent = "소유자 전용 작업 공간";
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) return;
      try {
        await verifyPrivateAccess();
      } catch {
        await flush();
        map?.destroy();
        showAccessGate();
      }
    });
  }
} catch (error) {
  if (PRIVATE_MODE) showAccessGate();
  else throw error;
}

import "./public-access.css";
import { Repository, recoverJournals } from "./storage.js";
import { download } from "./files.js";
import { PRIVATE_APP_URL } from "./deployment.js";

document.title = "FIELD · 비공개 작업 공간";
document.body.innerHTML = `<main class="access-card">
  <div class="brand"><img src="./icons/icon.svg" width="44" height="44" alt=""/><span>FIELD<small>행사 주차·교통 운영도</small></span></div>
  <span class="badge">로그인 전용으로 전환</span>
  <h1>내 작업 공간에서<br/>안전하게 이어가세요.</h1>
  <p>운영도 편집과 네이버 지도는 소유자 계정으로 로그인한 전용 사이트에서 사용할 수 있습니다.</p>
  <a id="private-link" class="primary">로그인하여 운영도 열기 <span aria-hidden="true">↗</span></a>
  <section aria-labelledby="backup-title"><h2 id="backup-title">이 주소에 저장했던 작업이 있나요?</h2>
    <p>같은 기기·브라우저에서 백업을 내려받고, 전용 사이트의 <b>프로젝트 → 가져오기</b>로 옮기세요. 기존 데이터는 삭제하지 않습니다.</p>
    <p id="storage-status" role="status">저장된 작업을 확인하고 있습니다…</p>
    <button id="backup" disabled>이전 작업 전체 백업</button>
    <p id="backup-status" role="status" aria-live="polite"></p>
  </section>
  <footer>이 페이지는 지도 API를 호출하지 않습니다.<br/>백업 파일은 이 기기에서 직접 생성됩니다.</footer>
</main>`;
document.getElementById("private-link").href = PRIVATE_APP_URL;
let repository;
try {
  repository = await new Repository().open();
  const notices = [
    ...(await repository.migrateLegacy(localStorage)),
    ...(await recoverJournals(repository, localStorage)),
  ];
  const all = await repository.list(true);
  document.getElementById("storage-status").textContent =
    all.length
      ? `이 브라우저에 프로젝트 ${all.length}개가 있습니다. 휴지통·저장 버전도 함께 백업합니다.`
      : "이 브라우저에 저장된 프로젝트가 없습니다. 작업했던 기기와 브라우저에서 다시 열어주세요.";
  document.getElementById("backup").disabled = false;
  if (notices.length)
    document.getElementById("backup-status").textContent = notices.join(" ");
} catch (error) {
  document.getElementById("storage-status").textContent =
    `저장소에 접근하지 못했습니다. 브라우저의 저장 공간 설정을 확인하세요. ${error.message}`;
}
document.getElementById("backup").onclick = async () => {
  const button = document.getElementById("backup");
  const status = document.getElementById("backup-status");
  button.disabled = true;
  try {
    await recoverJournals(repository, localStorage);
    const backup = await repository.backup();
    // Keep recovery originals as well; active editor windows may still own a journal.
    backup.recoveryOriginals = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (/^(event_map_.*_(autosave|versions)|emb:recovery:)/.test(key))
        backup.recoveryOriginals[key] = localStorage.getItem(key);
    }
    download(JSON.stringify(backup, null, 2), `FIELD-이전작업-전체백업-${new Date().toISOString().slice(0, 10)}.json`);
    status.textContent = "백업 파일을 준비했습니다. 다운로드를 확인한 뒤 전용 사이트에서 가져오세요.";
  } catch (error) {
    status.textContent = `백업 실패: ${error.message}. 원본 데이터는 그대로 유지됩니다.`;
  } finally {
    button.disabled = false;
  }
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" })
    .then((registration) => registration.update()).catch(() => {});

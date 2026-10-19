import { test, expect } from "@playwright/test";
const mobile = (page) =>
  page.viewportSize().width <= 760 ||
  (page.viewportSize().width <= 1000 && page.viewportSize().height <= 520);
async function studio(page, tab = "facilities") {
  if (mobile(page) && !(await page.locator("#panel.open").count()))
    await page.locator("#mobile-nav [data-panel=tools]").click();
  const launch = page.locator("#panel-content [data-action=studio]");
  if (!(await launch.isVisible()))
    await page.locator(".panel-tabs [data-panel=tools]").click();
  await launch.click();
  await page.locator(`[data-studio=tab][data-id=${tab}]`).click();
}
async function closePanel(page) {
  if (mobile(page)) await page.locator("[data-action=close-panel]").click();
}
async function data(page) {
  await expect(page.locator("#save-status")).toContainText("완료");
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("event-map-builder-v1", 1);
        r.onsuccess = () => {
          const q = r.result
            .transaction("projects")
            .objectStore("projects")
            .getAll();
          q.onsuccess = () => {
            r.result.close();
            resolve(q.result.sort((a, b) => b.updatedAt - a.updatedAt)[0]);
          };
          q.onerror = reject;
        };
      }),
  );
}
async function batch(page) {
  await studio(page);
  await page.locator("[data-studio=batch]").click();
  const f = page.locator("[data-studio-form=batch]");
  await f.locator("[name=columns]").fill("4");
  await f.locator("[name=width]").fill("4");
  await f.locator("[name=depth]").fill("3");
  await f.locator("[name=rotation]").fill("15");
  await f.locator("button[type=submit]").click();
  await expect(page.locator("#command-bar")).toContainText("8개");
  await page.locator("#command-bar [data-action=center-point]").click();
  await expect(page.locator(".map-object.area")).toHaveCount(8);
  await expect
    .poll(async () => Number(await page.locator("#zoom-level").innerText()))
    .toBeGreaterThan(16);
}
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto("/?map=offline");
  await expect(page.locator("#save-status")).toContainText("준비됨");
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));
test("measured booth workflow, group transform, facility linkage, undo and reload", async ({
  page,
}, testInfo) => {
  await batch(page);
  let saved = await data(page);
  expect(saved.objects[0].facility.width).toBe(4);
  expect(new Set(saved.objects.map((o) => o.details.number)).size).toBe(8);
  await studio(page);
  await page.locator("#panel-content [data-studio=details]").first().click();
  const f = page.locator("[data-studio-form=details]");
  await f.locator("[name=name]").fill("우리동네 체험관");
  await f.locator("[name=number]").fill("T1");
  await f.locator("[name=description]").fill("지역 공예 체험 · 현장 접수");
  await f.locator("button[type=submit]").click();
  await expect(page.locator("#panel-content")).toContainText("우리동네 체험관");
  await page.locator("#panel-content [data-studio=transform]").click();
  await page.locator("[name=rotate]").fill("30");
  await page
    .locator("[data-studio-form=transform] button[type=submit]")
    .click();
  await closePanel(page);
  saved = await data(page);
  expect(saved.objects.every((o) => o.facility.rotation === 45)).toBeTruthy();
  await page.locator(".map-toolbar [data-action=undo]").click();
  saved = await data(page);
  expect(saved.objects[0].facility.rotation).toBe(15);
  await page.locator(".map-toolbar [data-action=redo]").click();
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(page.locator(".map-object.area")).toHaveCount(8);
  await studio(page);
  await page.screenshot({ path: testInfo.outputPath("studio-facilities.png") });
  await testInfo.attach("studio-facilities", {
    path: testInfo.outputPath("studio-facilities.png"),
    contentType: "image/png",
  });
});
test("program import, linked venue rename, time conflicts and private visitor publication", async ({
  page,
}, testInfo) => {
  await batch(page);
  await studio(page, "programs");
  await page.locator("[data-studio=import-program]").click();
  await page
    .locator("[name=table]")
    .fill(
      "날짜\t시작\t종료\t프로그램\t장소\t설명\t공개\n2026-10-19\t10:00\t11:00\t개막 공연\t메인 무대\t방문객 환영합니다\t예\n2026-10-19\t10:30\t11:30\t체험 행사\t메인 무대\t사전접수\t예\n2026-10-19\t12:00\t13:00\tPRIVATE_STAFF_BRIEFING\t운영본부\tINTERNAL_SECRET\t아니오",
    );
  await page
    .locator("[data-studio-form=import-program] button[type=submit]")
    .click();
  await expect(page.locator(".studio-warning")).toContainText("1쌍");
  await page.locator("[data-studio=tab][data-id=publish]").click();
  await page.locator("[name=subtitle]").fill("가을 축제 안내");
  await page
    .locator("[name=notice]")
    .fill("안전한 행사 관람을 위해 안내에 협조해 주세요.");
  await page.locator("[data-studio-form=document] button[type=submit]").click();
  const pending = page.waitForEvent("download");
  await page.locator("[data-studio=html]").click();
  const download = await pending,
    stream = await download.createReadStream();
  let html = "";
  for await (const chunk of stream) html += chunk;
  expect(html).toContain("개막 공연");
  expect(html).not.toContain("PRIVATE_STAFF_BRIEFING");
  expect(html).not.toContain("INTERNAL_SECRET");
  expect(html).not.toContain("b4anccamja");
  expect(html).not.toContain("naver.com");
  await page.locator("[data-studio=preview]").click();
  const frame = page.frameLocator("#event-publication iframe");
  await expect(frame.locator(".publication-page")).toHaveCount(4);
  await expect(frame.locator("body")).toContainText("시설·부스 안내");
  await expect(frame.locator(".schedule-card")).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("studio-publication.png"),
  });
  await testInfo.attach("studio-publication", {
    path: testInfo.outputPath("studio-publication.png"),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "편집으로 돌아가기" }).click();
  await page.reload();
  await studio(page, "programs");
  await expect(page.locator(".studio-programs article")).toHaveCount(3);
});
test("own background, note editing and complete PNG work offline", async ({
  page,
}, testInfo) => {
  await batch(page);
  await studio(page, "background");
  // A canvas-drawn background is owned test data; no map tile access.
  const buffer = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 500;
    const x = c.getContext("2d");
    x.fillStyle = "#e0efcf";
    x.fillRect(0, 0, 800, 500);
    x.fillStyle = "#94c6dc";
    x.fillRect(0, 0, 150, 500);
    x.fillStyle = "#fff";
    x.fillRect(280, 0, 65, 500);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("[data-studio-file=background]").setInputFiles({
    name: "venue-art.png",
    mimeType: "image/png",
    buffer: Buffer.from(buffer, "base64"),
  });
  await expect(page.locator("[data-studio-form=background]")).toBeVisible();
  await page.locator("[data-studio-form=background] [name=width]").fill("100");
  await page
    .locator("[data-studio-form=background] [name=height]")
    .fill("62.5");
  await page
    .locator("[data-studio-form=background] button[type=submit]")
    .click();
  await expect(page.locator("#editor > image")).toHaveAttribute(
    "display",
    "inline",
  );
  await page.locator("[data-studio=tab][data-id=facilities]").click();
  await page.locator("[data-studio=note]").click();
  if (mobile(page))
    await expect(page.locator("#panel")).not.toHaveClass(/open/);
  await page.locator("#command-bar [data-action=center-point]").click();
  await page.locator("#editor").press("Escape");
  await studio(page, "publish");
  const pending = page.waitForEvent("download");
  await page.locator("[data-studio=png]").click();
  const file = await pending;
  expect(file.suggestedFilename()).toContain("완성안내도.png");
  const stream = await file.createReadStream();
  let bytes = Buffer.alloc(0);
  for await (const chunk of stream) bytes = Buffer.concat([bytes, chunk]);
  expect(bytes.readUInt32BE(16)).toBe(2400);
  expect(bytes.readUInt32BE(20)).toBe(1425);
  await testInfo.attach("complete-map.png", {
    body: bytes,
    contentType: "image/png",
  });
  const saved = await data(page);
  expect(saved.meta.event.background.width).toBe(100);
  expect(saved.objects.some((o) => o.kind === "note")).toBeTruthy();
  await page.reload();
  await expect(page.locator("#editor > image")).toHaveAttribute(
    "display",
    "inline",
  );
});
test("festival starting layout makes an editable numbered venue in one action", async ({
  page,
}, testInfo) => {
  await studio(page);
  await page.locator("[data-studio=kit][data-id=festival]").click();
  await page.locator("#command-bar [data-action=center-point]").click();
  await expect(page.locator(".map-object")).toHaveCount(26);
  const saved = await data(page);
  expect(saved.objects.some((o) => o.kind === "medical")).toBeTruthy();
  expect(saved.objects.filter((o) => o.kind === "booth")).toHaveLength(12);
  await page.locator(".map-toolbar [data-action=undo]").click();
  await expect(page.locator(".map-object")).toHaveCount(0);
  await page.locator(".map-toolbar [data-action=redo]").click();
  await expect(page.locator(".map-object")).toHaveCount(26);
  await studio(page, "publish");
  await page.locator("[data-studio=preview]").click();
  const frame = page.frameLocator("#event-publication iframe");
  await expect(frame.locator(".publication-map > svg")).toBeVisible();
  for (const kind of ["police", "fire"]) {
    const box = await frame
      .locator(`svg[data-symbol=${kind}-emblem]`)
      .boundingBox();
    expect(box.width).toBeLessThan(60);
    expect(box.height).toBeLessThan(60);
  }
  await expect(frame.locator(".publication-facility")).toHaveCount(24);
  await page.screenshot({ path: testInfo.outputPath("festival-guide.png") });
  await testInfo.attach("festival-guide", {
    path: testInfo.outputPath("festival-guide.png"),
    contentType: "image/png",
  });
});
test("publication A4/A3 PDFs retain map, numbered directory and complete program descriptions", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "desktop",
    "PDF export uses desktop Chromium",
  );
  await batch(page);
  await studio(page, "programs");
  await page.locator("[data-studio=import-program]").click();
  await page
    .locator("[name=table]")
    .fill(
      "날짜,시작,종료,프로그램,장소,설명\n2026-10-19,10:00,11:00,개막 공연,메인 무대,방문객 안내문",
    );
  await page
    .locator("[data-studio-form=import-program] button[type=submit]")
    .click();
  await page.locator("[data-studio=tab][data-id=publish]").click();
  const downloadPending = page.waitForEvent("download");
  await page.locator("[data-studio=html]").click();
  const file = await downloadPending,
    stream = await file.createReadStream();
  let html = "";
  for await (const c of stream) html += c;
  const tab = await page.context().newPage();
  await tab.setContent(html);
  await tab.emulateMedia({ media: "print" });
  for (const format of ["A4", "A3"]) {
    const path = testInfo.outputPath(`event-guide-${format}.pdf`);
    await tab.pdf({
      path,
      format,
      landscape: true,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" },
    });
    await testInfo.attach(`event-guide-${format}`, {
      path,
      contentType: "application/pdf",
    });
  }
  await tab.close();
});

test("saved camera survives reload and linked facility rename updates the program venue", async ({
  page,
}) => {
  await batch(page);
  await studio(page, "background");
  await page.locator("[data-studio=save-view]").click();
  await page.locator("[data-studio-form=view] [name=name]").fill("메인 행사장");
  await page.locator("[data-studio-form=view] button[type=submit]").click();
  const before = await data(page);
  await closePanel(page);
  await page.locator("[data-action=zoom-out]").click();
  await expect
    .poll(async () => Number(await page.locator("#zoom-level").innerText()))
    .toBe(before.view.zoom - 1);
  await studio(page, "background");
  await page.locator("[data-studio=load-view]").first().click();
  await expect(page.locator("#zoom-level")).toHaveText(
    String(before.view.zoom),
  );
  await expect
    .poll(async () => (await data(page)).view.zoom)
    .toBe(before.view.zoom);
  await page.reload();
  await expect(page.locator("#zoom-level")).toHaveText(
    String(before.view.zoom),
  );
  await studio(page, "programs");
  await page.locator("[data-studio=program]").first().click();
  const f = page.locator("[data-studio-form=program]");
  await f.locator("[name=title]").fill("시설 연계 체험");
  await f.locator("[name=date]").fill("2026-10-19");
  await f.locator("[name=placeId]").selectOption(before.objects[0].id);
  await f.locator("button[type=submit]").click();
  await expect(page.locator(".studio-programs")).toContainText(
    before.objects[0].name,
  );
  await page.locator("[data-studio=tab][data-id=facilities]").click();
  await page
    .locator(
      `#panel-content [data-studio=details][data-id="${before.objects[0].id}"]`,
    )
    .last()
    .click();
  const d = page.locator("[data-studio-form=details]");
  await d.locator("[name=name]").fill("지역문화 체험관");
  await d.locator("button[type=submit]").click();
  await page.locator("[data-studio=tab][data-id=programs]").click();
  await expect(page.locator(".studio-programs")).toContainText(
    "지역문화 체험관",
  );
});

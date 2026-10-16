import { test, expect } from "@playwright/test";
import { newProject, newObject } from "../../src/model.js";
const mobile = (page) =>
  page.viewportSize().width <= 760 ||
  (page.viewportSize().width <= 1000 && page.viewportSize().height <= 520);
async function panel(page, name) {
  if (mobile(page) && !(await page.locator("#panel.open").count()))
    await page.locator(`#mobile-nav [data-panel=${name}]`).click();
  else await page.locator(`.panel-tabs [data-panel=${name}]`).click();
}
async function choose(page, kind) {
  await panel(page, "tools");
  await page.locator(`[data-tool="marker:${kind}"]`).last().click();
  await page.locator('[data-action="center-point"]').click();
  await page.locator('[data-action="finish"]').click();
}
async function place(page, kind, x, y) {
  await panel(page, "tools");
  await page.locator(`[data-tool="marker:${kind}"]`).last().click();
  const box = await page.locator("#editor").boundingBox();
  await page
    .locator("#editor")
    .click({ position: { x: box.width * x, y: box.height * y } });
  await page.locator('[data-action="finish"]').click();
  await close(page);
}
async function props(page) {
  if (mobile(page))
    await page.locator('#command-bar [data-action="properties"]').click();
  return page.locator(mobile(page) ? "#panel-content" : "#inspector");
}
async function close(page) {
  if (mobile(page) && (await page.locator("#panel.open").count()))
    await page.locator('[data-action="close-panel"]').click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/?map=offline");
  await expect(page.locator("#save-status")).toContainText("준비됨");
});
test("operational assignments, plan, CSV and report survive reload", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await choose(page, "parkingStaff");
  const p = await props(page);
  await p.locator('[data-prop="operations.quantity"]').fill("4");
  await p.locator('[data-prop="operations.quantity"]').press("Tab");
  await p.locator('[data-prop="operations.team"]').fill("교통 A팀");
  await p.locator('[data-prop="operations.team"]').press("Tab");
  await p
    .locator('[data-prop="operations.note"]')
    .fill("셔틀 진입 시 보행자 우선 안내");
  await p.locator('[data-prop="operations.note"]').press("Tab");
  await close(page);
  await panel(page, "plan");
  await expect(page.locator("#plan-summary")).toContainText("4");
  await page.locator('[data-plan="organizer"]').fill("김해시");
  await page.locator('[data-plan="organizer"]').press("Tab");
  await page.locator('[data-plan="documentNo"]').fill("행사-001");
  await page.locator('[data-plan="documentNo"]').press("Tab");
  await page.locator('[data-plan="revision"]').fill("2");
  await page.locator('[data-plan="revision"]').press("Tab");
  await page.locator('[data-plan="status"]').selectOption("review");
  const pending = page.waitForEvent("download");
  await page.locator('#panel-content [data-action="deployment-csv"]').click();
  const d = await pending;
  const stream = await d.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain("교통 A팀");
  expect(csv).toContain("셔틀 진입");
  expect(csv).toContain("행사-001");
  await page
    .locator('#panel-content [data-action="operations-report"]')
    .click();
  await expect(page.locator("#operations-report")).toBeVisible();
  await expect(page.locator(".report-heading")).toContainText("개정 2");
  await expect(page.locator(".report-paper")).toContainText("김해시");
  await expect(page.locator(".deployment-table")).toContainText("셔틀 진입");
  await info.attach("operations-plan", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  if (info.project.name === "desktop") {
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
    });
    expect(pdf.length).toBeGreaterThan(5000);
    expect(
      (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
    ).toBe(1);
    await info.attach("operations-plan-pdf", {
      body: pdf,
      contentType: "application/pdf",
    });
  }
  await page.locator("#report-close").click();
  await expect(page.locator("#operations-report")).toHaveCount(0);
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await panel(page, "plan");
  await expect(page.locator('[data-plan="organizer"]')).toHaveValue("김해시");
  await expect(page.locator("#plan-summary")).toContainText("4");
  expect(errors).toEqual([]);
});
test("marker, label and line size follow zoom while touch targets retain minimum size", async ({
  page,
}, info) => {
  await choose(page, "safetyStaff");
  await close(page);
  const shape = page.locator(".map-object.marker .object-shape");
  const before = await shape.boundingBox();
  await page.locator('[data-action="zoom-in"]').click();
  await expect
    .poll(async () => (await shape.boundingBox()).width)
    .toBeGreaterThan(before.width);
  const after = await shape.boundingBox();
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.width / before.width).toBeLessThan(1.3);
  expect(after.width).toBeLessThanOrEqual(49);
  const label = page.locator(
    ".map-object.marker .object-label rect:not(.label-touch)",
  );
  expect((await label.boundingBox()).height).toBeLessThan(30);
  await page
    .locator(
      mobile(page)
        ? '#command-bar [data-action="edit"]'
        : '#inspector [data-action="edit"]',
    )
    .click();
  const labelBefore = await label.boundingBox();
  await page.mouse.move(
    labelBefore.x + labelBefore.width / 2,
    labelBefore.y + labelBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    labelBefore.x + labelBefore.width / 2 + 30,
    labelBefore.y + labelBefore.height / 2 - 10,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await label.boundingBox()).x - labelBefore.x)
    .toBeCloseTo(30, 0);
  await expect
    .poll(async () => (await label.boundingBox()).y - labelBefore.y)
    .toBeCloseTo(-10, 0);
  const labelAfter = await label.boundingBox();
  expect(labelAfter.x - labelBefore.x).toBeCloseTo(30, 0);
  expect(labelAfter.y - labelBefore.y).toBeCloseTo(-10, 0);
  await page.locator('#command-bar [data-action="finish"]').click();
  await info.attach("automatic-size-zoom17", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  for (let i = 0; i < 4; i++)
    await page.locator('[data-action="zoom-in"]').click();
  expect((await shape.boundingBox()).width).toBeLessThanOrEqual(49);
  expect((await label.boundingBox()).height).toBeLessThan(30);
  for (let i = 0; i < 6; i++)
    await page.locator('[data-action="zoom-out"]').click();
  expect(
    Number(
      await page.locator(".map-object.marker .object-hit").getAttribute("r"),
    ),
  ).toBeGreaterThanOrEqual(24);
  await page
    .locator(
      mobile(page)
        ? '#command-bar [data-action="edit"]'
        : '#inspector [data-action="edit"]',
    )
    .click();
  const grip = page.locator(".marker-move");
  await expect(grip).toBeVisible();
  const original = await grip.getAttribute("transform");
  const gripBox = await grip.boundingBox();
  await page.mouse.move(
    gripBox.x + gripBox.width / 2,
    gripBox.y + gripBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    gripBox.x + gripBox.width / 2 + 28,
    gripBox.y + gripBox.height / 2 - 16,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(grip).not.toHaveAttribute("transform", original);
  await page.locator('#command-bar [data-action="finish"]').click();
  await panel(page, "tools");
  await page.locator('[data-tool="line:vehicle"]').click();
  const box = await page.locator("#editor").boundingBox();
  await page
    .locator("#editor")
    .click({ position: { x: box.width * 0.2, y: box.height * 0.55 } });
  await page
    .locator("#editor")
    .click({ position: { x: box.width * 0.7, y: box.height * 0.6 } });
  await page.locator('[data-action="finish"]').click();
  await close(page);
  expect(
    Number(
      await page
        .locator(".map-object.line .object-shape")
        .getAttribute("stroke-width"),
    ),
  ).toBeGreaterThan(7);
  await page.locator('[data-action="zoom-in"]').click();
  await expect(page.locator(".map-object.line .object-shape")).toHaveAttribute(
    "stroke-width",
    "8",
  );
});
test("booth, guard and police symbols render in map, export and saved data", async ({
  page,
}, info) => {
  await choose(page, "police");
  await close(page);
  await expect(
    page.locator('.map-object.marker [data-symbol="police-emblem"]'),
  ).toBeVisible();
  expect(
    await page
      .locator('.map-object.marker [data-symbol="police-emblem"] path')
      .count(),
  ).toBeGreaterThan(10);
  await place(page, "shuttle", 0.7, 0.35);
  await place(page, "booth", 0.3, 0.35);
  await place(page, "safetyStaff", 0.5, 0.35);
  await expect(page.locator(".map-object.marker")).toHaveCount(4);
  await expect(
    page.locator('.map-object.marker [data-symbol="event-booth"]'),
  ).toBeVisible();
  await expect(
    page.locator('.map-object.marker [data-symbol="security-guard"]'),
  ).toBeVisible();
  await expect(
    page.locator(".map-object.marker text").filter({ hasText: "BUS" }),
  ).toHaveCount(1);
  await page.locator(".header-actions [data-action=print]").click();
  await expect(
    page.locator('#print-legend [data-symbol="police-emblem"]'),
  ).toHaveCount(1);
  await expect(page.locator("#print-legend")).toContainText("경찰부스");
  await expect(
    page.locator('#print-legend [data-symbol="event-booth"]'),
  ).toBeVisible();
  await expect(
    page.locator('#print-legend [data-symbol="security-guard"]'),
  ).toBeVisible();
  await expect(page.locator("#print-legend")).toContainText("행사부스");
  await page.locator("[data-action=exit-print]").click();
  const pngPending = page.waitForEvent("download");
  await page.locator(".header-actions [data-action=more]").click();
  await page.locator('#modal [data-action="png"]').click();
  const png = await pngPending;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const stream = await png.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  expect(buffer.length).toBeGreaterThan(1000);
  await info.attach("field-symbols-overlay", {
    body: buffer,
    contentType: "image/png",
  });
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(
    page.locator('.map-object.marker [data-symbol="event-booth"]'),
  ).toBeVisible();
  await expect(
    page.locator('.map-object.marker [data-symbol="security-guard"]'),
  ).toBeVisible();
  await expect(
    page.locator(".object-label text").filter({ hasText: "안전요원 1" }),
  ).toHaveCount(1);
});

test("pre-update project at zoom 17 receives compact automatic sizing without losing deployment data", async ({
  page,
}, info) => {
  const legacy = newProject("이전 현장");
  delete legacy.settings.autoSize;
  legacy.view.zoom = 17;
  const oldMarker = newObject(
    "marker",
    "control",
    [legacy.view.center],
    "통제지점 1",
  );
  oldMarker.label.text =
    "통제지점 1 · 행사장 서측 관계자 출입과 긴급차량 통행 관리";
  oldMarker.operations.team = "교통 A팀";
  oldMarker.operations.quantity = 2;
  legacy.objects = [oldMarker];
  await page.locator("#import-file").setInputFiles({
    name: "pre-update.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await page.locator('[data-action="confirm-dialog"]').click();
  await expect(page.locator("#toast")).toContainText("가져오기");
  await close(page);
  let zoom = Number(await page.locator("#zoom-level").textContent());
  while (zoom > 17) {
    await page.locator('[data-action="zoom-out"]').click();
    zoom--;
  }
  while (zoom < 17) {
    await page.locator('[data-action="zoom-in"]').click();
    zoom++;
  }
  const marker = page.locator(".map-object.marker .object-shape");
  await expect(marker).toBeVisible();
  expect((await marker.boundingBox()).width).toBeLessThanOrEqual(49);
  expect(
    (await page.locator(".object-label rect:not(.label-touch)").boundingBox())
      .height,
  ).toBeLessThan(30);
  expect(
    (await page.locator(".object-label rect:not(.label-touch)").boundingBox())
      .width,
  ).toBeLessThanOrEqual(181);
  await info.attach("existing-control-point-zoom17", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(marker).toBeVisible();
  expect((await marker.boundingBox()).width).toBeLessThanOrEqual(49);
  const pending = page.waitForEvent("download");
  await page.locator('.header-actions [data-action="more"]').click();
  await page.locator('#modal [data-action="export"]').click();
  const stream = await (await pending).createReadStream();
  let data = "";
  for await (const chunk of stream) data += chunk;
  const restored = JSON.parse(data).project;
  expect(restored.settings.autoSize).toBe(true);
  expect(restored.objects[0].position).toEqual(oldMarker.position);
  expect(restored.objects[0].name).toBe(oldMarker.name);
  expect(restored.objects[0].label.text).toBe(oldMarker.label.text);
  expect(restored.objects[0].operations).toEqual(oldMarker.operations);
});

import { test, expect } from "@playwright/test";
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
      format: "A4",
      landscape: true,
      printBackground: true,
    });
    expect(pdf.length).toBeGreaterThan(5000);
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
}) => {
  await choose(page, "safetyStaff");
  await close(page);
  const shape = page.locator(".map-object.marker .object-shape");
  const before = await shape.boundingBox();
  await page.locator('[data-action="zoom-in"]').click();
  await expect(page.locator(".map-object.marker")).toHaveAttribute(
    "data-render-scale",
    "2",
  );
  const after = await shape.boundingBox();
  expect(after.width / before.width).toBeCloseTo(2, 1);
  await expect(
    page.locator(".map-object.marker .object-label"),
  ).toHaveAttribute("transform", /scale\(2\)/);
  await page.locator('[data-action="zoom-out"]').click();
  await page.locator('[data-action="zoom-out"]').click();
  await expect(page.locator(".map-object.marker")).toHaveAttribute(
    "data-render-scale",
    "0.5",
  );
  expect(
    Number(
      await page.locator(".map-object.marker .object-hit").getAttribute("r"),
    ),
  ).toBeGreaterThanOrEqual(24);
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
  ).toBe(5);
  await page.locator('[data-action="zoom-in"]').click();
  await expect(page.locator(".map-object.line .object-shape")).toHaveAttribute(
    "stroke-width",
    "8",
  );
});
test("field symbols and police emblem render consistently in tools and map", async ({
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
  await choose(page, "shuttle");
  await close(page);
  await expect(page.locator(".map-object.marker")).toHaveCount(2);
  await expect(
    page.locator(".map-object.marker text").filter({ hasText: "BUS" }),
  ).toHaveCount(1);
  await page.locator(".header-actions [data-action=print]").click();
  await expect(
    page.locator('#print-legend [data-symbol="police-emblem"]'),
  ).toHaveCount(1);
  await expect(page.locator("#print-legend")).toContainText("경찰부스");
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
  await info.attach("police-and-shuttle-overlay", {
    body: buffer,
    contentType: "image/png",
  });
});

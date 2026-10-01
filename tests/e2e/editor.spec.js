import { test, expect } from "@playwright/test";
const screenMobile = (page) =>
  page.viewportSize().width <= 760 ||
  (page.viewportSize().width <= 1000 && page.viewportSize().height <= 520);
async function tools(page) {
  if (screenMobile(page)) {
    if (!(await page.locator("#panel.open").count()))
      await page.locator("#mobile-nav [data-panel=tools]").click();
    else await page.locator(".panel-tabs [data-panel=tools]").click();
  } else await page.locator(".panel-tabs [data-panel=tools]").click();
}
async function choose(page, type, kind) {
  await tools(page);
  await page.locator(`[data-tool="${type}:${kind}"]`).last().click();
}
async function mapClick(page, x, y) {
  const box = await page.locator("#editor").boundingBox();
  await page
    .locator("#editor")
    .click({ position: { x: box.width * x, y: box.height * y } });
}
async function more(page, action) {
  await page.locator(".header-actions [data-action=more]").click();
  await page.locator(`#modal [data-action="${action}"]`).click();
}
async function exportData(page) {
  const pending = page.waitForEvent("download");
  await more(page, "export");
  const d = await pending,
    stream = await d.createReadStream();
  let json = "";
  for await (const chunk of stream) json += chunk;
  await page.locator("#modal [data-action=close-modal]").click();
  return JSON.parse(json).project;
}
async function props(page) {
  if (
    screenMobile(page) &&
    !(await page.locator("#panel.open [data-prop=name]").count())
  )
    await page.locator("#command-bar [data-action=properties]").click();
  return page.locator(screenMobile(page) ? "#panel-content" : "#inspector");
}
async function closeSheet(page) {
  if (screenMobile(page) && (await page.locator("#panel.open").count()))
    await page.locator("[data-action=close-panel]").click();
}
async function createArea(page, kind = "parking") {
  await choose(page, "area", kind);
  await mapClick(page, 0.23, 0.4);
  await mapClick(page, 0.55, 0.41);
  await mapClick(page, 0.49, 0.64);
  await page.locator("#command-bar [data-action=finish]").click();
  await expect(page.locator(".map-object.area")).toHaveCount(
    kind === "parking" ? 1 : 2,
  );
}
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto("/?map=offline");
  await expect(page.locator("#save-status")).toContainText("준비됨");
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});
test("create, edit, undo/redo, reload, JSON import and print", async ({
  page,
}) => {
  await createArea(page);
  let p = await props(page);
  await p.locator("[data-prop=name]").fill("제1주차장");
  await p.locator("[data-prop=name]").press("Tab");
  await closeSheet(page);
  await createArea(page, "event");
  await page.locator("#editor").press("Escape");
  await choose(page, "line", "vehicle");
  await mapClick(page, 0.2, 0.4);
  await mapClick(page, 0.65, 0.55);
  await page.locator("[data-action=finish]").click();
  await choose(page, "line", "oneway");
  await mapClick(page, 0.25, 0.45);
  await mapClick(page, 0.6, 0.6);
  await page.locator("[data-action=finish]").click();
  await choose(page, "marker", "parkingStaff");
  await mapClick(page, 0.27, 0.45);
  await mapClick(page, 0.55, 0.5);
  await page.locator("[data-action=finish]").click();
  p = await props(page);
  await p.locator('[data-prop="label.text"]').fill("주차 A팀");
  await p.locator('[data-prop="label.text"]').press("Tab");
  await closeSheet(page);
  await page.locator(".map-toolbar [data-action=undo]").click();
  await expect(
    page.locator(".object-label text").filter({ hasText: "주차 A팀" }),
  ).toHaveCount(0);
  await page.locator(".map-toolbar [data-action=redo]").click();
  await expect(
    page.locator(".object-label text").filter({ hasText: "주차 A팀" }),
  ).toHaveCount(1);
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(page.locator(".map-object")).toHaveCount(6);
  const data = await exportData(page);
  expect(data.objects.length).toBe(6);
  expect(data.objects.some((o) => o.name === "제1주차장")).toBeTruthy();
  await page.locator("#import-file").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.locator("#modal [data-action=confirm-dialog]").click();
  await expect(page.locator(".map-object")).toHaveCount(6);
  await closeSheet(page);
  await page.locator(".header-actions [data-action=print]").click();
  await expect(page.locator("#print-heading")).toBeVisible();
  await expect(page.locator("#print-legend")).toContainText("주차장");
  await page.locator("#paper").selectOption("A4 portrait");
  await page.locator("[data-action=exit-print]").click();
  await expect(page.locator("#print-controls")).toBeHidden();
});
test("drag marker and vertex, add point, cancel gesture, and restore through undo", async ({
  page,
}) => {
  await choose(page, "marker", "safetyStaff");
  await mapClick(page, 0.45, 0.45);
  await page.locator("[data-action=finish]").click();
  await page
    .locator(
      screenMobile(page)
        ? "#command-bar [data-action=edit]"
        : "#inspector [data-action=edit]",
    )
    .click();
  const data = await exportData(page),
    obj = page.locator(".map-object.marker .object-hit"),
    b = await obj.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 35, b.y + b.height / 2 + 20, {
    steps: 6,
  });
  await page.mouse.up();
  const moved = await exportData(page);
  expect(moved.objects[0].position).not.toEqual(data.objects[0].position);
  await page.locator(".map-toolbar [data-action=undo]").click();
  const undone = await exportData(page);
  expect(undone.objects[0].position).toEqual(data.objects[0].position);
  await page.locator("#editor").press("Escape");
  await createArea(page);
  await page
    .locator(
      screenMobile(page)
        ? "#command-bar [data-action=edit]"
        : "#inspector [data-action=edit]",
    )
    .click();
  await expect(page.locator(".vertex")).toHaveCount(3);
  await page.locator(".midpoint").first().click();
  await expect(page.locator(".vertex")).toHaveCount(4);
  await page.locator(".map-toolbar [data-action=undo]").click();
  await expect(page.locator(".vertex")).toHaveCount(3);
});
test("project versions, duplication, object locking and layer visibility", async ({
  page,
}) => {
  await choose(page, "marker", "stage");
  await mapClick(page, 0.4, 0.4);
  await page.locator("[data-action=finish]").click();
  await more(page, "save");
  await page.locator("#modal [data-action=close-modal]").click();
  let p = await props(page);
  await p.locator("[data-action=duplicate]").click();
  await expect(page.locator(".map-object")).toHaveCount(2);
  p = await props(page);
  await p.locator("[data-prop=locked]").check();
  await p.locator("[data-action=delete]").click();
  await expect(page.locator(".map-object")).toHaveCount(2);
  await closeSheet(page);
  await more(page, "versions");
  await page.locator("[data-version]").first().click();
  await page.locator("[data-action=confirm-dialog]").click();
  await expect(page.locator(".map-object")).toHaveCount(1);
  if (screenMobile(page))
    await page.locator("#mobile-nav [data-panel=objects]").click();
  else await page.locator(".panel-tabs [data-panel=objects]").click();
  await page.locator("[data-layer=marker]").uncheck();
  await expect(page.locator(".map-object")).toBeHidden();
  await page.locator("[data-layer=marker]").check();
  await expect(page.locator(".map-object")).toBeVisible();
});
test("responsive bounds, coordinate search, map movement and orientation", async ({
  page,
}) => {
  const initial = await page.locator("#coordinates").textContent();
  await page.locator("#address-search").fill("35.2285, 128.8893");
  await page.locator("#search-form").evaluate((f) => f.requestSubmit());
  await page.locator('[data-search-result="0"]').click();
  await expect(page.locator("#coordinates")).toContainText("35.228500");
  const box = await page.locator("#editor").boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.35 + 40,
    box.y + box.height * 0.4 + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(await page.locator("#coordinates").textContent()).not.toEqual(initial);
  await page.locator("[data-action=zoom-in]").click();
  await expect(page.locator("#zoom-level")).toHaveText("18");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const original = page.viewportSize();
  await page.setViewportSize({
    width: original.height,
    height: original.width,
  });
  await expect(page.locator("#editor")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize(original);
  await tools(page);
  await expect(page.locator('[data-tool="area:parking"]').last()).toBeVisible();
});

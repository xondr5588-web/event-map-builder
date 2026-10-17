import { test, expect } from "@playwright/test";
import { newProject, newObject } from "../../src/model.js";
const mobile = (p) =>
  p.viewportSize().width <= 760 ||
  (p.viewportSize().width <= 1000 && p.viewportSize().height <= 520);
async function create(p) {
  await p.goto("/?map=offline");
  await expect(p.locator("#save-status")).toContainText("준비됨");
  if (mobile(p)) await p.locator('#mobile-nav [data-panel="tools"]').click();
  await p.locator('[data-tool="marker:parkingStaff"]').last().click();
  await p.locator('[data-action="center-point"]').click();
  await p.locator('[data-action="finish"]').click();
  await expect(p.locator("#marker-quick-actions")).toBeVisible();
}
async function data(p) {
  const pending = p.waitForEvent("download");
  await p.locator('.header-actions [data-action="more"]').click();
  await p.locator('#modal [data-action="export"]').click();
  let text = "";
  for await (const b of await (await pending).createReadStream()) text += b;
  await p.locator('#modal [data-action="close-modal"]').click();
  return JSON.parse(text).project;
}
const label = (p) =>
  p.locator(".map-object.marker .object-label > rect:not(.label-touch)");
async function move(p, dx, dy, context, info, cancel = false) {
  const b = await p.locator(".map-object.marker .object-hit").boundingBox(),
    x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  if (info.project.name === "galaxy") {
    const c = await context.newCDPSession(p);
    await c.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 5; i++)
      await c.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5 }],
      });
    await c.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await c.detach();
  } else {
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 5 });
    if (cancel)
      await p
        .locator("#editor")
        .dispatchEvent("pointercancel", { pointerId: 1 });
    await p.mouse.up();
  }
}
test("tap a marker name to rename, cancel, blur-save, undo and restore after reload", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  const before = await data(page);
  if (info.project.name === "galaxy") await label(page).tap();
  else await label(page).click();
  const input = page.locator("#marker-name-input");
  await expect(input).toBeFocused();
  await input.fill("서측 주차관리원");
  await input.press("Enter");
  await expect(page.locator("#marker-name-editor")).toBeHidden();
  await expect(
    page.locator(".map-object.marker .object-label text"),
  ).toHaveText("서측 주차관리원");
  await page.locator('.map-toolbar [data-action="undo"]').click();
  await expect(
    page.locator(".map-object.marker .object-label text"),
  ).toHaveText(before.objects[0].label.text);
  await page.locator('.map-toolbar [data-action="redo"]').click();
  await label(page).click();
  await input.fill("취소할 이름");
  await input.press("Escape");
  await expect(
    page.locator(".map-object.marker .object-label text"),
  ).toHaveText("서측 주차관리원");
  await label(page).click();
  await input.fill("주차 A팀");
  await page.locator('[aria-label="이름 수정 취소"]').click();
  await expect(
    page.locator(".map-object.marker .object-label text"),
  ).toHaveText("서측 주차관리원");
  await label(page).click();
  await input.fill("동측 주차 A팀");
  await info.attach("inline-marker-name", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  // A map interaction commits the visible name before opening a position preview.
  const mapBox = await page.locator("#editor").boundingBox();
  await page
    .locator("#editor")
    .click({ position: { x: mapBox.width * 0.75, y: mapBox.height * 0.5 } });
  await expect(page.locator("#marker-name-editor")).toBeHidden();
  await expect(
    page.locator(".map-object.marker .object-label text"),
  ).toHaveText("동측 주차 A팀");
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(
    page.locator(".map-object.marker .object-label text"),
  ).toHaveText("동측 주차 A팀");
  const after = await data(page);
  expect(after.objects[0].name).toBe("동측 주차 A팀");
  expect(after.objects[0].label.text).toBe("동측 주차 A팀");
  expect(after.objects[0].position).toEqual(before.objects[0].position);
  expect(after.objects[0].operations).toEqual(before.objects[0].operations);
  expect(errors).toEqual([]);
});
test("drag markers directly and use nearby lock/unlock with undo and touch cancellation", async ({
  page,
  context,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  const before = await data(page);
  await page.locator("#editor").press("Escape");
  const center = await page.locator("#coordinates").textContent();
  await move(page, 30, -18, context, info);
  await expect(page.locator("#coordinates")).toHaveText(center);
  await expect(page.locator(".marker-move")).toHaveCount(0);
  await expect(page.locator("#marker-quick-actions")).toBeVisible();
  const moved = await data(page);
  expect(moved.objects[0].position).not.toEqual(before.objects[0].position);
  await page.locator('.map-toolbar [data-action="undo"]').click();
  expect((await data(page)).objects[0].position).toEqual(
    before.objects[0].position,
  );
  await page.locator('.map-toolbar [data-action="redo"]').click();
  await page.locator(".map-object.marker .object-hit").click();
  const lock = page.locator(
    '#marker-quick-actions [data-marker-action="lock"]',
  );
  await lock.click();
  await expect(lock).toHaveText("잠금 해제");
  await expect(page.locator(".map-object.marker")).toHaveClass(/locked/);
  await expect(page.locator("[data-locked-indicator]")).toHaveCount(1);
  await expect(
    page.locator('#marker-quick-actions [data-marker-action="rename"]'),
  ).toBeDisabled();
  await label(page).click();
  await expect(page.locator("#marker-name-editor")).toBeHidden();
  await move(page, 22, 12, context, info);
  const locked = await data(page);
  expect(locked.objects[0].position).toEqual(moved.objects[0].position);
  expect(locked.objects[0].locked).toBe(true);
  await page.locator('.header-actions [data-action="print"]').click();
  await expect(page.locator("[data-locked-indicator]")).toBeHidden();
  await page.locator('[data-action="exit-print"]').click();
  await page.locator(".map-object.marker .object-hit").click();
  await expect(page.locator("[data-locked-indicator]")).toBeVisible();
  await page.locator('.map-toolbar [data-action="undo"]').click();
  await expect(page.locator(".map-object.marker")).not.toHaveClass(/locked/);
  await page.locator('.map-toolbar [data-action="redo"]').click();
  await expect(page.locator(".map-object.marker")).toHaveClass(/locked/);
  await page.locator(".map-object.marker .object-hit").click();
  await info.attach("nearby-marker-lock", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await lock.click();
  await expect(lock).toHaveText("잠금");
  await move(page, -25, -15, context, info, true);
  expect((await data(page)).objects[0].position).toEqual(
    moved.objects[0].position,
  );
  await move(page, -20, 16, context, info);
  const final = await data(page);
  expect(final.objects[0].position).not.toEqual(moved.objects[0].position);
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  const restored = await data(page);
  expect(restored.objects[0].position).toEqual(final.objects[0].position);
  expect(restored.objects[0].locked).toBe(false);
  expect(errors).toEqual([]);
});

test("opening a custom label preserves its distinct name and Korean composition does not submit early", async ({
  page,
}) => {
  await page.goto("/?map=offline");
  await expect(page.locator("#save-status")).toContainText("준비됨");
  const p = newProject("기존 라벨 보존"),
    o = newObject("marker", "police", [p.view.center], "경찰 협조부스 A");
  o.label.text = " 서측 대기 ";
  o.operations.team = "협조기관";
  p.objects = [o];
  await page.locator("#import-file").setInputFiles({
    name: "custom-label.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.locator('[data-action="confirm-dialog"]').click();
  await expect(page.locator("#toast")).toContainText("가져오기");
  if (mobile(page)) await page.locator('[data-action="close-panel"]').click();
  await label(page).click();
  await page.locator('[aria-label="이름 저장"]').click();
  const unchanged = await data(page);
  expect(unchanged.objects[0].name).toBe(o.name);
  expect(unchanged.objects[0].label.text).toBe(o.label.text);
  await expect(
    page.locator('.map-toolbar [data-action="undo"]'),
  ).toBeDisabled();
  await label(page).click();
  const input = page.locator("#marker-name-input");
  await input.fill("동측 경찰부스");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  await expect(page.locator("#marker-name-editor")).toBeVisible();
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect(page.locator("#marker-name-editor")).toBeHidden();
  const changed = await data(page);
  expect(changed.objects[0].name).toBe("동측 경찰부스");
  expect(changed.objects[0].label.text).toBe("동측 경찰부스");
  expect(changed.objects[0].operations).toEqual(o.operations);
  expect(changed.objects[0].position).toEqual(o.position);
});

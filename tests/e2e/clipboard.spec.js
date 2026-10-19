import { test, expect } from "@playwright/test";
import { newProject, newObject } from "../../src/model.js";
import { world, pointsOf } from "../../src/geometry.js";
const mobile = (p) =>
  p.viewportSize().width <= 760 ||
  (p.viewportSize().width <= 1000 && p.viewportSize().height <= 520);
async function tap(locator, info, position) {
  if (info.project.name === "galaxy")
    await locator.tap(position ? { position } : {});
  else await locator.click(position ? { position } : {});
}
async function read(p) {
  const pending = p.waitForEvent("download");
  await p.locator('.header-actions [data-action="more"]').click();
  await p.locator('#modal [data-action="export"]').click();
  let text = "";
  for await (const b of await (await pending).createReadStream()) text += b;
  await p.locator('#modal [data-action="close-modal"]').click();
  return JSON.parse(text).project;
}
async function seed(p, group = false) {
  await p.goto("/?map=offline");
  await expect(p.locator("#save-status")).toContainText("준비됨");
  const project = newProject("복사 붙여넣기 검증"),
    a = project.view.center,
    b = { lat: a.lat + 0.0002, lng: a.lng + 0.0002 },
    c = { lat: a.lat + 0.0002, lng: a.lng };
  const o = newObject("marker", "parkingStaff", [a], "동측 주차 A팀");
  o.label = { ...o.label, text: " 동측 대기 ", dx: 12, dy: 35, manual: true };
  o.style.markerSize = 32;
  o.rotation = 45;
  o.group = "동측 통제";
  o.operations.team = "주차 1조";
  o.operations.quantity = 3;
  o.locked = !group;
  project.objects = [o];
  if (group)
    project.objects.push(
      newObject("marker", "booth", [b], "행사 접수"),
      newObject("line", "vehicle", [a, b], "진입 동선"),
      newObject("area", "parking", [a, b, c], "주차 A"),
    );
  await p.locator("#import-file").setInputFiles({
    name: "clipboard-source.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await p.locator('[data-action="confirm-dialog"]').click();
  await expect(p.locator("#toast")).toContainText("가져오기");
  if (mobile(p)) await p.locator('[data-action="close-panel"]').click();
  return project;
}
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

test("touch copy, preview, place and nearby duplication preserve marker details and Undo/Redo", async ({
  page,
}, info) => {
  await seed(page);
  const hit = page.locator(
    ".map-object.marker:not(.paste-preview) .object-hit",
  );
  await tap(hit, info);
  await info.attach("marker-copy-actions", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await tap(page.locator('[data-marker-action="duplicate"]'), info);
  await expect(page.locator(".map-object.marker")).toHaveCount(2);
  await page.locator('.map-toolbar [data-action="undo"]').click();
  await expect(page.locator(".map-object.marker")).toHaveCount(1);
  await tap(hit, info);
  const before = await read(page);
  await tap(hit, info);
  await tap(page.locator('[data-marker-action="copy"]'), info);
  await expect(page.locator("#toast")).toContainText("1개 복사");
  await expect(page.locator(".map-object.marker")).toHaveCount(1);
  await tap(page.locator('#command-bar [data-action="paste"]'), info);
  await expect(page.locator(".paste-preview")).toHaveCount(1);
  await expect(page.locator("#marker-quick-actions")).toBeHidden();
  await info.attach("marker-paste-preview", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  // The temporary drawing is absent from JSON and does not create an Undo step.
  expect((await read(page)).objects).toEqual(before.objects);
  await expect(
    page.locator('.map-toolbar [data-action="undo"]'),
  ).toBeDisabled();
  const box = await page.locator("#editor").boundingBox();
  await tap(page.locator("#editor"), info, {
    x: box.width * 0.65,
    y: box.height * 0.46,
  });
  await expect(page.locator(".paste-preview")).toHaveCount(0);
  await expect(page.locator(".map-object.marker")).toHaveCount(2);
  const after = await read(page),
    original = after.objects[0],
    copy = after.objects[1];
  expect(original).toEqual(before.objects[0]);
  expect(copy.id).not.toBe(original.id);
  expect(copy.name).toBe(`${original.name} 사본`);
  expect(copy.label).toEqual(original.label);
  expect(copy.operations).toEqual(original.operations);
  expect(copy.style).toEqual(original.style);
  expect(copy.rotation).toBe(45);
  expect(copy.group).toBe(original.group);
  expect(copy.locked).toBe(false);
  expect(copy.position).not.toEqual(original.position);
  await page.locator('.map-toolbar [data-action="undo"]').click();
  await expect(page.locator(".map-object.marker")).toHaveCount(1);
  await page.locator('.map-toolbar [data-action="redo"]').click();
  await expect(page.locator(".map-object.marker")).toHaveCount(2);
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  expect((await read(page)).objects).toEqual(after.objects);
});

test("multi-object clipboard keeps spacing, pans without pasting and cancels safely", async ({
  page,
  context,
}, info) => {
  await seed(page, true);
  await page
    .locator(
      mobile(page)
        ? '#mobile-nav [data-panel="objects"]'
        : '.panel-tabs [data-panel="objects"]',
    )
    .click();
  for (let i = 0; i < 4; i++)
    await page.locator("[data-select]").nth(i).check();
  await page.locator('.bulk-bar [data-action="copy"]').click();
  await expect(page.locator("#toast")).toContainText("4개 복사");
  const before = await read(page);
  await page.locator('#command-bar [data-action="paste"]').click();
  await expect(page.locator(".paste-preview")).toHaveCount(4);
  const box = await page.locator("#editor").boundingBox(),
    x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.45;
  if (info.project.name === "galaxy") {
    const c = await context.newCDPSession(page);
    await c.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await c.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 35, y: y + 20 }],
    });
    await c.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await c.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y + 20, { steps: 5 });
    await page.mouse.up();
  }
  await expect(page.locator(".paste-preview")).toHaveCount(4);
  await page.locator('#command-bar [data-action="cancel"]').click();
  await expect(page.locator(".paste-preview")).toHaveCount(0);
  expect((await read(page)).objects).toEqual(before.objects);
  await expect(
    page.locator('.map-toolbar [data-action="undo"]'),
  ).toBeDisabled();
  await page.locator('#command-bar [data-action="paste"]').click();
  await info.attach("group-paste-controls", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.locator('#command-bar [data-action="center-point"]').click();
  await expect(page.locator(".map-object")).toHaveCount(8);
  const after = await read(page),
    origins = after.objects.slice(0, 4),
    copies = after.objects.slice(4);
  expect(origins).toEqual(before.objects);
  expect(new Set(after.objects.map((o) => o.id)).size).toBe(8);
  const a = world(origins[0].position, 17),
    b = world(copies[0].position, 17),
    dx = b.x - a.x,
    dy = b.y - a.y;
  origins.forEach((o, i) => {
    pointsOf(o).forEach((p, j) => {
      const old = world(p, 17),
        moved = world(pointsOf(copies[i])[j], 17);
      expect(moved.x - old.x).toBeCloseTo(dx, 5);
      expect(moved.y - old.y).toBeCloseTo(dy, 5);
    });
  });
  await page.locator('.map-toolbar [data-action="undo"]').click();
  await expect(page.locator(".map-object")).toHaveCount(4);
  await page.locator('.map-toolbar [data-action="redo"]').click();
  await expect(page.locator(".map-object")).toHaveCount(8);
  await page.locator("#editor").press("Escape");
  await page.locator('[aria-label="복사 내용 비우기"]').click();
  await expect(page.locator("#command-bar")).toBeHidden();
});

test("keyboard paste retains its copy snapshot, avoids input interception and makes distinct repeated copies", async ({
  page,
}) => {
  await seed(page);
  const hit = page.locator(".map-object.marker .object-hit");
  await hit.click();
  await page.locator("#editor").press("Control+c");
  await page.locator('[data-marker-action="lock"]').click();
  await page.locator('[data-marker-action="rename"]').click();
  const input = page.locator("#marker-name-input");
  await input.fill("원본 이름 변경");
  await input.press("Control+v");
  await expect(page.locator(".map-object.marker")).toHaveCount(1);
  // Native text paste may affect the input; the app's clipboard must not.
  await input.fill("원본 이름 변경");
  await input.press("Enter");
  await page.locator("#editor").press("Control+v");
  await page.locator("#editor").press("Control+v");
  await expect(page.locator(".map-object.marker")).toHaveCount(3);
  const data = await read(page);
  expect(data.objects[0].name).toBe("원본 이름 변경");
  expect(data.objects[1].name).toBe("동측 주차 A팀 사본");
  expect(data.objects[2].name).toBe("동측 주차 A팀 사본 2");
  expect(data.objects[1].label.text).toBe(" 동측 대기 ");
  expect(data.objects[2].position).not.toEqual(data.objects[1].position);
  expect(new Set(data.objects.map((o) => o.id)).size).toBe(3);
  await page.locator('.map-toolbar [data-action="undo"]').click();
  await expect(page.locator(".map-object.marker")).toHaveCount(2);
});

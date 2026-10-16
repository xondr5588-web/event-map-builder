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
test("consistent booth, personnel, police, fire and facility symbols render in map, print and PNG", async ({
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
  await place(page, "fire", 0.3, 0.2);
  await place(page, "medical", 0.7, 0.2);
  await expect(page.locator(".map-object.marker")).toHaveCount(6);
  await expect(
    page.locator('.map-object.marker [data-symbol="fire-emblem"] path'),
  ).toHaveCount(75);
  await expect(
    page.locator('.map-object.marker [data-symbol="medical-station"]'),
  ).toBeVisible();
  await expect(
    page.locator('.map-object.marker [data-symbol="event-booth"]'),
  ).toBeVisible();
  await expect(
    page.locator('.map-object.marker [data-symbol="security-guard"]'),
  ).toBeVisible();
  await expect(
    page.locator('.map-object.marker [data-symbol="shuttle-stop"]'),
  ).toHaveCount(1);
  await page.locator(".header-actions [data-action=print]").click();
  await expect(
    page.locator('#print-legend [data-symbol="police-emblem"]'),
  ).toHaveCount(1);
  await expect(page.locator("#print-legend")).toContainText("경찰부스");
  await expect(
    page.locator('#print-legend [data-symbol="fire-emblem"]'),
  ).toBeVisible();
  await expect(
    page.locator('#print-legend [data-symbol="medical-station"]'),
  ).toBeVisible();
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

test("manual size controls preview live, commit one drag, isolate selection and survive reload and export", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const p = newProject("마커 크기 현장"),
    c = p.view.center;
  const a = newObject("marker", "police", [{ lat: c.lat, lng: c.lng - 0.001 }]);
  const b = newObject("marker", "fire", [{ lat: c.lat, lng: c.lng + 0.001 }]);
  const route = newObject("line", "vehicle", [
    { lat: c.lat - 0.002, lng: c.lng - 0.001 },
    { lat: c.lat - 0.002, lng: c.lng + 0.001 },
  ]);
  p.objects = [a, b, route];
  await page.locator("#import-file").setInputFiles({
    name: "size-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.locator('[data-action="confirm-dialog"]').click();
  await expect(page.locator("#toast")).toContainText("가져오기");
  await close(page);
  const shape = page.locator(`[data-object="${a.id}"]`),
    other = page.locator(`[data-object="${b.id}"]`);
  const lineWidth = await page
    .locator(".map-object.line .object-shape")
    .getAttribute("stroke-width");
  await page
    .getByRole("button", { name: "마커 크기 조절", exact: true })
    .click();
  const control = page.locator("#marker-size-panel");
  await control.locator('[data-size-preset="24"]').click();
  await expect(shape).toHaveAttribute("data-render-scale", "0.48");
  await expect(other).toHaveAttribute("data-render-scale", "0.48");
  // Drag with actual pointer input. The project must not commit until release.
  const slider = control.locator("#marker-size-slider"),
    box = await slider.boundingBox();
  let touch;
  if (info.project.name === "galaxy") {
    touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width * 0.15, y: box.y + box.height / 2 }],
    });
    for (let i = 1; i <= 8; i++)
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: box.x + box.width * (0.15 + (0.63 * i) / 8),
            y: box.y + box.height / 2,
          },
        ],
      });
  } else {
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2, {
      steps: 8,
    });
  }
  await expect
    .poll(async () => Number(await shape.getAttribute("data-render-scale")))
    .toBeGreaterThan(1);
  const previewScale = Number(await shape.getAttribute("data-render-scale"));
  if (touch) {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touch.detach();
  } else await page.mouse.up();
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.locator('[data-action="undo"]').click();
  await expect(shape).toHaveAttribute("data-render-scale", "0.48");
  await page.locator('[data-action="redo"]').click();
  await expect
    .poll(async () => Number(await shape.getAttribute("data-render-scale")))
    .toBe(previewScale);
  await page
    .getByRole("button", { name: "마커 크기 조절", exact: true })
    .click();
  await control.locator('[data-size-preset="24"]').click();
  await control.locator("[data-size-close]").click();
  await shape.locator(".object-hit").click();
  await page
    .locator(
      mobile(page)
        ? '#command-bar [data-action="selected-marker-size"]'
        : '#inspector [data-action="selected-marker-size"]',
    )
    .click();
  await expect(control.locator('[data-size-scope="selected"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await control.locator('[data-size-preset="48"]').click();
  await expect(shape).toHaveAttribute("data-render-scale", "0.96");
  await expect(other).toHaveAttribute("data-render-scale", "0.48");
  await info.attach("manual-size-selection", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await control.locator("[data-size-close]").click();
  await page.locator('[data-action="zoom-in"]').click();
  await expect(shape).toHaveAttribute("data-render-scale", "0.96");
  await page.locator('[data-action="zoom-out"]').click();
  await expect(page.locator(".map-object.line .object-shape")).toHaveAttribute(
    "stroke-width",
    lineWidth,
  );
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(shape).toHaveAttribute("data-render-scale", "0.96");
  await expect(other).toHaveAttribute("data-render-scale", "0.48");
  const pending = page.waitForEvent("download");
  await page.locator('.header-actions [data-action="more"]').click();
  await page.locator('#modal [data-action="export"]').click();
  let json = "";
  for await (const chunk of await (await pending).createReadStream())
    json += chunk;
  const data = JSON.parse(json).project;
  expect(data.settings.markerSize).toBe(24);
  expect(data.objects.find((o) => o.id === a.id).style.markerSize).toBe(48);
  expect(data.objects.find((o) => o.id === a.id).position).toEqual(a.position);
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { newProject, newObject } from "../../src/model.js";
const mobile = (page) =>
  page.viewportSize().width <= 760 ||
  (page.viewportSize().width <= 1000 && page.viewportSize().height <= 520);
const legacy = {
  areas: [
    {
      id: "a",
      name: "기존 주차장",
      kind: "parking",
      path: [
        { lat: 35.201, lng: 128.224 },
        { lat: 35.202, lng: 128.224 },
        { lat: 35.202, lng: 128.226 },
      ],
    },
  ],
  lines: [],
  markers: [
    {
      id: "m",
      name: "관리원",
      kind: "staff",
      lat: 35.2015,
      lng: 128.225,
      labelText: "이전 라벨",
      labelDx: 24,
      labelDy: -40,
    },
  ],
};
async function boot(page) {
  await page.goto("/?map=offline");
  await expect(page.locator("#save-status")).toContainText("준비됨");
}
async function more(page, action) {
  await page.locator(".header-actions [data-action=more]").click();
  await page.locator(`#modal [data-action=${action}]`).click();
}
async function exportJSON(page) {
  const pending = page.waitForEvent("download");
  await more(page, "export");
  const stream = await (await pending).createReadStream();
  let s = "";
  for await (const chunk of stream) s += chunk;
  await page.locator("#modal [data-action=close-modal]").click();
  return JSON.parse(s).project;
}
async function importJSON(page, data) {
  await page.locator("#import-file").setInputFiles({
    name: "test.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.locator("[data-action=confirm-dialog]").click();
  await expect(page.locator("#toast")).toContainText("가져오기");
  if (mobile(page) && (await page.locator("#panel.open").count()))
    await page.locator("[data-action=close-panel]").click();
}
async function createCenterMarker(page) {
  if (mobile(page))
    await page.locator("#mobile-nav [data-panel=tools]").click();
  else await page.locator(".panel-tabs [data-panel=tools]").click();
  await page.locator('[data-tool="marker:parkingStaff"]').last().click();
  await page.locator("[data-action=center-point]").click();
  await page.locator("[data-action=finish]").click();
}

test("old localStorage, original backup, versions and bad file recovery", async ({
  page,
}) => {
  const raw = JSON.stringify({ data: legacy, ts: 12 });
  await page.addInitScript(
    ({ raw, legacy }) => {
      if (!localStorage.getItem("seeded")) {
        localStorage.setItem("event_map_v10_12_autosave", raw);
        localStorage.setItem(
          "event_map_v10_12_versions",
          JSON.stringify([
            { id: "old-v", title: "이전 버전", ts: 13, data: legacy },
          ]),
        );
        localStorage.setItem("seeded", "1");
      }
    },
    { raw, legacy },
  );
  await boot(page);
  await expect(page.locator(".map-object")).toHaveCount(2);
  await expect(
    page.locator(".object-label text").filter({ hasText: "이전 라벨" }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("event_map_v10_12_autosave"),
    ),
  ).toBe(raw);
  await page.locator("#persistent-alert [data-action=dismiss-alert]").click();
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not JSON"),
  });
  await expect(page.locator("#toast")).toContainText("JSON 문법");
  await expect(page.locator(".map-object")).toHaveCount(2);
  await more(page, "versions");
  await expect(page.locator("#modal")).toContainText("이전 버전");
  await page.locator("#modal [data-action=close-modal]").click();
  await page.reload();
  await expect(page.locator(".map-object")).toHaveCount(2);
});

test("offline shell retains saved data across a cold navigation", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Service worker offline lifecycle is verified in Chromium.",
  );
  await boot(page);
  await createCenterMarker(page);
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator(".map-object")).toHaveCount(1);
  await context.setOffline(true);
  await page.goto("/?map=offline&cold-navigation=1");
  await expect(page.locator(".map-object")).toHaveCount(1);
  await expect(page.locator("#save-status")).toContainText("준비됨");
  await context.setOffline(false);
});

test("real touch pan, pinch, marker drag and pointer cancellation", async ({
  page,
  context,
  browserName,
}, info) => {
  test.skip(
    info.project.name !== "android",
    "Native CDP touch gestures use the Android project.",
  );
  await boot(page);
  const cdp = await context.newCDPSession(page);
  const b = await page.locator("#editor").boundingBox();
  const p = {
    x: Math.round(b.x + b.width * 0.4),
    y: Math.round(b.y + b.height * 0.45),
  };
  const touch = async (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y, id = 1]) => ({
        x,
        y,
        id,
        radiusX: 5,
        radiusY: 5,
        force: 1,
      })),
    });
  const start = await page.locator("#coordinates").textContent();
  await touch("touchStart", [[p.x, p.y]]);
  await touch("touchMove", [[p.x + 42, p.y + 35]]);
  await touch("touchEnd", []);
  await expect(page.locator("#coordinates")).not.toHaveText(start);
  const z = Number(await page.locator("#zoom-level").textContent());
  await touch("touchStart", [
    [p.x - 25, p.y, 1],
    [p.x + 25, p.y, 2],
  ]);
  await touch("touchMove", [
    [p.x - 85, p.y, 1],
    [p.x + 85, p.y, 2],
  ]);
  await touch("touchEnd", []);
  await expect(page.locator("#zoom-level")).toHaveText(String(z + 2));
  await createCenterMarker(page);
  await page.locator("#command-bar [data-action=edit]").click();
  const initial = await exportJSON(page);
  const m = await page.locator(".map-object.marker .object-hit").boundingBox(),
    x = Math.round(m.x + m.width / 2),
    y = Math.round(m.y + m.height / 2);
  await touch("touchStart", [[x, y]]);
  await touch("touchMove", [[x + 30, y + 20]]);
  await touch("touchEnd", []);
  const moved = await exportJSON(page);
  expect(moved.objects[0].position).not.toEqual(initial.objects[0].position);
  const hit = await page
      .locator(".map-object.marker .object-hit")
      .boundingBox(),
    xx = Math.round(hit.x + hit.width / 2),
    yy = Math.round(hit.y + hit.height / 2);
  await touch("touchStart", [[xx, yy]]);
  await touch("touchMove", [[xx - 35, yy - 20]]);
  await touch("touchCancel", []);
  expect((await exportJSON(page)).objects[0].position).toEqual(
    moved.objects[0].position,
  );
});

test("large drawing, repeated history and single-page A4/A3 output", async ({
  page,
  browserName,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Stress and PDF validation run on desktop.",
  );
  test.setTimeout(60000);
  await boot(page);
  const project = newProject("규모 검증 운영도");
  for (let i = 0; i < 500; i++)
    project.objects.push(
      newObject(
        "marker",
        "parkingStaff",
        [
          {
            lat: 35.201 + (i % 25) * 0.00005,
            lng: 128.224 + Math.floor(i / 25) * 0.00007,
          },
        ],
        `관리원 ${i + 1}`,
      ),
    );
  for (let i = 0; i < 80; i++)
    project.objects.push(
      newObject(
        "line",
        i % 2 ? "oneway" : "vehicle",
        [
          { lat: 35.2 + i * 0.00003, lng: 128.222 },
          { lat: 35.201 + i * 0.00003, lng: 128.227 },
        ],
        `동선 ${i + 1}`,
      ),
    );
  for (let i = 0; i < 30; i++)
    project.objects.push(
      newObject(
        "area",
        "parking",
        [
          { lat: 35.2 + i * 0.0001, lng: 128.224 },
          { lat: 35.20004 + i * 0.0001, lng: 128.224 },
          { lat: 35.20004 + i * 0.0001, lng: 128.2243 },
        ],
        `주차장 ${i + 1}`,
      ),
    );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await importJSON(page, project);
  await expect(page.locator(".map-object")).toHaveCount(610);
  const started = Date.now();
  await page.locator(".map-controls [data-action=fit]").click();
  await page.locator("[data-action=zoom-in]").click();
  await page.locator("[data-action=zoom-out]").click();
  expect(Date.now() - started).toBeLessThan(10000);
  await createCenterMarker(page);
  for (let i = 0; i < 20; i++) {
    await page.locator(".map-toolbar [data-action=undo]").click();
    await page.locator(".map-toolbar [data-action=redo]").click();
  }
  await expect(page.locator(".map-object")).toHaveCount(611);
  await expect(page.locator("#save-status")).toContainText("완료");
  await page.reload();
  await expect(page.locator(".map-object")).toHaveCount(611);
  await page.locator(".header-actions [data-action=print]").click();
  for (const paper of [
    "A4 portrait",
    "A4 landscape",
    "A3 portrait",
    "A3 landscape",
  ]) {
    await page.locator("#paper").selectOption(paper);
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
    });
    expect(
      (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
    ).toBe(1);
  }
  expect(errors).toEqual([]);
});

test("two windows keep concurrent edits as separate projects", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "desktop", "Cross-tab conflict coverage.");
  await boot(page);
  const second = await context.newPage();
  await boot(second);
  await createCenterMarker(page);
  await expect(page.locator("#save-status")).toContainText("완료");
  await createCenterMarker(second);
  await expect(second.locator("#persistent-alert")).toContainText(
    "별도 프로젝트",
  );
  const one = await exportJSON(page),
    two = await exportJSON(second);
  expect(one.id).not.toBe(two.id);
  expect(one.objects).toHaveLength(1);
  expect(two.objects).toHaveLength(1);
  await second.close();
});

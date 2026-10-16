import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("public destination offers login without an editor or map calls", async ({
  page,
}) => {
  const mapRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("map.naver.com")) mapRequests.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "로그인하여 운영도 열기" }),
  ).toHaveAttribute(
    "href",
    "https://field-event-map-private.sugaryseed3.chatgpt.site",
  );
  await expect(page.locator("#editor")).toHaveCount(0);
  await expect(page.locator("#storage-status")).toContainText(
    "저장된 프로젝트가 없습니다",
  );
  expect(mapRequests).toHaveLength(0);
});
test("public recovery exports legacy projects and preserves original storage", async ({
  page,
}) => {
  const legacy = {
    data: {
      areas: [],
      lines: [],
      markers: [
        {
          id: "old-staff",
          kind: "parkingStaff",
          lat: 35.2,
          lng: 128.2,
          labelText: "본부",
        },
      ],
      meta: { title: "기존 행사", note: "보관" },
    },
    ts: Date.now(),
  };
  await page.addInitScript(
    (data) =>
      localStorage.setItem("event_map_v10_12_autosave", JSON.stringify(data)),
    legacy,
  );
  await page.goto("/");
  await expect(page.locator("#storage-status")).toContainText("프로젝트 1개");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "이전 작업 전체 백업", exact: true })
    .click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.format).toBe("event-map-builder-backup");
  expect(backup.projects).toHaveLength(1);
  expect(backup.projects[0].title).toBe("기존 행사");
  expect(backup.projects[0].objects).toHaveLength(1);
  expect(backup.legacyBackups.length).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("event_map_v10_12_autosave"),
    ),
  ).toBe(JSON.stringify(legacy));
});

import { test, expect } from "@playwright/test";
test("denied session cannot open editor or request Naver SDK", async ({
  page,
}) => {
  const mapRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("map.naver.com")) mapRequests.push(r.url());
  });
  await page.route("**/access-check.json?*", (route) =>
    route.fulfill({ status: 403, body: "denied" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "소유자 로그인이 필요합니다." }),
  ).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await expect(
    page.getByRole("link", { name: "ChatGPT 계정으로 로그인" }),
  ).toHaveAttribute("href", "/signin-with-chatgpt?return_to=%2F");
  expect(mapRequests).toHaveLength(0);
});
test("authorized local work survives session expiry and reauthentication", async ({
  page,
}) => {
  let allowed = true;
  await page.route("**/access-check.json?*", (route) =>
    route.fulfill(
      allowed
        ? {
            contentType: "application/json",
            body: JSON.stringify({ access: "owner-private" }),
          }
        : { status: 403, body: "expired" },
    ),
  );
  await page.goto("/?map=offline");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#project-title").click();
  await page.locator("#dialog-input").fill("로그인 복구 검증");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#project-title")).toHaveText("로그인 복구 검증");
  allowed = false;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  allowed = true;
  await page.reload();
  await expect(page.locator("#project-title")).toHaveText("로그인 복구 검증");
  await page.locator('[data-action="more"]:visible').first().click();
  await expect(
    page.getByRole("link", { name: "소유자 전용 · 로그아웃" }),
  ).toBeVisible();
});

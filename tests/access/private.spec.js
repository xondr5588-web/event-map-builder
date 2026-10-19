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

test("owner can continue a project on a second device through the authenticated server", async ({
  page,
  context,
  browser,
}) => {
  const { api } = await import("../../worker/api.js");
  const { Bucket } = await import("../helpers/bucket.js");
  const env = { BUCKET: new Bucket() };
  async function routes(ctx) {
    await ctx.route("**/access-check.json?*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: '{"access":"owner-private"}',
      }),
    );
    await ctx.route("**/api/**", async (route) => {
      const r = route.request(),
        u = new URL(r.url());
      const response = await api(
        new Request("https://field.test" + u.pathname + u.search, {
          method: r.method(),
          headers: {
            "oai-authenticated-user-id": "same-owner",
            Origin: "https://field.test",
            "Content-Type": "application/json",
          },
          ...(r.method() === "PUT" ? { body: r.postData() } : {}),
        }),
        env,
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
  }
  async function sync(p) {
    const mobile =
      p.viewportSize().width <= 760 ||
      (p.viewportSize().width <= 1000 && p.viewportSize().height <= 520);
    await p
      .locator(
        mobile
          ? "#mobile-nav [data-panel=projects]"
          : ".panel-tabs [data-panel=projects]",
      )
      .click();
    await p.locator("#panel-content [data-action=cloud-sync]").click();
    await expect(p.locator("#cloud-status")).toContainText("클라우드 최신");
  }
  await routes(context);
  await page.goto("/?map=offline");
  await expect(page.locator("#save-status")).toContainText("준비됨");
  await page.locator("#project-title").click();
  await page.locator("#dialog-input").fill("기기 간 이어쓰기 검증");
  await page.locator("#name-form button[type=submit]").click();
  await expect(page.locator("#save-status")).toContainText("완료");
  await sync(page);
  const second = await browser.newContext({ viewport: page.viewportSize() });
  await routes(second);
  const other = await second.newPage();
  await other.goto("/?map=offline");
  await expect(other.locator("#project-title")).toHaveText(
    "기기 간 이어쓰기 검증",
  );
  await other.locator("#project-title").click();
  await other.locator("#dialog-input").fill("휴대폰에서 수정한 행사");
  await other.locator("#name-form button[type=submit]").click();
  await expect(other.locator("#save-status")).toContainText("완료");
  await sync(other);
  await sync(page);
  await expect(page.locator("#project-title")).toHaveText(
    "휴대폰에서 수정한 행사",
  );
  await second.close();
});

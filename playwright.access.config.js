import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testDir: "./tests/access",
  testMatch: `${process.env.FIELD_ACCESS_TEST_MODE || "public"}.spec.js`,
  use: { ...base.use, serviceWorkers: "block" },
});

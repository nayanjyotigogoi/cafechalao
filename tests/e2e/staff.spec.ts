import { expect, test } from "@playwright/test";
import { freshCafe, staffLogin } from "./helpers";

test("E2E-03 captain opens a table and sends a KOT", async ({ page }) => {
  await freshCafe(page);
  await staffLogin(page, /Rahul Bora/, "5555");
  await expect(page).toHaveURL(/\/captain/);
  await page.getByRole("button", { name: /Free/ }).filter({ hasText: /^T\d+/ }).first().click().catch(async () => {
    await page.locator("button", { hasText: "Free" }).nth(1).click();
  });
  await page.getByRole("button", { name: "Open table" }).click();
  await page.getByRole("button", { name: /Add item/ }).click();
  await page.getByRole("button", { name: /Masala Chai/ }).first().click();
  await page.getByRole("button", { name: /Send KOT/ }).click();
  await expect(page.getByText("KOT sent")).toBeVisible();
});

test("E2E-06 owner sees the dashboard", async ({ page }) => {
  await freshCafe(page);
  await staffLogin(page, /Nayan Gogoi/, "1111");
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(page.getByText(/Sales/).first()).toBeVisible();
});

test("E2E-07 rider logs in with phone OTP", async ({ page }) => {
  await freshCafe(page);
  await page.goto("/rider");
  await page.getByRole("button", { name: "Send OTP" }).click();
  await page.getByLabel("OTP").fill("123456");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/Rider · Amit/)).toBeVisible();
});

test("E2E-08 each café shows its own brand", async ({ page }) => {
  await freshCafe(page, "momo-mahal");
  await expect(page.getByRole("link", { name: /Momo Mahal/ })).toBeVisible();
  await page.goto("/?outlet=tiffin-tales");
  await expect(page.getByRole("link", { name: /Tiffin Tales/ })).toBeVisible();
  await expect(page.getByText("Powered by")).toBeVisible();
});

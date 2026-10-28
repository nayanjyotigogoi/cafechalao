import { expect, test } from "@playwright/test";
import { freshCafe, staffLogin } from "./helpers";

test("E2E-05 cashier bills a takeaway order in cash", async ({ page }) => {
  await freshCafe(page);
  await staffLogin(page, /Anu Kalita/, "3333");
  await expect(page).toHaveURL(/\/pos/);
  await page.getByRole("button", { name: "Open shift" }).click();
  await page.getByRole("button", { name: "Takeaway", exact: true }).click();
  await page.getByRole("button", { name: /Masala Chai/ }).first().click();
  await page.getByRole("button", { name: /Bun Maska|Kulhad Chai/ }).first().click();
  await page.getByRole("button", { name: /^Charge/ }).click();
  await page.getByRole("button", { name: /^Charge ₹/ }).last().click();
  await expect(page.getByText(/TAX INVOICE/)).toBeVisible();
});

test("E2E-04 kitchen starts and finishes a ticket", async ({ page }) => {
  await freshCafe(page);
  await staffLogin(page, /Suresh Rai/, "6666");
  await expect(page).toHaveURL(/\/kds/);
  const start = page.getByRole("button", { name: "Start cooking" }).first();
  if (await start.isVisible()) {
    await start.click();
    await page.getByRole("button", { name: "Mark ready" }).first().click();
  }
  await expect(page.getByText(/Ready to serve/)).toBeVisible();
});

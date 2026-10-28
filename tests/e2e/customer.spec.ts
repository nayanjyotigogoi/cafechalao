import { expect, test } from "@playwright/test";
import { freshCafe } from "./helpers";

test("E2E-01 customer delivery order with cash on delivery", async ({ page }) => {
  await freshCafe(page);
  await expect(page.getByRole("heading", { name: /What's brewing/ })).toBeVisible();
  await page.goto("/login?next=/");
  await page.getByRole("button", { name: /Continue with Google/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.getByRole("button", { name: "Add Masala Chai" }).click();
  await page.getByRole("button", { name: "Add one more Masala Chai" }).click();
  await page.getByRole("button", { name: "Add one more Masala Chai" }).click();
  await page.goto("/cart");
  await page.getByRole("button", { name: /^Delivery$/ }).click();
  await page.getByRole("button", { name: "Cash on delivery" }).click();
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByText("Delivery OTP")).toBeVisible();
});

test("E2E-02 customer dine-in from a table QR", async ({ page }) => {
  await freshCafe(page);
  // Read a free table's QR code from the demo database the page just seeded.
  await page.waitForTimeout(800);
  const qr = await page.evaluate(() => new Promise<string>((res) => {
    const req = indexedDB.open("cafechalao-mock");
    req.onsuccess = () => {
      const g = req.result.transaction("snapshot").objectStore("snapshot").get("v3");
      g.onsuccess = () => res((g.result.dining_tables as { tenant_id: string; status: string; qr_code: string }[]).find((t) => t.tenant_id === "tn_chai_adda" && t.status === "free")!.qr_code);
    };
  }));
  await page.goto(`/t/${qr}`);
  await expect(page.getByText(/Scanned at/)).toBeVisible();
  await page.getByRole("button", { name: "Add Masala Chai" }).click();
  await page.goto("/cart");
  await page.getByRole("button", { name: "Pay at counter" }).click();
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page.getByText("Order placed")).toBeVisible();
});

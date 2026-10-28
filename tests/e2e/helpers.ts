import { expect, type Page } from "@playwright/test";

/** Each test starts from fresh demo data for one café. */
export async function freshCafe(page: Page, slug = "chai-adda") {
  await page.goto(`/demo`);
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase("cafechalao-mock");
      req.onsuccess = req.onerror = req.onblocked = () => res();
    });
  });
  await page.goto(`/?outlet=${slug}`);
}

export async function staffLogin(page: Page, name: RegExp, pin: string, next = "") {
  await page.goto(`/staff${next ? `?next=${next}` : ""}`);
  await page.getByRole("button", { name }).first().click();
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page).not.toHaveURL(/\/staff(\?|$)/);
}

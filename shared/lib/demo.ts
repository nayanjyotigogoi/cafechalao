"use client";

/** Demo-mode helper: wipe the in-browser database and sessions, then reload from the seed. */
export async function resetDemo() {
  const { resetDB } = await import("@/mock/db");
  await resetDB();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("cc.") && k !== "cc.lang") localStorage.removeItem(k);
  } catch {}
  window.location.href = "/demo";
}

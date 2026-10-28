import { beforeEach, describe, expect, it } from "vitest";
import { client, freshDB } from "./helpers";

/**
 * API-level test cases against the mock backend. The same cases become Pest feature tests
 * for the Laravel API (tests/Feature, tests/Isolation), since both follow one contract.
 */

type Menu = { items: { id: string; name: string; price: number; in_stock: boolean; variants: { id: string }[]; code: string }[] };

let t: ReturnType<typeof freshDB>;
beforeEach(() => {
  t = freshDB();
});

const firstItem = async (c: ReturnType<typeof client>, name?: string) => {
  const m = await c.call<Menu>("GET", "/menu");
  return m.items.find((i) => (name ? i.name === name : i.in_stock && i.variants.length === 0))!;
};

describe("Tenancy and data ownership (SRS 7, 11)", () => {
  it("TC-ISO-01 each café's customers and orders are invisible to another café", async () => {
    const a = client("chai-adda");
    const b = client("momo-mahal");
    await a.staff("owner");
    await b.staff("owner");
    const aCustomers = await a.call<{ id: string }[]>("GET", "/customers", undefined, { as: "owner" });
    // Café B asking for café A's customer by id gets 404, as if it doesn't exist.
    await expect(b.call("GET", `/customers/${aCustomers[0].id}`, undefined, { as: "owner" })).rejects.toMatchObject({ status: 404 });
    const bCustomers = await b.call<{ id: string; tenant_id: string }[]>("GET", "/customers", undefined, { as: "owner" });
    expect(bCustomers.every((c) => c.tenant_id === "tn_momo_mahal")).toBe(true);
  });

  it("TC-ISO-02 a token from one café is useless at another café", async () => {
    const a = client("chai-adda");
    await a.staff("owner");
    const b = client("momo-mahal");
    b.tokens.owner = a.tokens.owner;
    await expect(b.call("GET", "/customers", undefined, { as: "owner" })).rejects.toMatchObject({ status: 401 });
  });

  it("TC-ISO-03 the same Google user is a separate customer at each café", async () => {
    const a = client("chai-adda");
    const b = client("brew-bros");
    const ra = await a.customer("new.person@gmail.com", "New Person");
    const rb = await b.customer("new.person@gmail.com", "New Person");
    expect(ra.customer.id).not.toBe(rb.customer.id);
    expect(t.customers.find((c) => c.id === ra.customer.id)!.tenant_id).toBe("tn_chai_adda");
    expect(t.customers.find((c) => c.id === rb.customer.id)!.tenant_id).toBe("tn_brew_bros");
  });

  it("TC-ISO-04 each café has its own branding and business type", async () => {
    const s1 = await client("chai-adda").call<any>("GET", "/settings"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const s2 = await client("tiffin-tales").call<any>("GET", "/settings"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s1.outlet.name).toBe("Chai Adda");
    expect(s2.outlet.name).toBe("Tiffin Tales");
    expect(s2.flags.features.dine_in).toBe(false); // cloud kitchen: no tables
    expect(s1.brand.primary_color).not.toBe(s2.brand.primary_color);
    expect(s1.powered_by.locked).toBe(true);
  });
});

describe("Customer flows (SRS 4)", () => {
  it("TC-CUS-01 delivery order: sign in, quote, place COD, kitchen, rider, OTP, feedback", async () => {
    const c = client();
    await c.customer();
    const item = await firstItem(c, "Masala Chai");
    const addr = (await c.call<{ id: string }[]>("GET", "/me/addresses", undefined, { as: "customer" }))[0];
    const q = await c.call<any>("POST", "/cart/quote", { lines: [{ item_id: item.id, qty: 4 }], order_type: "delivery" }, { as: "customer" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(q.quote.delivery_charge).toBeGreaterThan(0);
    const placed = await c.call<any>("POST", "/orders", { lines: [{ item_id: item.id, qty: 4 }], order_type: "delivery", payment_method: "cod", address_id: addr.id }, { as: "customer", idem: "k1" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = placed.order.id;
    expect(placed.order.status).toBe("accepted"); // café auto-accepts online orders

    const k = client();
    await k.staff("kitchen");
    const kots = await k.call<{ id: string; order_id: string }[]>("GET", "/kots", undefined, { as: "kitchen" });
    for (const kot of kots.filter((x) => x.order_id === id)) {
      await k.call("PATCH", `/kots/${kot.id}`, { status: "preparing" }, { as: "kitchen" });
      await k.call("PATCH", `/kots/${kot.id}`, { status: "ready" }, { as: "kitchen" });
    }
    const cash = client();
    await cash.staff("cashier");
    const del = (await cash.call<any[]>("GET", "/deliveries", undefined, { as: "cashier", query: { active: "1" } })).find((d) => d.order_id === id); // eslint-disable-line @typescript-eslint/no-explicit-any
    const rider = t.riders.find((r) => r.tenant_id === "tn_chai_adda")!;
    await cash.call("POST", `/deliveries/${del.id}/assign`, { rider_ids: [rider.id] }, { as: "cashier" });
    const rc = client();
    await rc.rider(rider.phone);
    await rc.call("POST", `/deliveries/${del.id}/accept`, {}, { as: "rider" });
    await rc.call("PATCH", `/deliveries/${del.id}/status`, { status: "picked_up" }, { as: "rider" });
    const otp = t.orders.find((o) => o.id === id)!.delivery_otp;
    await expect(rc.call("PATCH", `/deliveries/${del.id}/status`, { status: "delivered", proof: "otp", otp: "0000", collected_mode: "cash" }, { as: "rider" })).rejects.toMatchObject({ status: 422 });
    await rc.call("PATCH", `/deliveries/${del.id}/status`, { status: "delivered", proof: "otp", otp, collected_mode: "cash" }, { as: "rider" });

    const done = await c.call<any>("GET", `/orders/${id}`, undefined, { as: "customer" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(done.status).toBe("completed");
    expect(done.invoice.number).toMatch(/^CA\/\d\d-\d\d\/\d{6}$/);
    await c.call("POST", `/orders/${id}/feedback`, { food: 5, service: 4, ambience: 2, comment: "Late" }, { as: "customer" });
    expect(t.notifications.some((n) => n.title === "Low rating")).toBe(true);
  });

  it("TC-CUS-02 dine-in QR: order goes straight to the kitchen", async () => {
    const c = client();
    const table = t.dining_tables.find((x) => x.tenant_id === "tn_chai_adda" && x.status === "free")!;
    const info = await c.call<any>("GET", `/qr/${table.qr_code}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(info.table.name).toBe(table.name);
    const item = await firstItem(c, "Masala Chai");
    const r = await c.call<any>("POST", "/orders", { lines: [{ item_id: item.id, qty: 2 }], order_type: "dine_in", table_code: table.qr_code, payment_method: "upi_qr" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    // The guest is at the table: the order goes straight to the kitchen, paid later.
    expect(r.order.status).toBe("accepted");
    expect(t.kots.some((k) => k.order_id === r.order.id)).toBe(true);
  });

  it("TC-CUS-04 extra items after paying go on a new bill; cashier collects only what is due", async () => {
    const g = client();
    const table = t.dining_tables.find((x) => x.tenant_id === "tn_chai_adda" && x.status === "free")!;
    const item = await firstItem(g, "Masala Chai");
    const first = (await g.call<any>("POST", "/orders", { lines: [{ item_id: item.id, qty: 1 }], order_type: "dine_in", table_code: table.qr_code, payment_method: "upi_qr" })).order; // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = client();
    await s.staff("cashier");
    await s.call("POST", `/orders/${first.id}/confirm-payment`, {}, { as: "cashier" });
    const extra = await s.call<any>("POST", `/orders/${first.id}/items`, { lines: [{ item_id: item.id, qty: 2 }] }, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(extra.id).not.toBe(first.id);
    expect(extra.table_bills.paid).toBe(first.total);
    expect(extra.table_bills.due).toBe(extra.total);
    expect(t.orders.find((o) => o.id === first.id)!.payment_status).toBe("paid");
  });

  it("TC-CUS-03 walk-in profile is claimed when the customer signs in with Google and verifies the same mobile", async () => {
    const cap = client();
    await cap.staff("captain");
    const walk = await cap.call<{ id: string }>("POST", "/customers", { name: "Ravi Walkin", phone: "+91 99999 00001", birthday: "1990-05-05" }, { as: "captain" });
    const c = client();
    await c.customer("ravi.walkin@gmail.com", "Ravi");
    const r = await c.call<any>("POST", "/auth/otp/verify", { phone: "9999900001", otp: "123456" }, { as: "customer" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.claimed).toBe(true);
    expect(r.customer.id).toBe(walk.id);
    expect(r.customer.google_id).toBeTruthy();
  });
});

describe("Worst-case scenarios (SRS 16.5)", () => {
  it("TC-WC-01 double-tap Pay: the same Idempotency-Key creates one order", async () => {
    const c = client();
    await c.customer();
    const item = await firstItem(c, "Masala Chai");
    const body = { lines: [{ item_id: item.id, qty: 1 }], order_type: "takeaway", payment_method: "online" };
    const before = t.orders.length;
    const a = await c.call<any>("POST", "/orders", body, { as: "customer", idem: "same-key" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = await c.call<any>("POST", "/orders", body, { as: "customer", idem: "same-key" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a.order.id).toBe(b.order.id);
    expect(t.orders.length).toBe(before + 1);
  });

  it("TC-WC-02 webhook twice: the payment is recorded once", async () => {
    const c = client();
    await c.customer();
    const item = await firstItem(c, "Masala Chai");
    const r = await c.call<any>("POST", "/orders", { lines: [{ item_id: item.id, qty: 1 }], order_type: "takeaway", payment_method: "online" }, { as: "customer" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.order.payment_status).toBe("pending");
    await c.call("POST", `/orders/${r.order.id}/pay`, { result: "success" });
    const again = await c.call<any>("POST", `/orders/${r.order.id}/pay`, { result: "success" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(again.already_paid).toBe(true);
    expect(t.payments.filter((p) => p.order_id === r.order.id && p.status === "success")).toHaveLength(1);
    expect(t.invoices.filter((i) => i.order_id === r.order.id)).toHaveLength(1);
  });

  it("TC-WC-03 item goes out of stock during checkout: the order is refused before payment", async () => {
    const c = client();
    const item = await firstItem(c, "Masala Chai");
    t.items.find((i) => i.id === item.id)!.in_stock = false;
    await expect(c.call("POST", "/cart/quote", { lines: [{ item_id: item.id, qty: 1 }], order_type: "takeaway" })).rejects.toMatchObject({ status: 422, code: "unavailable" });
  });

  it("TC-WC-04 two captains edit the same table: the stale one gets 409", async () => {
    const a = client();
    await a.staff("captain");
    const table = t.dining_tables.find((x) => x.tenant_id === "tn_chai_adda" && x.status === "free")!;
    const item = await firstItem(a, "Masala Chai");
    const o = await a.call<any>("POST", "/pos/orders", { type: "dine_in", table_id: table.id, guests: 2 }, { as: "captain" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const v = o.updated_at;
    await a.call("POST", `/orders/${o.id}/items`, { lines: [{ item_id: item.id, qty: 1 }], version: v }, { as: "captain" });
    await new Promise((r) => setTimeout(r, 5));
    await expect(a.call("POST", `/orders/${o.id}/items`, { lines: [{ item_id: item.id, qty: 1 }], version: v }, { as: "captain" })).rejects.toMatchObject({ status: 409 });
  });

  it("TC-WC-05 two devices close the day: the second is refused", async () => {
    const c = client();
    await c.staff("cashier");
    await c.call("POST", "/shifts/open", { opening_cash: 200000 }, { as: "cashier" });
    const p = await c.call<any>("GET", "/day-close/preview", undefined, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const counts = [{ denomination: 1, count: p.expected_cash / 100 }];
    await c.call("POST", "/day-close", { counts }, { as: "cashier" });
    await expect(c.call("POST", "/day-close", { counts }, { as: "cashier" })).rejects.toMatchObject({ status: 409 });
  });

  it("TC-WC-06 stock may go negative; billing is never blocked", async () => {
    const c = client();
    await c.staff("cashier");
    await c.call("POST", "/shifts/open", { opening_cash: 0 }, { as: "cashier" });
    const milk = t.raw_materials.find((m) => m.tenant_id === "tn_chai_adda" && m.name === "Milk")!;
    milk.stock = 0.1;
    const item = await firstItem(c, "Masala Chai");
    const o = await c.call<any>("POST", "/pos/orders", { type: "takeaway", lines: [{ item_id: item.id, qty: 5 }] }, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await c.call("POST", `/orders/${o.id}/settle`, { payments: [{ mode: "cash", amount: o.total }] }, { as: "cashier" });
    expect(t.raw_materials.find((m) => m.id === milk.id)!.stock).toBeCloseTo(0.1 - 0.6);
  });

  it("TC-WC-07 rider accepts an order another rider took: 'already taken'", async () => {
    const owner = client();
    await owner.staff("owner");
    const del = t.deliveries.find((d) => d.tenant_id === "tn_chai_adda" && d.status === "unassigned")
      ?? (() => { const d = t.deliveries.find((x) => x.tenant_id === "tn_chai_adda")!; d.status = "unassigned"; d.rider_id = null; return d; })();
    const riders = t.riders.filter((r) => r.tenant_id === "tn_chai_adda");
    await owner.call("POST", `/deliveries/${del.id}/assign`, { rider_ids: riders.map((r) => r.id) }, { as: "owner" });
    const r1 = client();
    await r1.rider(riders[0].phone);
    const r2 = client();
    await r2.rider(riders[1].phone);
    await r1.call("POST", `/deliveries/${del.id}/accept`, {}, { as: "rider" });
    await expect(r2.call("POST", `/deliveries/${del.id}/accept`, {}, { as: "rider" })).rejects.toMatchObject({ status: 409, code: "already_taken" });
  });

  it("TC-WC-08 bad menu import: nothing is saved unless every row passes", async () => {
    const c = client();
    await c.staff("owner");
    const before = t.items.length;
    await expect(c.call("POST", "/menu/import", { rows: [{ name: "Tea", category: "Chai", price: "20" }, { name: "Bad", category: "Chai", price: "abc" }] }, { as: "owner" })).rejects.toMatchObject({ status: 422 });
    expect(t.items.length).toBe(before);
    await c.call("POST", "/menu/import", { rows: [{ name: "Tea", category: "Chai", price: "20" }] }, { as: "owner" });
    expect(t.items.length).toBe(before + 1);
  });

  it("TC-WC-09 price change is audited and old bills keep their old price", async () => {
    const c = client();
    await c.staff("owner");
    const item = await firstItem(c, "Masala Chai");
    const oldLine = t.order_items.find((i) => i.item_id === item.id)!;
    const oldPrice = oldLine.unit_price;
    await c.call("PUT", `/items/${item.id}`, { price: item.price + 1000 }, { as: "owner" });
    expect(t.order_items.find((i) => i.id === oldLine.id)!.unit_price).toBe(oldPrice);
    expect(t.audit_logs.some((a) => a.action === "price_change" && a.entity_id === item.id)).toBe(true);
    const m = client();
    await m.staff("manager");
    await expect(m.call("PUT", `/items/${item.id}`, { price: 1 }, { as: "manager" })).rejects.toMatchObject({ status: 403 });
  });

  it("TC-WC-10 coupon used beyond its limit: only the allowed number succeed", async () => {
    const c = client();
    await c.staff("cashier");
    await c.call("POST", "/shifts/open", { opening_cash: 0 }, { as: "cashier" });
    const coupon = t.coupons.find((x) => x.tenant_id === "tn_chai_adda" && x.code === "CHAI10")!;
    coupon.usage_limit_total = coupon.used_count + 1;
    const item = await firstItem(c, "Kulhad Chai");
    const mk = () => c.call<any>("POST", "/pos/orders", { type: "takeaway", lines: [{ item_id: item.id, qty: 4 }] }, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const o1 = await mk();
    const o2 = await mk();
    await c.call("POST", `/orders/${o1.id}/settle`, { coupon_code: "CHAI10", payments: [{ mode: "cash", amount: o1.total }] }, { as: "cashier" });
    await expect(c.call("POST", `/orders/${o2.id}/settle`, { coupon_code: "CHAI10", payments: [{ mode: "cash", amount: o2.total }] }, { as: "cashier" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("Approvals and permissions (SRS 2)", () => {
  it("TC-APR-01 cashier discount above limit needs a manager PIN, and is audited", async () => {
    for (const x of t.offers) x.active = false; // no happy hour: the result must not depend on the time of day
    const c = client();
    await c.staff("cashier");
    await c.call("POST", "/shifts/open", { opening_cash: 0 }, { as: "cashier" });
    const item = await firstItem(c, "Kulhad Chai");
    const o = await c.call<any>("POST", "/pos/orders", { type: "takeaway", lines: [{ item_id: item.id, qty: 2 }] }, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const body = { discount: { kind: "pct", value: 20, reason: "Regular" }, payments: [{ mode: "cash", amount: o.total }] };
    await expect(c.call("POST", `/orders/${o.id}/settle`, body, { as: "cashier" })).rejects.toMatchObject({ status: 403, code: "approval_required" });
    const appr = await c.call<any>("POST", "/auth/approve", { pin: "2222", kind: "discount_pct", amount: 20 }, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await c.call<any>("POST", `/orders/${o.id}/settle`, { ...body, approver_id: appr.approver_id }, { as: "cashier" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.invoice.discount).toBe(Math.round(item.price * 2 * 0.2));
    expect(t.audit_logs.some((a) => a.action === "discount" && a.entity_id === o.id)).toBe(true);
  });

  it("TC-APR-02 kitchen staff cannot open reports; cashier cannot change settings", async () => {
    const k = client();
    await k.staff("kitchen");
    await expect(k.call("GET", "/reports/pnl", undefined, { as: "kitchen" })).rejects.toMatchObject({ status: 403 });
    const c = client();
    await c.staff("cashier");
    await expect(c.call("PUT", "/settings/tax", { default_gst_rate: 18 }, { as: "cashier" })).rejects.toMatchObject({ status: 403 });
  });

  it("TC-APR-03 expense above the owner's ₹5,000 rule waits for approval", async () => {
    const m = client();
    await m.staff("manager");
    const cat = t.expense_categories.find((x) => x.tenant_id === "tn_chai_adda" && x.name === "Repairs")!;
    const e = await m.call<any>("POST", "/expenses", { category_id: cat.id, amount: 900000, mode: "upi", note: "AC repair" }, { as: "manager" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(e.status).toBe("pending");
    const o = client();
    await o.staff("owner");
    const ap = t.approvals.find((a) => a.ref_id === e.id)!;
    await o.call("POST", `/approvals/${ap.id}/decide`, { decision: "approve" }, { as: "owner" });
    expect(t.expenses.find((x) => x.id === e.id)!.status).toBe("approved");
  });
});

describe("Stock and purchase (M5)", () => {
  it("TC-STK-02 GRN updates stock, weighted average cost and supplier outstanding", async () => {
    const o = client();
    await o.staff("owner");
    const supplier = t.suppliers.find((s) => s.tenant_id === "tn_chai_adda")!;
    const milk = t.raw_materials.find((m) => m.tenant_id === "tn_chai_adda" && m.name === "Milk")!;
    milk.stock = 10;
    milk.avg_cost = 5000;
    const po = await o.call<any>("POST", "/purchase-orders", { supplier_id: supplier.id, lines: [{ raw_material_id: milk.id, qty: 10, rate: 6000 }] }, { as: "owner" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(po.status).toBe("approved");
    const before = supplier.outstanding;
    await o.call("POST", "/grns", { purchase_order_id: po.id, lines: [{ po_line_id: po.lines[0].id, received_qty: 10 }] }, { as: "owner" });
    const m2 = t.raw_materials.find((m) => m.id === milk.id)!;
    expect(m2.stock).toBe(20);
    expect(m2.avg_cost).toBe(5500);
    expect(t.suppliers.find((s) => s.id === supplier.id)!.outstanding).toBe(before + 60000);
  });
});

import type * as E from "@/shared/types/entities";
import { convert } from "@/shared/lib/units";
import { audit, checkLimit, create, crud, find, forbidden, HttpError, invalid, need, nextCounter, notify, route, scoped, settingsOf, today, update, type Ctx } from "../core";
import { ROLE_RANK } from "@/shared/lib/permissions";

/** Stock and purchase (M5): materials, recipes, PR → approval → PO → GRN, quotations, payments, wastage, counts. */

crud("/raw-materials", "raw_materials", "rm", {
  perm: "stock.receive", readPerm: "stock.view", required: ["name", "unit"], auditAs: "raw_material",
  defaults: { category: "General", storage: "Dry store", min_level: 0, stock: 0, avg_cost: 0, last_cost: 0, supplier_id: null },
  sort: (a, b) => a.name.localeCompare(b.name),
});
crud("/suppliers", "suppliers", "su", { perm: "stock.approve", readPerm: "stock.view", required: ["name", "phone"], defaults: { gstin: null, contact_person: "", email: null, payment_terms_days: 15, items_supplied: "", outstanding: 0 } });

const stockValue = (m: E.RawMaterial) => Math.max(0, m.stock) * m.avg_cost;

route("GET", "/stock/summary", (ctx) => {
  const mats = scoped(ctx, "raw_materials");
  const suppliers = scoped(ctx, "suppliers");
  const low = mats.filter((m) => m.stock > 0 && m.stock < m.min_level);
  const out = mats.filter((m) => m.stock <= 0);
  const bySupplier = new Map<string, string[]>();
  for (const m of [...low, ...out]) {
    const s = suppliers.find((x) => x.id === m.supplier_id)?.name ?? "No supplier";
    bySupplier.set(s, [...(bySupplier.get(s) ?? []), m.name]);
  }
  return {
    stock_value: Math.round(mats.reduce((s, m) => s + stockValue(m), 0)),
    low: low.length, out: out.length, total: mats.length,
    open_pos: scoped(ctx, "purchase_orders").filter((p) => ["approved", "sent", "partially_received", "pending"].includes(p.status)).length,
    suggestion: [...bySupplier.entries()].map(([supplier, items]) => ({ supplier, items })),
  };
}, { perm: "stock.view" });

route("GET", "/stock/ledger", (ctx) => {
  let rows = scoped(ctx, "stock_ledger");
  if (ctx.query.raw_material_id) rows = rows.filter((r) => r.raw_material_id === ctx.query.raw_material_id);
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300);
}, { perm: "stock.view" });

/* Wastage (M5.8) — kitchen records at end of shift */
route("GET", "/wastage/materials", (ctx) => scoped(ctx, "raw_materials").map((m) => ({ id: m.id, name: m.name, unit: m.unit })).sort((a, b) => a.name.localeCompare(b.name)), { perm: "kds.wastage" });
route("GET", "/wastage", (ctx) => [...scoped(ctx, "wastage")].sort((a, b) => b.created_at.localeCompare(a.created_at)), { perm: "kds.wastage" });
route("POST", "/wastage", (ctx) => {
  need(ctx.body, ["qty", "unit", "reason"]);
  if (!ctx.body.raw_material_id && !ctx.body.item_id) throw invalid({ raw_material_id: "Pick an ingredient or a menu item" });
  let value = 0;
  if (ctx.body.raw_material_id) {
    const m = find(ctx, "raw_materials", ctx.body.raw_material_id, "Ingredient");
    const q = convert(Number(ctx.body.qty), ctx.body.unit, m.unit);
    value = Math.round(q * m.avg_cost);
    update("raw_materials", m.id, { stock: m.stock - q });
    create(ctx, "stock_ledger", "sl", { raw_material_id: m.id, qty: -q, reason: "wastage", ref_id: null, balance_after: m.stock - q });
  } else {
    const it = find(ctx, "items", ctx.body.item_id, "Item");
    value = it.price * Number(ctx.body.qty);
  }
  return create(ctx, "wastage", "ws", { raw_material_id: ctx.body.raw_material_id ?? null, item_id: ctx.body.item_id ?? null, qty: Number(ctx.body.qty), unit: ctx.body.unit, reason: ctx.body.reason, note: ctx.body.note ?? "", value });
}, { perm: "kds.wastage" });

/* Physical stock count with variance (M5.9) */
route("GET", "/stock-counts", (ctx) => [...scoped(ctx, "stock_counts")].sort((a, b) => b.created_at.localeCompare(a.created_at)), { perm: "stock.view" });
route("POST", "/stock-counts", (ctx) => {
  need(ctx.body, ["lines"]);
  const lines = (ctx.body.lines as { raw_material_id: string; counted_qty: number }[]).map((l) => {
    const m = find(ctx, "raw_materials", l.raw_material_id, "Ingredient");
    return { raw_material_id: m.id, system_qty: m.stock, counted_qty: Number(l.counted_qty) };
  });
  const sc = create(ctx, "stock_counts", "sc", { counted_on: today(ctx), lines, status: ctx.body.post ? "posted" : "draft" }) as E.StockCount;
  if (ctx.body.post) {
    for (const l of lines) {
      const diff = l.counted_qty - l.system_qty;
      if (!diff) continue;
      update("raw_materials", l.raw_material_id, { stock: l.counted_qty });
      create(ctx, "stock_ledger", "sl", { raw_material_id: l.raw_material_id, qty: diff, reason: "count_adjust", ref_id: sc.id, balance_after: l.counted_qty });
    }
    audit(ctx, "stock_count", "stock_count", sc.id, null, { lines: lines.length });
  }
  return sc;
}, { perm: "stock.receive" });

/** Stock transfer between store and kitchen (optional, M5.8): recorded in the ledger, net zero. */
route("POST", "/stock/transfer", (ctx) => {
  need(ctx.body, ["raw_material_id", "qty", "from", "to"]);
  const m = find(ctx, "raw_materials", ctx.body.raw_material_id, "Ingredient");
  create(ctx, "stock_ledger", "sl", { raw_material_id: m.id, qty: 0, reason: "transfer", ref_id: `${ctx.body.from}→${ctx.body.to}:${ctx.body.qty}`, balance_after: m.stock });
  return { ok: true };
}, { perm: "stock.receive" });

/* ---------- purchase requests and approvals by value (M5.4) ---------- */

function approvalRole(ctx: Ctx, amount: number): E.RoleKey {
  const mgr = scoped(ctx, "approval_limits").find((l) => l.role === "manager");
  return mgr && amount <= mgr.po_value ? "manager" : "owner";
}

route("GET", "/purchase-requests", (ctx) => [...scoped(ctx, "purchase_requests")].sort((a, b) => b.created_at.localeCompare(a.created_at)), { perm: "stock.view" });
route("POST", "/purchase-requests", (ctx) => {
  need(ctx.body, ["lines"]);
  const lines = (ctx.body.lines as { raw_material_id: string; qty: number; note?: string }[]).filter((l) => l.qty > 0);
  if (!lines.length) throw invalid({ lines: "Add at least one ingredient" });
  const est = lines.reduce((s, l) => s + Math.round(Number(l.qty) * find(ctx, "raw_materials", l.raw_material_id).last_cost), 0);
  const pr = create(ctx, "purchase_requests", "pq", { number: `PR-${String(nextCounter(ctx, "pr", 12)).padStart(4, "0")}`, lines: lines.map((l) => ({ ...l, note: l.note ?? "" })), status: "pending", estimated_value: est }) as E.PurchaseRequest;
  const role = approvalRole(ctx, est);
  create(ctx, "approvals", "ap", { kind: "purchase_request", ref_id: pr.id, amount: est, summary: `Purchase request ${pr.number} · ${lines.length} items`, requested_by: ctx.user!.id, status: "pending", decided_by: null, decided_at: null, required_role: role });
  notify(ctx, role, "Purchase request to approve", `${pr.number} · ₹${est / 100}`, "/admin/approvals");
  return pr;
}, { perm: "stock.request" });

/* Quotations and price comparison (M5.5) */
route("POST", "/quotations", (ctx) => {
  need(ctx.body, ["supplier_id", "lines"]);
  const q = create(ctx, "quotations", "qt", { purchase_request_id: ctx.body.purchase_request_id ?? null, supplier_id: ctx.body.supplier_id, received_on: today(ctx) }) as E.Quotation;
  for (const l of ctx.body.lines as { raw_material_id: string; rate: number }[]) create(ctx, "quotation_lines", "ql", { quotation_id: q.id, raw_material_id: l.raw_material_id, rate: Math.round(Number(l.rate)) });
  return q;
}, { perm: "stock.request" });

route("GET", "/purchase-requests/:id/comparison", (ctx) => {
  const pr = find(ctx, "purchase_requests", ctx.params.id, "Request");
  const quotes = scoped(ctx, "quotations").filter((q) => q.purchase_request_id === pr.id);
  const qlines = scoped(ctx, "quotation_lines");
  const suppliers = scoped(ctx, "suppliers");
  return {
    request: pr,
    suppliers: quotes.map((q) => ({ quotation_id: q.id, supplier_id: q.supplier_id, name: suppliers.find((s) => s.id === q.supplier_id)?.name })),
    rows: pr.lines.map((l) => {
      const m = find(ctx, "raw_materials", l.raw_material_id);
      const rates = quotes.map((q) => ({ supplier_id: q.supplier_id, rate: qlines.find((x) => x.quotation_id === q.id && x.raw_material_id === m.id)?.rate ?? null }));
      const valid = rates.filter((r) => r.rate != null) as { supplier_id: string; rate: number }[];
      const lowest = valid.sort((a, b) => a.rate - b.rate)[0] ?? null;
      return {
        raw_material_id: m.id, name: m.name, unit: m.unit, qty: l.qty, last_price: m.last_cost, rates,
        lowest_supplier_id: lowest?.supplier_id ?? null, lowest_price: lowest?.rate ?? null,
        change_pct: lowest && m.last_cost ? ((lowest.rate - m.last_cost) / m.last_cost) * 100 : null,
      };
    }),
  };
}, { perm: "stock.view" });

/** Convert an approved request into POs, one per chosen supplier (default: lowest price). */
route("POST", "/purchase-requests/:id/convert", (ctx) => {
  const pr = find(ctx, "purchase_requests", ctx.params.id, "Request");
  if (pr.status !== "approved") throw invalid({ status: "Approve the request first" });
  const choice = (ctx.body.choice ?? {}) as Record<string, { supplier_id: string; rate: number }>;
  const groups = new Map<string, { raw_material_id: string; qty: number; rate: number }[]>();
  for (const l of pr.lines) {
    const m = find(ctx, "raw_materials", l.raw_material_id);
    const c = choice[l.raw_material_id] ?? { supplier_id: m.supplier_id ?? scoped(ctx, "suppliers")[0]?.id, rate: m.last_cost };
    if (!c.supplier_id) throw invalid({ supplier_id: `Pick a supplier for ${m.name}` });
    groups.set(c.supplier_id, [...(groups.get(c.supplier_id) ?? []), { raw_material_id: m.id, qty: l.qty, rate: c.rate }]);
  }
  const pos = [...groups.entries()].map(([supplierId, lines]) => makePO(ctx, supplierId, lines, pr.id, "approved"));
  update("purchase_requests", pr.id, { status: "ordered" });
  return pos;
}, { perm: "stock.approve" });

function makePO(ctx: Ctx, supplierId: string, lines: { raw_material_id: string; qty: number; rate: number }[], prId: string | null, status: E.PurchaseOrder["status"]) {
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.rate), 0);
  const po = create(ctx, "purchase_orders", "po", {
    number: `PO-${String(nextCounter(ctx, "po", 42)).padStart(4, "0")}`, supplier_id: supplierId, purchase_request_id: prId, status,
    expected_on: new Date(ctx.now.getTime() + 2 * 86400000).toISOString().slice(0, 10), total,
  }) as E.PurchaseOrder;
  for (const l of lines) create(ctx, "po_lines", "pol", { purchase_order_id: po.id, raw_material_id: l.raw_material_id, qty: Number(l.qty), rate: Math.round(l.rate), received_qty: 0 });
  if (status === "pending") {
    const role = approvalRole(ctx, total);
    create(ctx, "approvals", "ap", { kind: "purchase_order", ref_id: po.id, amount: total, summary: `Purchase order ${po.number}`, requested_by: ctx.user!.id, status: "pending", decided_by: null, decided_at: null, required_role: role });
    notify(ctx, role, "Purchase order to approve", `${po.number} · ₹${total / 100}`, "/admin/approvals");
  }
  return po;
}

function poDetail(ctx: Ctx, po: E.PurchaseOrder) {
  const mats = scoped(ctx, "raw_materials");
  return {
    ...po, supplier: scoped(ctx, "suppliers").find((s) => s.id === po.supplier_id),
    lines: scoped(ctx, "po_lines").filter((l) => l.purchase_order_id === po.id).map((l) => ({ ...l, name: mats.find((m) => m.id === l.raw_material_id)?.name, unit: mats.find((m) => m.id === l.raw_material_id)?.unit })),
    grns: scoped(ctx, "grns").filter((g) => g.purchase_order_id === po.id),
  };
}

route("GET", "/purchase-orders", (ctx) => [...scoped(ctx, "purchase_orders")].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => poDetail(ctx, p)), { perm: "stock.view" });
route("GET", "/purchase-orders/:id", (ctx) => poDetail(ctx, find(ctx, "purchase_orders", ctx.params.id, "PO")), { perm: "stock.view" });

/** A PO within the user's limit is approved immediately; above it waits in the approval queue. */
route("POST", "/purchase-orders", (ctx) => {
  need(ctx.body, ["supplier_id", "lines"]);
  const lines = (ctx.body.lines as { raw_material_id: string; qty: number; rate: number }[]).filter((l) => l.qty > 0);
  if (!lines.length) throw invalid({ lines: "Add at least one line" });
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.rate), 0);
  const canApprove = ctx.perms.includes("stock.approve") && total <= (scoped(ctx, "approval_limits").find((l) => l.role === ctx.user!.role)?.po_value ?? 0);
  return poDetail(ctx, makePO(ctx, ctx.body.supplier_id, lines, null, canApprove ? "approved" : "pending"));
}, { perm: "stock.request" });

/** Auto-create POs for low items, one per supplier (wireframe "Auto-create POs"). */
route("POST", "/stock/auto-po", (ctx) => {
  const low = scoped(ctx, "raw_materials").filter((m) => m.stock < m.min_level && m.supplier_id);
  const groups = new Map<string, { raw_material_id: string; qty: number; rate: number }[]>();
  for (const m of low) groups.set(m.supplier_id!, [...(groups.get(m.supplier_id!) ?? []), { raw_material_id: m.id, qty: Math.ceil(m.min_level * 2 - m.stock), rate: m.last_cost }]);
  return [...groups.entries()].map(([s, l]) => poDetail(ctx, makePO(ctx, s, l, null, "pending")));
}, { perm: "stock.request" });

/** Send PO to the supplier as a WhatsApp link (PDF is printed from the PO page). */
route("POST", "/purchase-orders/:id/send", (ctx) => {
  const po = find(ctx, "purchase_orders", ctx.params.id, "PO");
  if (!["approved", "sent"].includes(po.status)) throw invalid({ status: "Only approved POs can be sent" });
  const d = poDetail(ctx, po);
  const outlet = settingsOf(ctx, "outlets");
  const body = `${outlet.name} purchase order ${po.number}:\n${d.lines.map((l) => `• ${l.name} ${l.qty} ${l.unit} @ ₹${l.rate / 100}`).join("\n")}\nTotal ₹${po.total / 100}. Deliver by ${po.expected_on}.`;
  update("purchase_orders", po.id, { status: "sent" });
  create(ctx, "message_logs", "ml", { customer_id: null, channel: "whatsapp_link", template: "po", to: d.supplier?.phone ?? "", body, status: "prepared" });
  return { whatsapp_url: `https://wa.me/91${(d.supplier?.phone ?? "").replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(body)}` };
}, { perm: "stock.request" });

/** Goods receipt against a PO (M5.6): updates stock, weighted average cost and the supplier ledger. */
route("POST", "/grns", (ctx) => {
  need(ctx.body, ["purchase_order_id", "lines"]);
  const po = find(ctx, "purchase_orders", ctx.body.purchase_order_id, "PO");
  if (!["approved", "sent", "partially_received"].includes(po.status)) throw invalid({ purchase_order_id: "This PO isn't open for receiving" });
  const grn = create(ctx, "grns", "gr", { number: `GRN-${String(nextCounter(ctx, "grn", 31)).padStart(4, "0")}`, purchase_order_id: po.id, supplier_id: po.supplier_id, received_on: today(ctx), total: 0, invoice_ref: ctx.body.invoice_ref ?? "" }) as E.GRN;
  let total = 0;
  for (const l of ctx.body.lines as { po_line_id: string; received_qty: number; rate?: number; batch?: string; expiry?: string }[]) {
    const pl = find(ctx, "po_lines", l.po_line_id, "PO line");
    const qty = Number(l.received_qty);
    if (qty <= 0) continue;
    const rate = Math.round(l.rate ?? pl.rate);
    const m = find(ctx, "raw_materials", pl.raw_material_id);
    const oldQty = Math.max(0, m.stock);
    const avg = oldQty + qty > 0 ? Math.round((oldQty * m.avg_cost + qty * rate) / (oldQty + qty)) : rate;
    update("raw_materials", m.id, { stock: m.stock + qty, avg_cost: avg, last_cost: rate });
    create(ctx, "stock_ledger", "sl", { raw_material_id: m.id, qty, reason: "grn", ref_id: grn.id, balance_after: m.stock + qty });
    update("po_lines", pl.id, { received_qty: pl.received_qty + qty });
    create(ctx, "grn_lines", "grl", { grn_id: grn.id, po_line_id: pl.id, raw_material_id: m.id, received_qty: qty, rate, batch: l.batch || null, expiry: l.expiry || null, shortfall: Math.max(0, pl.qty - pl.received_qty - qty) });
    total += Math.round(qty * rate);
  }
  update("grns", grn.id, { total });
  const lines = scoped(ctx, "po_lines").filter((l) => l.purchase_order_id === po.id);
  update("purchase_orders", po.id, { status: lines.every((l) => l.received_qty >= l.qty) ? "received" : "partially_received" });
  const s = find(ctx, "suppliers", po.supplier_id);
  update("suppliers", s.id, { outstanding: s.outstanding + total });
  return find(ctx, "grns", grn.id);
}, { perm: "stock.receive" });

route("GET", "/grns", (ctx) => [...scoped(ctx, "grns")].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((g) => ({ ...g, supplier: scoped(ctx, "suppliers").find((s) => s.id === g.supplier_id)?.name, lines: scoped(ctx, "grn_lines").filter((l) => l.grn_id === g.id) })), { perm: "stock.view" });

/* Supplier payments and payable ageing (M5.7) */
route("GET", "/supplier-payments", (ctx) => [...scoped(ctx, "supplier_payments")].sort((a, b) => b.paid_on.localeCompare(a.paid_on)), { perm: "stock.approve" });
route("POST", "/supplier-payments", (ctx) => {
  need(ctx.body, ["supplier_id", "amount", "mode"]);
  const s = find(ctx, "suppliers", ctx.body.supplier_id, "Supplier");
  const amount = Math.round(Number(ctx.body.amount));
  if (amount <= 0) throw invalid({ amount: "Enter an amount" });
  update("suppliers", s.id, { outstanding: s.outstanding - amount });
  audit(ctx, "supplier_payment", "supplier", s.id, { outstanding: s.outstanding }, { paid: amount });
  return create(ctx, "supplier_payments", "spy", { supplier_id: s.id, amount, mode: ctx.body.mode, reference: ctx.body.reference ?? "", paid_on: ctx.body.paid_on ?? today(ctx) });
}, { perm: "stock.approve" });

route("GET", "/payables/ageing", (ctx) => {
  return scoped(ctx, "suppliers").map((s) => {
    const grns = scoped(ctx, "grns").filter((g) => g.supplier_id === s.id);
    let paid = scoped(ctx, "supplier_payments").filter((p) => p.supplier_id === s.id).reduce((a, p) => a + p.amount, 0);
    const buckets = { "0-15": 0, "16-30": 0, "31-60": 0, "60+": 0 };
    for (const g of [...grns].sort((a, b) => a.received_on.localeCompare(b.received_on))) {
      const due = Math.max(0, g.total - paid);
      paid = Math.max(0, paid - g.total);
      if (!due) continue;
      const days = (ctx.now.getTime() - new Date(g.received_on).getTime()) / 86400000;
      const k = days <= 15 ? "0-15" : days <= 30 ? "16-30" : days <= 60 ? "31-60" : "60+";
      buckets[k] += due;
    }
    return { supplier_id: s.id, name: s.name, outstanding: s.outstanding, terms: s.payment_terms_days, buckets };
  });
}, { perm: "stock.approve" });

/* ---------- approval queue (Core/Approvals, shared by PR, PO, expense) ---------- */

route("GET", "/approvals", (ctx) => {
  const rows = scoped(ctx, "approvals").filter((a) => (ctx.query.status ? a.status === ctx.query.status : true));
  const users = scoped(ctx, "users");
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => ({ ...a, requested_by_name: users.find((u) => u.id === a.requested_by)?.name, decided_by_name: users.find((u) => u.id === a.decided_by)?.name ?? null, can_decide: ROLE_RANK[ctx.user!.role] >= ROLE_RANK[a.required_role] }));
}, { perm: "approvals.decide" });

route("POST", "/approvals/:id/decide", (ctx) => {
  const a = find(ctx, "approvals", ctx.params.id, "Approval");
  if (a.status !== "pending") throw invalid({ status: "Already decided" });
  if (ROLE_RANK[ctx.user!.role] < ROLE_RANK[a.required_role]) throw forbidden(`Needs ${a.required_role} approval`);
  const ok = ctx.body.decision === "approve";
  update("approvals", a.id, { status: ok ? "approved" : "rejected", decided_by: ctx.user!.id, decided_at: ctx.now.toISOString() });
  const status = ok ? "approved" : "rejected";
  if (a.kind === "purchase_request") update("purchase_requests", a.ref_id, { status });
  if (a.kind === "purchase_order") update("purchase_orders", a.ref_id, { status });
  if (a.kind === "expense") update("expenses", a.ref_id, { status });
  if (a.kind === "attendance" && ok) {
    const att = find(ctx, "attendance", a.ref_id);
    const patch = JSON.parse(att.correction_note ?? "{}").patch ?? {};
    update("attendance", att.id, { ...patch, correction_note: null });
  }
  audit(ctx, ok ? "approve" : "reject", a.kind, a.ref_id, null, { amount: a.amount, note: ctx.body.note ?? "" });
  return find(ctx, "approvals", a.id);
}, { perm: "approvals.decide" });

/* ---------- expenses and budget (M6) ---------- */

crud("/expense-categories", "expense_categories", "ec", { perm: "settings.manage", readPerm: "expenses.create", required: ["name"], defaults: { monthly_budget: 0 } });

route("GET", "/expenses", (ctx) => {
  let rows = scoped(ctx, "expenses");
  if (ctx.query.month) rows = rows.filter((e) => e.spent_on.startsWith(ctx.query.month));
  if (ctx.query.petty) rows = rows.filter((e) => e.petty_cash);
  const cats = scoped(ctx, "expense_categories");
  return [...rows].sort((a, b) => b.spent_on.localeCompare(a.spent_on)).map((e) => ({ ...e, category: cats.find((c) => c.id === e.category_id)?.name }));
}, { perm: "expenses.create" });

route("POST", "/expenses", (ctx) => {
  need(ctx.body, ["category_id", "amount", "mode"]);
  const amount = Math.round(Number(ctx.body.amount));
  if (amount <= 0) throw invalid({ amount: "Enter an amount" });
  const limit = scoped(ctx, "approval_limits").find((l) => l.role === ctx.user!.role)?.expense_value ?? 0;
  const auto = amount <= limit;
  const e = create(ctx, "expenses", "ex", {
    category_id: ctx.body.category_id, amount, mode: ctx.body.mode, spent_on: ctx.body.spent_on ?? today(ctx), note: ctx.body.note ?? "",
    bill_photo_url: ctx.body.bill_photo_url ?? null, status: auto ? "approved" : "pending", petty_cash: !!ctx.body.petty_cash,
  }) as E.Expense;
  if (!auto) {
    const mgr = scoped(ctx, "approval_limits").find((l) => l.role === "manager");
    const role: E.RoleKey = mgr && amount <= mgr.expense_value && ctx.user!.role !== "manager" ? "manager" : "owner";
    create(ctx, "approvals", "ap", { kind: "expense", ref_id: e.id, amount, summary: `Expense · ${e.note || "no note"}`, requested_by: ctx.user!.id, status: "pending", decided_by: null, decided_at: null, required_role: role });
    notify(ctx, role, "Expense to approve", `₹${amount / 100} · ${e.note}`, "/admin/approvals");
  }
  return e;
}, { perm: "expenses.create" });

route("DELETE", "/expenses/:id", (ctx) => {
  const e = find(ctx, "expenses", ctx.params.id, "Expense");
  if (e.status === "approved" && !ctx.perms.includes("expenses.approve")) throw forbidden("Approved expenses can only be removed by a manager");
  update("expenses", e.id, { deleted_at: ctx.now.toISOString() });
  audit(ctx, "delete", "expense", e.id, e, null);
  return { deleted: true };
}, { perm: "expenses.create" });

route("GET", "/budgets", (ctx) => {
  const month = ctx.query.month ?? today(ctx).slice(0, 7);
  const cats = scoped(ctx, "expense_categories");
  const budgets = scoped(ctx, "budgets").filter((b) => b.month === month);
  const exp = scoped(ctx, "expenses").filter((e) => e.spent_on.startsWith(month) && e.status === "approved");
  return cats.map((c) => {
    const budget = budgets.find((b) => b.category_id === c.id)?.amount ?? c.monthly_budget;
    const actual = exp.filter((e) => e.category_id === c.id).reduce((s, e) => s + e.amount, 0);
    return { category_id: c.id, category: c.name, month, budget, actual, variance: actual - budget, variance_pct: budget ? ((actual - budget) / budget) * 100 : null };
  });
}, { perm: "expenses.create" });

route("PUT", "/budgets", (ctx) => {
  need(ctx.body, ["month", "category_id", "amount"]);
  const existing = scoped(ctx, "budgets").find((b) => b.month === ctx.body.month && b.category_id === ctx.body.category_id);
  if (existing) return update("budgets", existing.id, { amount: Math.round(Number(ctx.body.amount)) });
  return create(ctx, "budgets", "bg", { category_id: ctx.body.category_id, month: ctx.body.month, amount: Math.round(Number(ctx.body.amount)) });
}, { perm: "expenses.approve" });

export { HttpError, checkLimit };

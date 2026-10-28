import type * as E from "@/shared/types/entities";
import { audit, create, crud, find, invalid, need, notify, route, scoped, settingsOf, today, update, type Ctx } from "../core";
import { recalc, runningTableOrder, tableBills } from "./orders";

/** Dine-in (M2): floor, tables, QR, merge/split/move, reservations, waitlist. */

crud("/areas", "areas", "ar", { perm: "settings.manage", readPerm: "tables.manage", required: ["name"], defaults: { sort: 99 } });

route("GET", "/floor", (ctx) => {
  const sessions = scoped(ctx, "table_sessions").filter((s) => !s.closed_at);
  const orders = scoped(ctx, "orders").filter((o) => o.table_id && !["completed", "cancelled"].includes(o.status));
  const items = scoped(ctx, "order_items");
  const users = scoped(ctx, "users");
  const reservations = scoped(ctx, "reservations").filter((r) => r.date === today(ctx) && ["booked", "confirmed"].includes(r.status));
  return {
    areas: [...scoped(ctx, "areas")].sort((a, b) => a.sort - b.sort),
    tables: scoped(ctx, "dining_tables").map((t) => {
      const s = sessions.find((x) => x.id === t.current_session_id) ?? null;
      const mine = orders.filter((x) => x.table_id === t.id);
      const o = mine.find((x) => x.payment_status === "unpaid") ?? mine.find((x) => x.payment_status !== "paid") ?? mine[0] ?? null;
      return {
        ...t, session: s ? { ...s, captain_name: users.find((u) => u.id === s.captain_id)?.name ?? null } : null,
        bill: t.current_session_id ? tableBills(ctx, t.current_session_id) : null,
        order: o ? { id: o.id, number: o.number, total: o.total, status: o.status, bill_requested: o.bill_requested, updated_at: o.updated_at, items: items.filter((i) => i.order_id === o.id && i.status !== "void").map((i) => ({ id: i.id, name: i.name, qty: i.qty, status: i.status })) } : null,
        reservation: reservations.find((r) => r.table_id === t.id) ?? null,
      };
    }),
  };
}, { auth: "staff" });

crud("/tables", "dining_tables", "tb", { perm: "settings.manage", readPerm: "tables.manage", required: ["name", "area_id"], defaults: { seats: 4, status: "free", merged_into: null, current_session_id: null } });

/** Bulk add tables in the setup wizard (T1..T12) with auto QR codes. */
route("POST", "/tables/bulk", (ctx) => {
  need(ctx.body, ["area_id", "count"]);
  const existing = scoped(ctx, "dining_tables");
  let n = existing.length;
  const out = [];
  for (let i = 0; i < Math.min(100, Number(ctx.body.count)); i++) {
    n++;
    out.push(create(ctx, "dining_tables", "tb", { area_id: ctx.body.area_id, name: `${ctx.body.prefix ?? "T"}${n}`, seats: Number(ctx.body.seats ?? 4), status: "free", qr_code: `${ctx.tenant.slug.slice(0, 2)}${n}${Math.floor(100 + Math.random() * 900)}`, merged_into: null, current_session_id: null }));
  }
  return out;
}, { perm: "settings.manage" });

route("PATCH", "/tables/:id/status", (ctx) => {
  const t = find(ctx, "dining_tables", ctx.params.id, "Table");
  const to = ctx.body.status as E.TableStatus;
  if (to === "free" && t.current_session_id) {
    const open = scoped(ctx, "orders").some((o) => o.table_session_id === t.current_session_id && !["completed", "cancelled"].includes(o.status));
    if (open) throw invalid({ status: "This table still has an open bill" });
    update("table_sessions", t.current_session_id, { closed_at: ctx.now.toISOString() });
  }
  return update("dining_tables", t.id, { status: to, ...(to === "free" ? { current_session_id: null, merged_into: null } : {}) });
}, { perm: "tables.manage" });

/** Attach a customer to the running table (captain/receptionist). */
route("POST", "/tables/:id/customer", (ctx) => {
  const t = find(ctx, "dining_tables", ctx.params.id, "Table");
  need(ctx.body, ["customer_id"]);
  const c = find(ctx, "customers", ctx.body.customer_id, "Customer");
  if (t.current_session_id) update("table_sessions", t.current_session_id, { customer_id: c.id });
  for (const o of scoped(ctx, "orders").filter((o) => o.table_id === t.id && !["completed", "cancelled"].includes(o.status))) {
    update("orders", o.id, { customer_id: c.id, customer_name: c.name, customer_phone: c.phone });
    recalc(ctx, find(ctx, "orders", o.id));
  }
  return { ok: true };
}, { perm: "orders.take" });

/** Move an order to another table (M2.1). */
route("POST", "/tables/move", (ctx) => {
  need(ctx.body, ["from_table_id", "to_table_id"]);
  const from = find(ctx, "dining_tables", ctx.body.from_table_id, "Table");
  const to = find(ctx, "dining_tables", ctx.body.to_table_id, "Table");
  if (to.status === "occupied" || to.status === "bill_requested") throw invalid({ to_table_id: `${to.name} is in use. Merge instead.` });
  if (!from.current_session_id) throw invalid({ from_table_id: `${from.name} has no running order` });
  update("table_sessions", from.current_session_id, { table_id: to.id });
  for (const o of scoped(ctx, "orders").filter((o) => o.table_id === from.id && !["completed", "cancelled"].includes(o.status))) update("orders", o.id, { table_id: to.id });
  for (const k of scoped(ctx, "kots").filter((k) => k.table_name === from.name && k.status !== "served")) update("kots", k.id, { table_name: to.name });
  update("dining_tables", to.id, { status: from.status, current_session_id: from.current_session_id });
  update("dining_tables", from.id, { status: "cleaning", current_session_id: null });
  audit(ctx, "table_move", "table", from.id, { table: from.name }, { table: to.name });
  return { ok: true };
}, { perm: "tables.manage" });

/** Merge tables: the others point to the main table and share its session and bill. */
route("POST", "/tables/merge", (ctx) => {
  need(ctx.body, ["into_id", "table_ids"]);
  const into = find(ctx, "dining_tables", ctx.body.into_id, "Table");
  for (const id of ctx.body.table_ids as string[]) {
    if (id === into.id) continue;
    const t = find(ctx, "dining_tables", id, "Table");
    if (t.current_session_id && t.current_session_id !== into.current_session_id) {
      // Bring its running order onto the main table.
      for (const o of scoped(ctx, "orders").filter((o) => o.table_id === t.id && !["completed", "cancelled"].includes(o.status))) {
        update("orders", o.id, { table_id: into.id, table_session_id: into.current_session_id });
      }
      update("table_sessions", t.current_session_id, { closed_at: ctx.now.toISOString() });
    }
    update("dining_tables", t.id, { merged_into: into.id, status: "occupied", current_session_id: into.current_session_id });
  }
  return { ok: true };
}, { perm: "tables.manage" });

route("POST", "/tables/:id/split", (ctx) => {
  const t = find(ctx, "dining_tables", ctx.params.id, "Table");
  for (const x of scoped(ctx, "dining_tables").filter((x) => x.merged_into === t.id)) update("dining_tables", x.id, { merged_into: null, status: "free", current_session_id: null });
  return { ok: true };
}, { perm: "tables.manage" });

/* ---------- QR (public, tied to one table) ---------- */

route("GET", "/qr/:code", (ctx) => {
  const t = scoped(ctx, "dining_tables").find((x) => x.qr_code === ctx.params.code);
  if (!t) throw invalid({ code: "This QR code is not valid for this café" });
  const area = scoped(ctx, "areas").find((a) => a.id === t.area_id);
  const order = (t.current_session_id && runningTableOrder(ctx, t.current_session_id)) || scoped(ctx, "orders").find((o) => o.table_id === t.id && o.table_session_id === t.current_session_id && t.current_session_id && !["completed", "cancelled"].includes(o.status));
  return { table: { id: t.id, name: t.name, seats: t.seats, status: t.status, area: area?.name ?? "" }, open_order_id: order?.id ?? null, flow: settingsOf(ctx, "business_type_flags").qr_order_flow };
}, { auth: "public" });

route("POST", "/qr/:code/call-waiter", (ctx) => {
  const t = scoped(ctx, "dining_tables").find((x) => x.qr_code === ctx.params.code);
  if (!t) throw invalid({ code: "Invalid QR" });
  if (t.current_session_id) update("table_sessions", t.current_session_id, { waiter_called_at: ctx.now.toISOString() });
  const s = t.current_session_id ? scoped(ctx, "table_sessions").find((x) => x.id === t.current_session_id) : null;
  notify(ctx, "captain", "Waiter called", `${t.name} is calling a waiter`, "/captain", s?.captain_id ?? null);
  return { ok: true };
}, { auth: "public" });

route("POST", "/tables/:id/ack-call", (ctx) => {
  const t = find(ctx, "dining_tables", ctx.params.id, "Table");
  if (t.current_session_id) update("table_sessions", t.current_session_id, { waiter_called_at: null });
  return { ok: true };
}, { perm: "orders.take" });

/* ---------- reservations (M2.6) ---------- */

function messageLink(ctx: Ctx, phone: string, template: E.MessageLog["template"], body: string, customerId: string | null = null) {
  create(ctx, "message_logs", "ml", { customer_id: customerId, channel: "whatsapp_link", template, to: phone, body, status: "prepared" });
  return `https://wa.me/91${phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(body)}`;
}

route("GET", "/reservations", (ctx) => {
  let rows = scoped(ctx, "reservations");
  if (ctx.query.date) rows = rows.filter((r) => r.date === ctx.query.date);
  if (ctx.query.from) rows = rows.filter((r) => r.date >= ctx.query.from);
  return [...rows].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}, { perm: "reservations.manage" });

function createReservation(ctx: Ctx) {
  need(ctx.body, ["name", "phone", "date", "time", "party_size"]);
  if (ctx.body.date < today(ctx)) throw invalid({ date: "Pick today or a later date" });
  const outlet = settingsOf(ctx, "outlets");
  const r = create(ctx, "reservations", "rs", {
    customer_id: ctx.customer?.id ?? ctx.body.customer_id ?? null, name: ctx.body.name, phone: ctx.body.phone, date: ctx.body.date, time: ctx.body.time,
    party_size: Number(ctx.body.party_size), table_preference: ctx.body.table_preference ?? "", table_id: ctx.body.table_id ?? null, notes: ctx.body.notes ?? "",
    status: ctx.user ? "confirmed" : "booked",
  }) as E.Reservation;
  const link = messageLink(ctx, r.phone, "reservation", `Hi ${r.name}, your table for ${r.party_size} at ${outlet.name} on ${r.date} at ${r.time} is ${r.status === "confirmed" ? "confirmed" : "requested"}. See you soon!`, r.customer_id);
  if (!ctx.user) notify(ctx, "receptionist", "New reservation request", `${r.name} · ${r.party_size} pax · ${r.date} ${r.time}`, "/admin/reservations");
  return { reservation: r, whatsapp_url: link };
}
route("POST", "/reservations", (ctx) => createReservation(ctx), { perm: "reservations.manage" });
route("POST", "/public/reservations", (ctx) => {
  if (!settingsOf(ctx, "business_type_flags").features.reservations) throw invalid({ date: "This café doesn't take reservations" });
  return createReservation(ctx);
}, { auth: "customer_optional" });

route("PATCH", "/reservations/:id", (ctx) => {
  const r = find(ctx, "reservations", ctx.params.id, "Reservation");
  const { id: _i, tenant_id: _t, ...patch } = ctx.body;
  const next = update("reservations", r.id, patch) as E.Reservation;
  if (patch.status === "seated" && next.table_id) {
    const s = create(ctx, "table_sessions", "ts", { table_id: next.table_id, guests: next.party_size, captain_id: null, customer_id: next.customer_id, opened_at: ctx.now.toISOString(), closed_at: null, waiter_called_at: null });
    update("dining_tables", next.table_id, { status: "occupied", current_session_id: (s as E.TableSession).id });
  }
  if (patch.table_id && ["booked", "confirmed"].includes(next.status) && next.date === today(ctx)) update("dining_tables", patch.table_id, { status: "reserved" });
  if (patch.status === "confirmed") {
    const outlet = settingsOf(ctx, "outlets");
    return { reservation: next, whatsapp_url: messageLink(ctx, next.phone, "reservation", `Hi ${next.name}, your table for ${next.party_size} at ${outlet.name} on ${next.date} at ${next.time} is confirmed.`, next.customer_id) };
  }
  return { reservation: next, whatsapp_url: null };
}, { perm: "reservations.manage" });

/* ---------- waitlist (M2.7) ---------- */

route("GET", "/waitlist", (ctx) => scoped(ctx, "waitlist_entries").filter((w) => ["waiting", "notified"].includes(w.status)).sort((a, b) => a.created_at.localeCompare(b.created_at)), { perm: "reservations.manage" });

route("POST", "/waitlist", (ctx) => {
  need(ctx.body, ["name", "phone", "party_size"]);
  const ahead = scoped(ctx, "waitlist_entries").filter((w) => w.status === "waiting").length;
  return create(ctx, "waitlist_entries", "wl", { name: ctx.body.name, phone: ctx.body.phone, party_size: Number(ctx.body.party_size), quoted_wait_min: Number(ctx.body.quoted_wait_min ?? (ahead + 1) * 8), status: "waiting", table_id: null });
}, { perm: "reservations.manage" });

route("POST", "/waitlist/:id/notify", (ctx) => {
  const w = find(ctx, "waitlist_entries", ctx.params.id, "Entry");
  update("waitlist_entries", w.id, { status: "notified" });
  const outlet = settingsOf(ctx, "outlets");
  return { whatsapp_url: messageLink(ctx, w.phone, "table_ready", `Hi ${w.name}, your table at ${outlet.name} is ready! Please come to the host stand.`) };
}, { perm: "reservations.manage" });

route("POST", "/waitlist/:id/seat", (ctx) => {
  const w = find(ctx, "waitlist_entries", ctx.params.id, "Entry");
  need(ctx.body, ["table_id"]);
  const t = find(ctx, "dining_tables", ctx.body.table_id, "Table");
  if (!["free", "reserved", "cleaning"].includes(t.status)) throw invalid({ table_id: `${t.name} is in use` });
  const s = create(ctx, "table_sessions", "ts", { table_id: t.id, guests: w.party_size, captain_id: null, customer_id: null, opened_at: ctx.now.toISOString(), closed_at: null, waiter_called_at: null }) as E.TableSession;
  update("dining_tables", t.id, { status: "occupied", current_session_id: s.id });
  return update("waitlist_entries", w.id, { status: "seated", table_id: t.id });
}, { perm: "reservations.manage" });

route("POST", "/waitlist/:id/left", (ctx) => update("waitlist_entries", find(ctx, "waitlist_entries", ctx.params.id).id, { status: "left" }), { perm: "reservations.manage" });

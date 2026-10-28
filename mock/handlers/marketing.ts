import type * as E from "@/shared/types/entities";
import { create, crud, find, invalid, need, route, scoped, settingsOf, today, update } from "../core";

/** Customers and marketing (M4): loyalty, coupons, gift cards, memberships, offers, greetings, feedback. */

crud("/coupons", "coupons", "cp", {
  perm: "marketing.manage", required: ["code", "kind", "value"], auditAs: "coupon",
  defaults: { max_discount: null, min_order: 0, usage_limit_total: null, usage_limit_per_customer: 1, used_count: 0, order_types: [], item_ids: [], active: true },
});
crud("/membership-plans", "membership_plans", "mp", { perm: "marketing.manage", required: ["name", "price", "validity_days"], defaults: { discount_pct: 0, free_item_id: null, benefits: "", active: true } });
crud("/offers", "offers", "of", { perm: "marketing.manage", required: ["name", "kind"], defaults: { description: "", discount_pct: 0, days: [0, 1, 2, 3, 4, 5, 6], start_time: "00:00", end_time: "23:59", item_ids: [], buy_qty: 0, get_qty: 0, combo_price: null, active: true } });

/** Public: active offers and coupons a customer may see on the menu. */
route("GET", "/public/offers", (ctx) => ({
  offers: scoped(ctx, "offers").filter((o) => o.active),
  coupons: scoped(ctx, "coupons").filter((c) => c.active && c.valid_to >= today(ctx)).map((c) => ({ code: c.code, kind: c.kind, value: c.value, min_order: c.min_order, max_discount: c.max_discount })),
}), { auth: "public" });

route("GET", "/loyalty-settings", (ctx) => settingsOf(ctx, "loyalty_settings"), { perm: "marketing.manage" });

/* Gift cards (M4.4) */
route("GET", "/gift-cards", (ctx) => [...scoped(ctx, "gift_cards")].sort((a, b) => b.created_at.localeCompare(a.created_at)), { perm: "marketing.manage" });
route("POST", "/gift-cards", (ctx) => {
  need(ctx.body, ["value"]);
  const code = `GIFT-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
  const g = create(ctx, "gift_cards", "gc", {
    code, initial_value: Number(ctx.body.value), balance: Number(ctx.body.value), customer_id: ctx.body.customer_id ?? null,
    expires_on: ctx.body.expires_on ?? new Date(ctx.now.getTime() + 365 * 86400000).toISOString().slice(0, 10), active: true,
  }) as E.GiftCard;
  create(ctx, "gift_card_txns", "gt", { gift_card_id: g.id, order_id: null, amount: g.initial_value });
  return g;
}, { perm: "marketing.manage" });
route("PUT", "/gift-cards/:id", (ctx) => update("gift_cards", find(ctx, "gift_cards", ctx.params.id).id, { active: !!ctx.body.active }), { perm: "marketing.manage" });
route("GET", "/gift-cards/check/:code", (ctx) => {
  const g = scoped(ctx, "gift_cards").find((x) => x.code.toUpperCase() === ctx.params.code.toUpperCase());
  if (!g) throw invalid({ code: "Gift card not found" });
  return { code: g.code, balance: g.balance, expires_on: g.expires_on, active: g.active };
}, { auth: "public" });

/* Memberships (M4.5) */
route("GET", "/memberships", (ctx) =>
  scoped(ctx, "memberships").map((m) => ({ ...m, customer: scoped(ctx, "customers").find((c) => c.id === m.customer_id)?.name, plan: scoped(ctx, "membership_plans").find((p) => p.id === m.plan_id)?.name })),
{ perm: "marketing.manage" });
route("POST", "/memberships", (ctx) => {
  need(ctx.body, ["customer_id", "plan_id"]);
  const plan = find(ctx, "membership_plans", ctx.body.plan_id, "Plan");
  const c = find(ctx, "customers", ctx.body.customer_id, "Customer");
  const start = today(ctx);
  const end = new Date(ctx.now.getTime() + plan.validity_days * 86400000).toISOString().slice(0, 10);
  for (const m of scoped(ctx, "memberships").filter((m) => m.customer_id === c.id && m.status === "active")) update("memberships", m.id, { status: "expired" });
  // The plan price is paid at the POS as a normal sale in a later step; here we record the membership.
  return create(ctx, "memberships", "mb", { plan_id: plan.id, customer_id: c.id, starts_on: start, ends_on: end, status: "active" });
}, { perm: "marketing.manage" });

/** Renewal reminders: memberships ending in the next 15 days. */
route("GET", "/memberships/expiring", (ctx) => {
  const limit = new Date(ctx.now.getTime() + 15 * 86400000).toISOString().slice(0, 10);
  return scoped(ctx, "memberships").filter((m) => m.status === "active" && m.ends_on <= limit).map((m) => {
    const c = scoped(ctx, "customers").find((x) => x.id === m.customer_id);
    const plan = scoped(ctx, "membership_plans").find((p) => p.id === m.plan_id);
    const outlet = settingsOf(ctx, "outlets");
    const body = `Hi ${c?.name}, your ${plan?.name} membership at ${outlet.name} ends on ${m.ends_on}. Renew to keep your ${plan?.discount_pct}% off!`;
    return { ...m, customer: c?.name, phone: c?.phone, plan: plan?.name, whatsapp_url: c?.phone ? `https://wa.me/91${c.phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(body)}` : null };
  });
}, { perm: "marketing.manage" });

/**
 * Birthday and anniversary greetings (M4.7): Phase 1 prepares free click-to-WhatsApp links and emails.
 * Only customers who gave marketing consent are listed (DPDP).
 */
route("GET", "/greetings/today", (ctx) => {
  const md = today(ctx).slice(5);
  const outlet = settingsOf(ctx, "outlets");
  const sent = scoped(ctx, "message_logs").filter((m) => m.created_at.slice(0, 10) === today(ctx) && (m.template === "birthday" || m.template === "anniversary"));
  const out: unknown[] = [];
  for (const c of scoped(ctx, "customers").filter((c) => c.marketing_consent)) {
    for (const kind of ["birthday", "anniversary"] as const) {
      const d = c[kind];
      if (!d || d.slice(5) !== md) continue;
      const coupon = ctx.query.coupon_code ? ` Use code ${ctx.query.coupon_code} for a treat on us.` : "";
      const body = kind === "birthday"
        ? `Happy birthday ${c.name.split(" ")[0]}! 🎂 Wishing you a wonderful year from all of us at ${outlet.name}.${coupon}`
        : `Happy anniversary ${c.name.split(" ")[0]}! 💐 Celebrate with us at ${outlet.name}.${coupon}`;
      out.push({
        customer_id: c.id, name: c.name, phone: c.phone, email: c.email, kind, body,
        sent: sent.some((m) => m.customer_id === c.id && m.template === kind),
        whatsapp_url: c.phone ? `https://wa.me/91${c.phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(body)}` : null,
        mailto: c.email ? `mailto:${c.email}?subject=${encodeURIComponent(`Happy ${kind} from ${outlet.name}`)}&body=${encodeURIComponent(body)}` : null,
      });
    }
  }
  return out;
}, { perm: "marketing.manage" });

route("POST", "/greetings/log", (ctx) => {
  need(ctx.body, ["customer_id", "kind", "body", "channel"]);
  const c = find(ctx, "customers", ctx.body.customer_id, "Customer");
  return create(ctx, "message_logs", "ml", { customer_id: c.id, channel: ctx.body.channel, template: ctx.body.kind, to: ctx.body.channel === "email" ? c.email : c.phone, body: ctx.body.body, status: "sent" });
}, { perm: "marketing.manage" });

route("GET", "/message-logs", (ctx) => [...scoped(ctx, "message_logs")].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200), { perm: "marketing.manage" });

/* Feedback (M4.8) */
route("GET", "/feedback", (ctx) => {
  const orders = scoped(ctx, "orders");
  const customers = scoped(ctx, "customers");
  let rows = scoped(ctx, "feedback");
  if (ctx.query.low) rows = rows.filter((f) => Math.min(f.food, f.service, f.ambience) <= 2);
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300).map((f) => {
    const o = orders.find((x) => x.id === f.order_id);
    return { ...f, order_number: o?.number, order_type: o?.type, customer_name: customers.find((c) => c.id === f.customer_id)?.name ?? "Guest", customer_phone: customers.find((c) => c.id === f.customer_id)?.phone ?? null };
  });
}, { perm: "customers.view" });
route("PATCH", "/feedback/:id", (ctx) => update("feedback", find(ctx, "feedback", ctx.params.id).id, { replied: !!ctx.body.replied }), { perm: "customers.view" });

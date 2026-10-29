"use client";

import { OrderTypeToggle } from "@/modules/orders/components/OrderTypeToggle";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cart, cartCount, cartValue, useCart } from "@/modules/orders/cart";
import { useQ } from "@/shared/api/hooks";
import { useCustomer } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { cx, greeting } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings } from "@/shared/tenant/TenantProvider";
import type { Menu, MenuItem } from "@/shared/types/api";
import { Modal } from "@/shared/ui/overlay";
import { Button, Card, Chip, Empty, FoodMark, Input, Label, Loading, Money, Textarea } from "@/shared/ui/primitives";

/** Customer menu (M1.3): photos, categories, veg/non-veg/egg, variants, add-ons, notes, badges, time slots. */
/** `scanned`: opened from the table QR just now, so no way out to delivery/takeaway is offered here. */
export function Storefront({ tableName, scanned }: { tableName?: string | null; scanned?: boolean }) {
  const s = useSettings();
  const { t } = useT();
  const { customer } = useCustomer();
  const menu = useQ<Menu>("/menu");
  const offers = useQ<{ offers: { id: string; name: string; description: string }[]; coupons: { code: string; kind: string; value: number; min_order: number }[] }>("/public/offers");
  const c = useCart();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("best");
  const [vegOnly, setVegOnly] = useState(false);
  const [picking, setPicking] = useState<MenuItem | null>(null);

  // A new café has no bestsellers yet: open on All instead of an empty filter.
  const hasBest = !!menu.data?.items.some((i) => i.bestseller);
  const view = cat === "best" && menu.data && !hasBest ? "all" : cat;
  const items = useMemo(() => {
    let list = menu.data?.items ?? [];
    if (vegOnly) list = list.filter((i) => i.food_type === "veg");
    if (q) list = list.filter((i) => `${i.name} ${i.name_hi ?? ""} ${i.description}`.toLowerCase().includes(q.toLowerCase()));
    else if (view === "best") list = list.filter((i) => i.bestseller);
    else if (view !== "all") list = list.filter((i) => i.category_id === view);
    return list;
  }, [menu.data, q, cat, vegOnly]);

  if (menu.isLoading) return <Loading label="Loading menu…" />;
  if (!menu.data) return <Empty title="Menu unavailable">Please try again in a moment.</Empty>;

  const add = (i: MenuItem) => (i.variants.length || i.add_on_groups.length ? setPicking(i) : cart.add(i));
  const count = cartCount(c);
  const now = new Date();
  const open = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const isOpen = open >= s.outlet.opening_time && open <= s.outlet.closing_time;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-3xl bg-fill pastel p-5 md:flex-row md:items-center md:p-8">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label>{isOpen ? `Open now · closes ${s.outlet.closing_time}` : `Closed · opens ${s.outlet.opening_time}`}</Label>
          {customer && <div className="text-sm">{t(greeting())}, {customer.name.split(" ")[0]} 👋</div>}
          <h1 className="font-disp text-3xl font-extrabold leading-tight md:text-4xl">{s.brand.hero_title || s.outlet.tagline}</h1>
          <p className="text-sm text-ink/80">{tableName ? `Table ${tableName} · Dine-in · Order from your phone, we'll bring it to you.` : s.brand.hero_subtitle}</p>
          {!scanned && <OrderTypeToggle className="mt-1 max-w-sm" />}
          {!tableName && s.flags.features.dine_in && !c.table_code && <p className="text-xs text-mute">At the café? Scan the QR on your table to order dine-in.</p>}
          {!!offers.data?.coupons.length && (
            <div className="scrollbar-none mt-1 flex gap-2 overflow-x-auto">
              {offers.data.coupons.slice(0, 3).map((cp) => (
                <span key={cp.code} className="shrink-0 rounded-lg border-[1.5px] border-dashed border-brand bg-paper px-3 py-1.5 text-xs">
                  <b className="num">{cp.code}</b> · {cp.kind === "pct" ? `${cp.value}% off` : `${formatINR(cp.value)} off`} above {formatINR(cp.min_order)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="img-ph hidden h-44 w-80 shrink-0 rounded-2xl border-[1.5px] border-line md:block" aria-hidden />
      </section>

      {!!offers.data?.offers.length && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {offers.data.offers.map((o) => (
            <Card key={o.id} className="shrink-0 px-3 py-2 text-sm">
              <b>{o.name}</b> · <span className="text-mute">{o.description}</span>
            </Card>
          ))}
        </div>
      )}

      <div className="sticky top-[58px] z-20 -mx-4 flex flex-col gap-2 bg-bg/95 px-4 py-2 backdrop-blur">
        <Input placeholder={t("Search menu…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search menu" />
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {hasBest && <Chip onClick={() => setCat("best")} active={view === "best" && !q}>⭐ {t("Bestsellers")}</Chip>}
          <Chip onClick={() => setCat("all")} active={view === "all" && !q}>All</Chip>
          {menu.data.categories.map((x) => (
            <Chip key={x.id} onClick={() => setCat(x.id)} active={cat === x.id && !q}>
              {x.name}
            </Chip>
          ))}
          <Chip onClick={() => setVegOnly((v) => !v)} active={vegOnly}><span aria-hidden className="mr-1 inline-block size-2.5 rounded-full bg-ok" />{t("Veg only")}</Chip>
        </div>
      </div>

      <div className="flex items-start gap-6">
        <div className="stagger grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <ItemCard key={i.id} item={i} qty={cart.qtyOf(c, i.id)} onAdd={() => add(i)} onMinus={() => {
              const line = [...c.lines].reverse().find((l) => l.item_id === i.id);
              if (line) cart.setQty(line.key, line.qty - 1);
            }} />
          ))}
          {!items.length && <div className="col-span-full"><Empty title="No dishes match">Try another search or category.</Empty></div>}
        </div>
        <aside className="sticky top-[140px] hidden w-72 shrink-0 lg:block">
          <MiniCart />
        </aside>
      </div>

      {count > 0 && (
        <Link href="/cart" className="anim-rise fixed inset-x-4 bottom-20 z-30 lg:hidden">
          <Button variant="primary" size="lg" block className="shadow-lg">
            <span key={count} className="anim-bump inline-block">{count} item{count > 1 ? "s" : ""}</span> · {formatINR(cartValue(c))} · {t("View cart")} →
          </Button>
        </Link>
      )}

      <ItemSheet item={picking} onClose={() => setPicking(null)} />
    </div>
  );
}

function ItemCard({ item: i, qty, onAdd, onMinus }: { item: MenuItem; qty: number; onAdd: () => void; onMinus: () => void }) {
  const { t } = useT();
  const unavailable = !i.available_now;
  const from = i.variants.length ? Math.min(...i.variants.map((v) => v.price)) : i.price;
  return (
    <Card className={cx("lift flex gap-3 p-3 sm:flex-col", unavailable && "opacity-55")}>
      {i.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={i.photo_url} alt={i.name} loading="lazy" className="size-24 shrink-0 rounded-xl object-cover sm:h-36 sm:w-full" />
      ) : (
        <div className="img-ph size-24 shrink-0 rounded-xl border-[1.5px] border-line sm:h-36 sm:w-full" aria-hidden />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <FoodMark type={i.food_type} />
          {i.bestseller && <span className="text-[11px] font-semibold text-warn">Bestseller</span>}
        </div>
        <b className="leading-tight">{i.name}</b>
        {i.description && <p className="line-clamp-2 text-xs text-mute">{i.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="num font-semibold">{i.variants.length ? `from ${formatINR(from)}` : formatINR(i.price)}</span>
          {unavailable ? (
            <span className="text-xs font-semibold text-rose">{!i.in_stock || !i.available_today ? t("Out of stock") : `From ${i.slot?.start_time}`}</span>
          ) : qty > 0 ? (
            <div className="flex items-center rounded-xl border-[1.5px] border-brand">
              <button className="min-h-10 w-10 cursor-pointer text-lg font-bold text-brand" onClick={onMinus} aria-label={`Remove one ${i.name}`}>−</button>
              <span className="num w-6 text-center font-semibold">{qty}</span>
              <button className="min-h-10 w-10 cursor-pointer text-lg font-bold text-brand" onClick={onAdd} aria-label={`Add one more ${i.name}`}>+</button>
            </div>
          ) : (
            <Button size="sm" onClick={onAdd} aria-label={`Add ${i.name}`}>{t("Add")}</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Pick size, add-ons and a note before adding to the cart. */
export function ItemSheet({ item, onClose, onAdd }: { item: MenuItem | null; onClose: () => void; onAdd?: (o: { variant_id: string | null; add_on_ids: string[]; note: string; qty: number }) => void }) {
  const [variant, setVariant] = useState<string | null>(null);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const [lastId, setLastId] = useState<string | null>(null);
  if (item && item.id !== lastId) {
    setLastId(item.id);
    setVariant(item.variants.find((v) => v.is_default)?.id ?? item.variants[0]?.id ?? null);
    setAddOns([]);
    setNote("");
    setQty(1);
  }
  if (!item) return null;
  const base = item.variants.find((v) => v.id === variant)?.price ?? item.price;
  const extra = item.add_on_groups.flatMap((g) => g.add_ons).filter((a) => addOns.includes(a.id)).reduce((s, a) => s + a.price, 0);
  const groupErr = item.add_on_groups.find((g) => addOns.filter((a) => g.add_ons.some((x) => x.id === a)).length < g.min_select);
  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      footer={
        <Button
          variant="primary"
          block
          disabled={!!groupErr}
          onClick={() => {
            const o = { variant_id: variant, add_on_ids: addOns, note, qty };
            if (onAdd) onAdd(o);
            else cart.add(item, o);
            onClose();
          }}
        >
          Add {qty} · {formatINR((base + extra) * qty)}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2"><FoodMark type={item.food_type} withLabel />{item.description && <span className="text-sm text-mute">{item.description}</span>}</div>
        {!!item.variants.length && (
          <div className="flex flex-col gap-2">
            <Label>Size</Label>
            {item.variants.map((v) => (
              <label key={v.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-line px-3">
                <input type="radio" name="variant" checked={variant === v.id} onChange={() => setVariant(v.id)} className="accent-[var(--brand)]" />
                <span className="flex-1">{v.name}</span>
                <Money value={v.price} />
              </label>
            ))}
          </div>
        )}
        {item.add_on_groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-2">
            <Label>{g.name} {g.max_select > 0 && <span className="normal-case tracking-normal">· up to {g.max_select}{g.min_select ? `, pick at least ${g.min_select}` : ""}</span>}</Label>
            {g.add_ons.map((a) => {
              const on = addOns.includes(a.id);
              const inGroup = addOns.filter((x) => g.add_ons.some((y) => y.id === x)).length;
              return (
                <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-line px-3">
                  <input type="checkbox" checked={on} disabled={!on && inGroup >= g.max_select} onChange={() => setAddOns((l) => (on ? l.filter((x) => x !== a.id) : [...l, a.id]))} className="accent-[var(--brand)]" />
                  <FoodMark type={a.food_type} />
                  <span className="flex-1">{a.name}</span>
                  <span className="num text-sm">{a.price ? `+${formatINR(a.price)}` : "Free"}</span>
                </label>
              );
            })}
          </div>
        ))}
        <label className="flex flex-col gap-1.5">
          <Label>Cooking note</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. less spicy, no onion" maxLength={120} />
        </label>
        <div className="flex items-center gap-3">
          <Label>Quantity</Label>
          <div className="flex items-center rounded-xl border-[1.5px] border-line">
            <button className="min-h-10 w-10 cursor-pointer text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">−</button>
            <span className="num w-8 text-center">{qty}</span>
            <button className="min-h-10 w-10 cursor-pointer text-lg" onClick={() => setQty((q) => q + 1)} aria-label="More">+</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function MiniCart() {
  const c = useCart();
  const { t } = useT();
  if (!c.lines.length) return <Card className="text-sm text-mute">{t("Your cart")} is empty. Add something tasty!</Card>;
  return (
    <Card className="flex flex-col gap-3">
      <b>{t("Your cart")}</b>
      {c.lines.map((l) => (
        <div key={l.key} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{l.name}{l.variant_name ? ` (${l.variant_name})` : ""} × {l.qty}</span>
          <Money value={l.unit_price * l.qty} />
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-line pt-2">
        <b>{t("Item total")}</b>
        <Money value={cartValue(c)} className="font-semibold" />
      </div>
      <Link href="/cart">
        <Button variant="primary" block>{t("Checkout")}</Button>
      </Link>
    </Card>
  );
}

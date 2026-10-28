"use client";

import Link from "next/link";
import { useState } from "react";
import { customersApi } from "@/modules/customers/api";
import { AddressModal } from "@/modules/customers/components/AddressModal";
import { get } from "@/shared/api/client";
import { useM, useQ } from "@/shared/api/hooks";
import { signOut, useCustomer } from "@/shared/auth/session";
import { fmtDate } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { Address, GiftCard, LoyaltyLedger, LoyaltySettings, Membership, MembershipPlan } from "@/shared/types/entities";
import { ConfirmButton } from "@/shared/ui/overlay";
import { Button, Card, Empty, Field, Input, Label, Loading, Stat, Toggle } from "@/shared/ui/primitives";

/** Profile (M1.8): details, saved addresses, loyalty balance, gift cards, membership, data rights (DPDP). */
export default function ProfilePage() {
  useTitle("Profile");
  const s = useSettings();
  const { customer, loading } = useCustomer();
  const wallet = useQ<{ points: number; loyalty: LoyaltySettings; ledger: LoyaltyLedger[]; gift_cards: GiftCard[]; memberships: (Membership & { plan?: MembershipPlan })[]; plans: MembershipPlan[] }>(customer ? "/me/wallet" : null, { auth: "customer" });
  const addresses = useQ<Address[]>(customer ? "/me/addresses" : null, { auth: "customer" });
  const [edit, setEdit] = useState<null | { name: string; birthday: string; anniversary: string; marketing_consent: boolean }>(null);
  const [addAddr, setAddAddr] = useState(false);
  const save = useM(() => customersApi.updateMe({ ...edit!, birthday: edit!.birthday || null, anniversary: edit!.anniversary || null }), { success: "Profile saved", onSuccess: () => setEdit(null) });
  const delAddr = useM((id: string) => customersApi.deleteAddress(id), { success: "Address removed" });
  const deleteMe = useM(() => customersApi.deleteMe(), { onSuccess: () => signOut("customer") });

  if (loading) return <Loading />;
  if (!customer) return <Empty title="Sign in to see your profile" action={<Link href="/login?next=/profile"><Button variant="primary">Sign in</Button></Link>} />;
  const active = wallet.data?.memberships.find((m) => m.status === "active");

  const exportData = async () => {
    const d = await get("/me/export", { auth: "customer" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
    a.download = `${s.tenant.slug}-my-data.json`;
    a.click();
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="font-disp text-2xl font-extrabold">Hi, {customer.name.split(" ")[0]}</h1>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => signOut("customer")}>Log out</Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Loyalty points" value={wallet.data?.points ?? customer.loyalty_points} sub={wallet.data ? `Worth ${formatINR((wallet.data.points ?? 0) * wallet.data.loyalty.point_value)} · 1 pt per ₹${wallet.data.loyalty.earn_per_rupees}` : undefined} />
        <Stat label="Membership" value={active ? active.plan?.name ?? "Active" : "None"} sub={active ? `Valid till ${fmtDate(active.ends_on)} · ${active.plan?.discount_pct}% off` : wallet.data?.plans[0] ? `${wallet.data.plans[0].name} · ${formatINR(wallet.data.plans[0].price)}` : undefined} />
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center"><Label>Your details</Label>{!edit && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit({ name: customer.name, birthday: customer.birthday ?? "", anniversary: customer.anniversary ?? "", marketing_consent: customer.marketing_consent })}>Edit</Button>}</div>
        {edit ? (
          <>
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Birthday"><Input type="date" value={edit.birthday} onChange={(e) => setEdit({ ...edit, birthday: e.target.value })} /></Field>
              <Field label="Anniversary"><Input type="date" value={edit.anniversary} onChange={(e) => setEdit({ ...edit, anniversary: e.target.value })} /></Field>
            </div>
            <Toggle checked={edit.marketing_consent} onChange={(v) => setEdit({ ...edit, marketing_consent: v })} label="Offers and birthday wishes on WhatsApp/SMS" />
            <div className="flex gap-2"><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></div>
          </>
        ) : (
          <div className="grid gap-1 text-sm">
            <div>{customer.name}</div>
            <div className="text-mute">{customer.phone ?? "No mobile"} {customer.phone_verified && "✓"} · {customer.email ?? ""}</div>
            <div className="text-mute">Birthday {fmtDate(customer.birthday)}{customer.anniversary ? ` · Anniversary ${fmtDate(customer.anniversary)}` : ""}</div>
            <div className="text-mute">Marketing messages: {customer.marketing_consent ? "On" : "Off"}</div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center"><Label>Saved addresses</Label><Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAddAddr(true)}>+ Add</Button></div>
        {addresses.data?.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1"><b>{a.label}</b> · {a.line1}, {a.city} {a.pincode}</span>
            <Button size="sm" variant="ghost" onClick={() => delAddr.mutate(a.id)}>Remove</Button>
          </div>
        ))}
        {!addresses.data?.length && <span className="text-sm text-mute">No saved addresses</span>}
      </Card>

      {!!wallet.data?.gift_cards.length && (
        <Card className="flex flex-col gap-2">
          <Label>Gift cards</Label>
          {wallet.data.gift_cards.map((g) => (
            <div key={g.id} className="flex justify-between text-sm"><span className="num">{g.code}</span><span>{formatINR(g.balance)} left · till {fmtDate(g.expires_on)}</span></div>
          ))}
        </Card>
      )}

      {!!wallet.data?.ledger.length && (
        <Card className="flex flex-col gap-1.5">
          <Label>Points history</Label>
          {wallet.data.ledger.slice(0, 8).map((l) => (
            <div key={l.id} className="flex justify-between text-sm"><span>{fmtDate(l.created_at)} · {l.reason}</span><span className={l.points > 0 ? "num text-ok" : "num text-rose"}>{l.points > 0 ? "+" : ""}{l.points}</span></div>
          ))}
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <Label>Your data</Label>
        <p className="text-sm text-mute">{s.outlet.name} keeps your data separately from every other café. You can download it or ask for it to be deleted. Bills are kept for tax records without your name.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={exportData}>Download my data</Button>
          <ConfirmButton variant="danger" size="sm" confirm="This removes your profile, addresses and points at this café. It can't be undone." onConfirm={async () => { await deleteMe.mutateAsync(undefined); }}>Delete my account</ConfirmButton>
        </div>
      </Card>
      <AddressModal open={addAddr} onClose={() => setAddAddr(false)} city={s.outlet.city} onSaved={() => {}} />
    </div>
  );
}

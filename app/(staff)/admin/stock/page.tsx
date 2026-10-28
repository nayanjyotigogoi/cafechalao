"use client";

import { useState } from "react";
import { inventoryApi } from "@/modules/inventory/api";
import { NewPOModal } from "@/modules/inventory/components/NewPOModal";
import { RecipeEditor } from "@/modules/inventory/components/RecipeEditor";
import { WastageModal } from "@/modules/inventory/components/WastageModal";
import { useM, useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { cx, fmtDate, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { UNITS } from "@/shared/lib/units";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Menu } from "@/shared/types/api";
import type { GRN, PurchaseOrder, PurchaseRequest, RawMaterial, StockCount, StockLedger, Supplier, SupplierPayment, Wastage } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormModal, type Values } from "@/shared/ui/form";
import { Modal, useToast } from "@/shared/ui/overlay";
import { Button, Card, Chip, ErrorText, Field, Input, Label, Loading, Money, MoneyInput, PageTitle, ProgressBar, Segmented, Select, Stat } from "@/shared/ui/primitives";

/** Stock and purchase (M5): every sale deducts ingredients by recipe; PR → approval → PO → GRN → payment. */
type Tab = "inventory" | "recipes" | "requests" | "pos" | "grn" | "suppliers" | "payables" | "wastage" | "count" | "ledger";

export default function StockAdmin() {
  useTitle("Stock & purchase");
  const { can } = useStaff();
  const [tab, setTab] = useState<Tab>("inventory");
  const [wastage, setWastage] = useState(false);
  const [newPO, setNewPO] = useState(false);
  const autoPO = useM(() => inventoryApi.autoPO(), { success: (r) => `${r.length} purchase order(s) created for approval` });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Stock & purchase" />
      <Segmented value={tab} onChange={setTab} options={[
        { value: "inventory", label: "Inventory" }, { value: "recipes", label: "Recipes" }, { value: "requests", label: "Purchase requests" }, { value: "pos", label: "Purchase orders" },
        { value: "grn", label: "Goods receipt" }, { value: "suppliers", label: "Suppliers" }, ...(can("stock.approve") ? [{ value: "payables" as Tab, label: "Payables" }] : []),
        { value: "wastage", label: "Wastage" }, { value: "count", label: "Stock count" }, { value: "ledger", label: "Ledger" },
      ]} />
      {tab === "inventory" && <Inventory onAutoPO={() => autoPO.mutate(undefined)} autoBusy={autoPO.isPending} />}
      {tab === "recipes" && <Recipes />}
      {tab === "requests" && <Requests />}
      {tab === "pos" && <POs onNew={can("stock.request") ? () => setNewPO(true) : undefined} />}
      {tab === "grn" && <GRNs />}
      {tab === "suppliers" && <Suppliers />}
      {tab === "payables" && <Payables />}
      {tab === "wastage" && <WastageList onRecord={() => setWastage(true)} />}
      {tab === "count" && <Count />}
      {tab === "ledger" && <Ledger />}
      <WastageModal open={wastage} onClose={() => setWastage(false)} />
      {newPO && <NewPOModal onClose={() => setNewPO(false)} />}
    </div>
  );
}

const useMats = () => useQ<RawMaterial[]>("/raw-materials", { auth: "staff" });
const useSuppliers = () => useQ<Supplier[]>("/suppliers", { auth: "staff" });

function Inventory({ onAutoPO, autoBusy }: { onAutoPO: () => void; autoBusy: boolean }) {
  const { can } = useStaff();
  const mats = useMats();
  const sup = useSuppliers();
  const summary = useQ<{ stock_value: number; low: number; out: number; total: number; open_pos: number; suggestion: { supplier: string; items: string[] }[] }>("/stock/summary", { auth: "staff" });
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [e, setE] = useState<Values | null>(null);
  const save = useM((v: Values) => inventoryApi.saveMaterial(v), { success: "Saved", onSuccess: () => setE(null) });
  const rows = (mats.data ?? []).filter((m) => filter === "all" || (filter === "low" ? m.stock > 0 && m.stock < m.min_level : m.stock <= 0));
  const s = summary.data;
  return (
    <>
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Stock value" value={formatINR(s.stock_value)} />
          <Stat label="Running low" value={s.low} tone={s.low ? "warn" : undefined} />
          <Stat label="Out of stock" value={s.out} tone={s.out ? "hot" : undefined} />
          <Stat label="Open POs" value={s.open_pos} />
        </div>
      )}
      {s && s.low + s.out > 0 && can("stock.request") && (
        <Card className="flex flex-wrap items-center gap-3 border-none bg-fill">
          <span className="flex-1 text-sm">💡 {s.low + s.out} items are low. Create one purchase order per supplier ({s.suggestion.map((x) => x.supplier).join(", ")})?</span>
          <Button variant="primary" loading={autoBusy} onClick={onAutoPO}>Auto-create POs</Button>
        </Card>
      )}
      <DataTable rows={rows} rowKey={(r) => r.id} search exportName="inventory" onRowClick={can("stock.receive") ? (r) => setE(r as unknown as Values) : undefined}
        toolbar={<>
          <Chip onClick={() => setFilter("all")} active={filter === "all"}>All {mats.data?.length}</Chip>
          <Chip tone="warn" onClick={() => setFilter("low")} active={filter === "low"}>Low {s?.low}</Chip>
          <Chip tone="hot" onClick={() => setFilter("out")} active={filter === "out"}>Out {s?.out}</Chip>
          {can("stock.receive") && <Button size="sm" variant="primary" onClick={() => setE({ unit: "kg", min_level: 0, stock: 0 })}>+ Ingredient</Button>}
        </>}
        columns={[
          { key: "name", header: "Ingredient", cell: (r) => <b>{r.name}</b> },
          { key: "category", header: "Category", hideSm: true },
          { key: "stock", header: "Stock level", value: (r) => r.stock, cell: (r) => {
            const pct = r.min_level ? (r.stock / (r.min_level * 2)) * 100 : 100;
            return <div className="flex min-w-40 items-center gap-2"><div className="flex-1"><ProgressBar value={pct} tone={r.stock <= 0 ? "hot" : r.stock < r.min_level ? "warn" : "ok"} /></div><span className={cx("num text-xs", r.stock <= 0 && "text-rose")}>{Math.round(r.stock * 100) / 100} / {r.min_level} {r.unit}</span></div>;
          } },
          { key: "avg_cost", header: "Unit cost", align: "right", value: (r) => r.avg_cost / 100, cell: (r) => <span className="num">{formatINR(r.avg_cost, { decimals: r.avg_cost % 100 !== 0 })}/{r.unit}</span> },
          { key: "supplier", header: "Supplier", value: (r) => sup.data?.find((x) => x.id === r.supplier_id)?.name ?? "—", hideSm: true },
          { key: "storage", header: "Storage", hideSm: true },
        ]} />
      <FormModal open={!!e} title={e?.id ? `Edit ${e.name}` : "New ingredient"} initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "category", label: "Category", type: "text" },
          { name: "unit", label: "Stock unit", type: "select", options: UNITS.map((u) => ({ value: u, label: u })), required: true },
          { name: "storage", label: "Storage location", type: "text" },
          { name: "min_level", label: "Minimum level (reorder alert)", type: "number" },
          ...(e?.id ? [] : [{ name: "stock", label: "Opening stock", type: "number" as const }]),
          { name: "avg_cost", label: "Cost per unit", type: "money" },
          { name: "supplier_id", label: "Usual supplier", type: "select", options: (sup.data ?? []).map((x) => ({ value: x.id, label: x.name })), empty: "None" },
        ]} />
    </>
  );
}

/** A recipe belongs to a menu item; the owner or manager (menu edit right) sets what one portion uses. */
function Recipes() {
  const { can } = useStaff();
  const menu = useQ<Menu>("/menu/manage", { auth: "staff" });
  const [item, setItem] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const edit = can("menu.edit");
  const all = menu.data?.items ?? [];
  const without = all.filter((i) => !i.recipe_cost).length;
  return (
    <>
      <p className="text-sm text-mute">
        A recipe says what one portion uses, e.g. 1 Masala Chai = 120 ml milk + 5 g tea + 10 g sugar. Each sale then takes those amounts out of stock and shows the food cost.
        {edit ? " Tap Add or Edit on a dish to set its recipe." : " The owner or manager sets recipes."} New dishes come from Admin → Menu; ingredients from the Inventory tab.
      </p>
      <DataTable rows={missing ? all.filter((i) => !i.recipe_cost) : all} rowKey={(r) => r.id} search onRowClick={edit ? (r) => setItem(r.id) : undefined}
        toolbar={<>
          <Chip onClick={() => setMissing(false)} active={!missing}>All {all.length}</Chip>
          <Chip tone="hot" onClick={() => setMissing(true)} active={missing}>No recipe {without}</Chip>
        </>}
        columns={[
          { key: "name", header: "Item", cell: (r) => <b>{r.name}</b> },
          { key: "price", header: "Price", align: "right", cell: (r) => <Money value={r.price} /> },
          { key: "recipe_cost", header: "Recipe cost", align: "right", value: (r) => r.recipe_cost ?? 0, cell: (r) => r.recipe_cost ? <Money value={r.recipe_cost} /> : <span className="text-rose">No recipe</span> },
          { key: "fc", header: "Food cost %", align: "right", value: (r) => (r.recipe_cost ? (r.recipe_cost / r.price) * 100 : 0), cell: (r) => r.recipe_cost ? <span className={cx("num", r.recipe_cost / r.price > 0.35 && "text-warn")}>{((r.recipe_cost / r.price) * 100).toFixed(1)}%</span> : "—" },
          ...(edit ? [{ key: "act", header: "", align: "right" as const, cell: (r: Menu["items"][number]) => <Button size="sm" variant={r.recipe_cost ? "outline" : "primary"} onClick={(e) => { e.stopPropagation(); setItem(r.id); }}>{r.recipe_cost ? "Edit" : "+ Add"}</Button> }] : []),
        ]} />
      {item && <RecipeEditor itemId={item} onClose={() => setItem(null)} />}
    </>
  );
}


function Requests() {
  const { can } = useStaff();
  const prs = useQ<PurchaseRequest[]>("/purchase-requests", { auth: "staff" });
  const mats = useMats();
  const [creating, setCreating] = useState(false);
  const [cmp, setCmp] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, number>>({});
  const create = useM(() => inventoryApi.request(Object.entries(lines).filter(([, q]) => q > 0).map(([id, qty]) => ({ raw_material_id: id, qty }))), { success: "Request sent for approval", onSuccess: () => { setCreating(false); setLines({}); } });
  return (
    <>
      <DataTable rows={prs.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setCmp(r.id)}
        toolbar={can("stock.request") && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>+ Purchase request</Button>}
        columns={[
          { key: "number", header: "Request", cell: (r) => <b>{r.number}</b> },
          { key: "created_at", header: "Date", value: (r) => fmtDate(r.created_at) },
          { key: "lines", header: "Items", value: (r) => r.lines.map((l) => mats.data?.find((m) => m.id === l.raw_material_id)?.name).join(", ") },
          { key: "estimated_value", header: "Estimate", align: "right", cell: (r) => <Money value={r.estimated_value} /> },
          { key: "status", header: "Status", cell: (r) => <Chip tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "hot" : r.status === "ordered" ? "info" : "warn"}>{label(r.status)}</Chip> },
        ]} />
      <Modal open={creating} onClose={() => setCreating(false)} title="New purchase request" footer={<Button variant="primary" loading={create.isPending} onClick={() => create.mutate(undefined)}>Send for approval</Button>}>
        <div className="flex flex-col gap-1">
          {mats.data?.map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-sm">
              <span className={cx("flex-1", m.stock < m.min_level && "font-semibold text-warn")}>{m.name} <span className="text-xs text-mute">({Math.round(m.stock * 100) / 100}/{m.min_level} {m.unit})</span></span>
              <Input type="number" className="w-24" placeholder="Qty" value={lines[m.id] ?? ""} onChange={(e) => setLines({ ...lines, [m.id]: Number(e.target.value) })} aria-label={`Quantity of ${m.name}`} />
              <span className="w-8 text-xs text-mute">{m.unit}</span>
            </div>
          ))}
          <ErrorText error={create.error} />
        </div>
      </Modal>
      {cmp && <Comparison id={cmp} onClose={() => setCmp(null)} />}
    </>
  );
}

/** Supplier quotations entered manually; lowest price, last price and price change % (M5.5). */
function Comparison({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useStaff();
  const toast = useToast();
  const d = useQ<{ request: PurchaseRequest; suppliers: { quotation_id: string; supplier_id: string; name: string }[]; rows: { raw_material_id: string; name: string; unit: string; qty: number; last_price: number; rates: { supplier_id: string; rate: number | null }[]; lowest_supplier_id: string | null; lowest_price: number | null; change_pct: number | null }[] }>(`/purchase-requests/${id}/comparison`, { auth: "staff" });
  const sup = useSuppliers();
  const [q, setQ] = useState<{ supplier_id: string; rates: Record<string, number> } | null>(null);
  const addQ = useM(() => inventoryApi.quotation({ supplier_id: q!.supplier_id, purchase_request_id: id, lines: Object.entries(q!.rates).map(([raw_material_id, rate]) => ({ raw_material_id, rate })) }), { success: "Quotation added", onSuccess: () => setQ(null) });
  const convert = useM(() => {
    const choice: Record<string, { supplier_id: string; rate: number }> = {};
    for (const r of d.data!.rows) if (r.lowest_supplier_id) choice[r.raw_material_id] = { supplier_id: r.lowest_supplier_id, rate: r.lowest_price! };
    return inventoryApi.convert(id, choice);
  }, { success: "Purchase orders created at the lowest prices", onSuccess: onClose });
  const decide = useQ<{ id: string; ref_id: string; status: string; can_decide: boolean }[]>(can("approvals.decide") ? "/approvals" : null, { auth: "staff", query: { status: "pending" } });
  const ap = decide.data?.find((a) => a.ref_id === id);
  const approve = useM((dec: "approve" | "reject") => inventoryApi.decide(ap!.id, dec), { success: "Done" });
  if (!d.data) return <Modal open onClose={onClose} title="Request"><Loading /></Modal>;
  const r = d.data;
  return (
    <Modal open onClose={onClose} title={`${r.request.number} · price comparison`} wide
      footer={<>
        {ap?.can_decide && <><Button variant="danger" onClick={() => approve.mutate("reject")}>Reject</Button><Button variant="primary" onClick={() => approve.mutate("approve")}>Approve request</Button></>}
        {r.request.status === "approved" && can("stock.approve") && <Button variant="primary" loading={convert.isPending} onClick={() => convert.mutate(undefined)}>Create POs at lowest prices</Button>}
        {r.request.status === "pending" && !ap?.can_decide && <span className="text-sm text-mute">Waiting for approval</span>}
      </>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-mute"><th className="p-2">Ingredient</th><th className="p-2">Qty</th><th className="p-2">Last price</th>{r.suppliers.map((s) => <th key={s.supplier_id} className="p-2">{s.name}</th>)}<th className="p-2">Lowest</th><th className="p-2">Change</th></tr></thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.raw_material_id} className="border-t border-line">
                <td className="p-2">{row.name}</td><td className="num p-2">{row.qty} {row.unit}</td><td className="num p-2">{formatINR(row.last_price)}</td>
                {row.rates.map((x) => <td key={x.supplier_id} className={cx("num p-2", x.supplier_id === row.lowest_supplier_id && "font-bold text-ok")}>{x.rate != null ? formatINR(x.rate) : "—"}</td>)}
                <td className="num p-2 font-semibold">{row.lowest_price != null ? formatINR(row.lowest_price) : "—"}</td>
                <td className={cx("num p-2", (row.change_pct ?? 0) > 0 ? "text-rose" : "text-ok")}>{row.change_pct != null ? `${row.change_pct > 0 ? "+" : ""}${row.change_pct.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border-[1.5px] border-line p-3">
          <Select value={q.supplier_id} onChange={(e) => setQ({ ...q, supplier_id: e.target.value })}>{sup.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          {r.rows.map((row) => <div key={row.raw_material_id} className="flex items-center gap-2 text-sm"><span className="flex-1">{row.name} (per {row.unit})</span><div className="w-32"><MoneyInput value={q.rates[row.raw_material_id] ?? null} onChange={(v) => setQ({ ...q, rates: { ...q.rates, [row.raw_material_id]: v } })} /></div></div>)}
          <Button variant="primary" loading={addQ.isPending} onClick={() => addQ.mutate(undefined)}>Save quotation</Button>
        </div>
      ) : can("stock.request") && <Button className="mt-3" variant="soft" onClick={() => sup.data?.[0] ? setQ({ supplier_id: sup.data[0].id, rates: {} }) : toast("Add a supplier first", "err")}>+ Enter a supplier quotation</Button>}
    </Modal>
  );
}

type PODetail = PurchaseOrder & { supplier?: Supplier; lines: { id: string; raw_material_id: string; name?: string; unit?: string; qty: number; rate: number; received_qty: number }[]; grns: GRN[] };

function POs({ onNew }: { onNew?: () => void }) {
  const { can } = useStaff();
  const pos = useQ<PODetail[]>("/purchase-orders", { auth: "staff" });
  const [receive, setReceive] = useState<PODetail | null>(null);
  const [print, setPrint] = useState<PODetail | null>(null);
  const send = useM((id: string) => inventoryApi.sendPO(id), { onSuccess: (r) => window.open(r.whatsapp_url, "_blank", "noopener") });
  return (
    <>
      <DataTable rows={pos.data ?? []} rowKey={(r) => r.id}
        toolbar={onNew && <Button size="sm" variant="primary" onClick={onNew}>+ New purchase order</Button>}
        columns={[
          { key: "number", header: "PO", cell: (r) => <b>{r.number}</b> },
          { key: "supplier", header: "Supplier", value: (r) => r.supplier?.name },
          { key: "lines", header: "Items", value: (r) => r.lines.map((l) => `${l.name} ${l.qty}${l.unit}`).join(", "), hideSm: true },
          { key: "total", header: "Total", align: "right", cell: (r) => <Money value={r.total} /> },
          { key: "expected_on", header: "Expected", value: (r) => fmtDate(r.expected_on), hideSm: true },
          { key: "status", header: "Status", cell: (r) => <Chip tone={r.status === "received" ? "ok" : r.status === "pending" ? "warn" : r.status === "rejected" ? "hot" : "info"}>{label(r.status)}</Chip> },
          { key: "act", header: "", cell: (r) => (
            <div className="flex gap-1">
              {["approved", "sent"].includes(r.status) && <Button size="sm" onClick={() => send.mutate(r.id)}>WhatsApp</Button>}
              <Button size="sm" variant="ghost" onClick={() => setPrint(r)}>PDF</Button>
              {["approved", "sent", "partially_received"].includes(r.status) && can("stock.receive") && <Button size="sm" variant="primary" onClick={() => setReceive(r)}>Receive</Button>}
            </div>
          ) },
        ]} />
      {receive && <Receive po={receive} onClose={() => setReceive(null)} />}
      {print && (
        <Modal open onClose={() => setPrint(null)} title={print.number} footer={<Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>}>
          <div className="print-receipt flex flex-col gap-1 text-sm">
            <b>Purchase order {print.number}</b><span>To: {print.supplier?.name} {print.supplier?.gstin ? `· GSTIN ${print.supplier.gstin}` : ""}</span><span>Deliver by {fmtDate(print.expected_on)}</span>
            {print.lines.map((l) => <div key={l.id} className="flex justify-between"><span>{l.name} × {l.qty} {l.unit} @ {formatINR(l.rate)}</span><span className="num">{formatINR(l.qty * l.rate)}</span></div>)}
            <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="num">{formatINR(print.total)}</span></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Goods receipt against a PO (M5.6): received qty, rate, optional batch/expiry, shortfall. */
function Receive({ po, onClose }: { po: PODetail; onClose: () => void }) {
  const [inv, setInv] = useState("");
  const [lines, setLines] = useState(po.lines.map((l) => ({ po_line_id: l.id, received_qty: Math.max(0, l.qty - l.received_qty), rate: l.rate, batch: "", expiry: "" })));
  const save = useM(() => inventoryApi.grn({ purchase_order_id: po.id, invoice_ref: inv, lines }), { success: "Goods received. Stock and supplier ledger updated.", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Receive ${po.number}`} wide footer={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save goods receipt</Button>}>
      <div className="flex flex-col gap-2">
        <Field label="Supplier invoice no."><Input value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
        {po.lines.map((l, i) => (
          <div key={l.id} className="grid grid-cols-2 items-end gap-2 border-t border-line pt-2 text-sm sm:grid-cols-5">
            <span className="col-span-2 sm:col-span-1">{l.name}<span className="block text-xs text-mute">Ordered {l.qty} {l.unit}, got {l.received_qty}</span></span>
            <Field label="Received"><Input type="number" value={lines[i].received_qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, received_qty: Number(e.target.value) } : x)))} /></Field>
            <Field label="Rate"><MoneyInput value={lines[i].rate} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: v } : x)))} /></Field>
            <Field label="Batch"><Input value={lines[i].batch} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, batch: e.target.value } : x)))} /></Field>
            <Field label="Expiry"><Input type="date" value={lines[i].expiry} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, expiry: e.target.value } : x)))} /></Field>
          </div>
        ))}
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

function GRNs() {
  const g = useQ<(GRN & { supplier?: string; lines: { raw_material_id: string; received_qty: number; shortfall: number }[] })[]>("/grns", { auth: "staff" });
  const mats = useMats();
  return <DataTable rows={g.data ?? []} rowKey={(r) => r.id} exportName="goods-receipts" columns={[
    { key: "number", header: "GRN", cell: (r) => <b>{r.number}</b> }, { key: "received_on", header: "Date", value: (r) => fmtDate(r.received_on) }, { key: "supplier", header: "Supplier" },
    { key: "lines", header: "Items", value: (r) => r.lines.map((l) => `${mats.data?.find((m) => m.id === l.raw_material_id)?.name} ${l.received_qty}${l.shortfall ? ` (short ${l.shortfall})` : ""}`).join(", ") },
    { key: "invoice_ref", header: "Invoice", hideSm: true }, { key: "total", header: "Total", align: "right", cell: (r) => <Money value={r.total} /> },
  ]} />;
}

function Suppliers() {
  const { can } = useStaff();
  const sup = useSuppliers();
  const [e, setE] = useState<Values | null>(null);
  const save = useM((v: Values) => inventoryApi.saveSupplier(v), { success: "Supplier saved", onSuccess: () => setE(null) });
  return (
    <>
      <DataTable rows={sup.data ?? []} rowKey={(r) => r.id} search onRowClick={can("stock.approve") ? (r) => setE(r as unknown as Values) : undefined} toolbar={can("stock.approve") && <Button size="sm" variant="primary" onClick={() => setE({ payment_terms_days: 15 })}>+ Supplier</Button>}
        columns={[{ key: "name", header: "Supplier", cell: (r) => <b>{r.name}</b> }, { key: "contact_person", header: "Contact" }, { key: "phone", header: "Phone" }, { key: "gstin", header: "GSTIN", value: (r) => r.gstin ?? "—", hideSm: true }, { key: "items_supplied", header: "Supplies", hideSm: true }, { key: "payment_terms_days", header: "Terms", value: (r) => `${r.payment_terms_days} days` }, { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => <Money value={r.outstanding} /> }]} />
      <FormModal open={!!e} title="Supplier" initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "contact_person", label: "Contact person", type: "text" }, { name: "phone", label: "Phone", type: "tel", required: true }, { name: "email", label: "Email", type: "email" }, { name: "gstin", label: "GSTIN", type: "text" }, { name: "payment_terms_days", label: "Payment terms (days)", type: "number" }, { name: "items_supplied", label: "Items supplied", type: "textarea" }]} />
    </>
  );
}

function Payables() {
  const age = useQ<{ supplier_id: string; name: string; outstanding: number; terms: number; buckets: Record<string, number> }[]>("/payables/ageing", { auth: "staff" });
  const pays = useQ<SupplierPayment[]>("/supplier-payments", { auth: "staff" });
  const [pay, setPay] = useState<Values | null>(null);
  const save = useM((v: Values) => inventoryApi.paySupplier(v as never), { success: "Payment recorded", onSuccess: () => setPay(null) });
  return (
    <>
      <DataTable rows={age.data ?? []} rowKey={(r) => r.supplier_id} exportName="payables"
        columns={[{ key: "name", header: "Supplier", cell: (r) => <b>{r.name}</b> }, ...["0-15", "16-30", "31-60", "60+"].map((k) => ({ key: k, header: `${k} days`, align: "right" as const, value: (r: { buckets: Record<string, number> }) => r.buckets[k] / 100, cell: (r: { buckets: Record<string, number> }) => <Money value={r.buckets[k]} className={k === "60+" && r.buckets[k] ? "text-rose" : ""} /> })), { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => <Money value={r.outstanding} className="font-semibold" /> }, { key: "act", header: "", cell: (r) => <Button size="sm" onClick={() => setPay({ supplier_id: r.supplier_id, amount: r.outstanding, mode: "upi" })}>Pay</Button> }]} />
      <Label>Payments made</Label>
      <DataTable rows={pays.data ?? []} rowKey={(r) => r.id} dense columns={[{ key: "paid_on", header: "Date", value: (r) => fmtDate(r.paid_on) }, { key: "supplier", header: "Supplier", value: (r) => age.data?.find((a) => a.supplier_id === r.supplier_id)?.name }, { key: "mode", header: "Mode" }, { key: "reference", header: "Ref" }, { key: "amount", header: "Amount", align: "right", cell: (r) => <Money value={r.amount} /> }]} />
      <FormModal open={!!pay} title="Record supplier payment" initial={pay} onClose={() => setPay(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
        fields={[{ name: "amount", label: "Amount", type: "money", required: true }, { name: "mode", label: "Mode", type: "select", options: ["cash", "upi", "bank", "cheque"].map((x) => ({ value: x, label: x.toUpperCase() })), required: true }, { name: "reference", label: "Reference", type: "text" }]} />
    </>
  );
}

function WastageList({ onRecord }: { onRecord: () => void }) {
  const w = useQ<Wastage[]>("/wastage", { auth: "staff" });
  const mats = useMats();
  return <DataTable rows={w.data ?? []} rowKey={(r) => r.id} exportName="wastage" toolbar={<Button size="sm" variant="primary" onClick={onRecord}>Record wastage</Button>} columns={[
    { key: "created_at", header: "Date", value: (r) => fmtDate(r.created_at) }, { key: "what", header: "What", value: (r) => mats.data?.find((m) => m.id === r.raw_material_id)?.name ?? "Menu item" },
    { key: "qty", header: "Qty", value: (r) => `${r.qty} ${r.unit}` }, { key: "reason", header: "Reason", value: (r) => label(r.reason) }, { key: "note", header: "Note" }, { key: "value", header: "Value", align: "right", cell: (r) => <Money value={r.value} /> },
  ]} />;
}

/** Physical stock count with variance (M5.9). */
function Count() {
  const mats = useMats();
  const counts = useQ<StockCount[]>("/stock-counts", { auth: "staff" });
  const [c, setC] = useState<Record<string, string>>({});
  const save = useM((post: boolean) => inventoryApi.stockCount(Object.entries(c).filter(([, v]) => v !== "").map(([id, v]) => ({ raw_material_id: id, counted_qty: Number(v) })), post), { success: "Count saved", onSuccess: () => setC({}) });
  return (
    <>
      <Card className="flex flex-col gap-1 p-0">
        <div className="grid grid-cols-[1fr_6rem_6rem_6rem] gap-2 px-4 py-2 text-xs font-semibold uppercase text-mute"><span>Ingredient</span><span>System</span><span>Counted</span><span>Variance</span></div>
        {mats.data?.map((m) => {
          const v = c[m.id];
          const diff = v ? Number(v) - m.stock : null;
          return (
            <div key={m.id} className="grid grid-cols-[1fr_6rem_6rem_6rem] items-center gap-2 border-t border-line px-4 py-1.5 text-sm">
              <span>{m.name}</span><span className="num">{Math.round(m.stock * 100) / 100} {m.unit}</span>
              <Input className="min-h-9" inputMode="decimal" value={v ?? ""} onChange={(e) => setC({ ...c, [m.id]: e.target.value })} aria-label={`Counted ${m.name}`} />
              <span className={cx("num", diff && diff < 0 ? "text-rose" : diff ? "text-ok" : "")}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff * 100) / 100} (${formatINR(Math.round(diff * m.avg_cost))})`}</span>
            </div>
          );
        })}
      </Card>
      <div className="flex gap-2"><Button onClick={() => save.mutate(false)} disabled={!Object.keys(c).length}>Save draft</Button><Button variant="primary" onClick={() => save.mutate(true)} loading={save.isPending} disabled={!Object.keys(c).length}>Post count and adjust stock</Button></div>
      <Label>Past counts</Label>
      <DataTable rows={counts.data ?? []} rowKey={(r) => r.id} dense columns={[{ key: "counted_on", header: "Date", value: (r) => fmtDate(r.counted_on) }, { key: "lines", header: "Items", value: (r) => r.lines.length }, { key: "variance", header: "Items with variance", value: (r) => r.lines.filter((l) => l.counted_qty !== l.system_qty).length }, { key: "status", header: "Status", value: (r) => label(r.status) }]} />
    </>
  );
}

function Ledger() {
  const mats = useMats();
  const [m, setM] = useState("");
  const l = useQ<StockLedger[]>("/stock/ledger", { auth: "staff", query: { raw_material_id: m } });
  return (
    <>
      <Select className="max-w-xs" value={m} onChange={(e) => setM(e.target.value)} aria-label="Ingredient"><option value="">All ingredients</option>{mats.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
      <DataTable rows={l.data ?? []} rowKey={(r) => r.id} exportName="stock-ledger" dense columns={[
        { key: "created_at", header: "When", value: (r) => fmtDate(r.created_at) }, { key: "material", header: "Ingredient", value: (r) => mats.data?.find((x) => x.id === r.raw_material_id)?.name },
        { key: "reason", header: "Reason", value: (r) => label(r.reason) }, { key: "qty", header: "Change", align: "right", value: (r) => Math.round(r.qty * 1000) / 1000, cell: (r) => <span className={cx("num", r.qty < 0 ? "text-rose" : "text-ok")}>{r.qty > 0 ? "+" : ""}{Math.round(r.qty * 1000) / 1000}</span> },
        { key: "balance_after", header: "Balance", align: "right", value: (r) => Math.round(r.balance_after * 1000) / 1000 },
      ]} />
    </>
  );
}

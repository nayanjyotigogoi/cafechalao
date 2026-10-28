"use client";

import { RecipeEditor } from "@/modules/inventory/components/RecipeEditor";
import { useState } from "react";
import { menuApi, type ItemBody } from "@/modules/menu/api";
import { useM, useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { cx, downloadCSV, label } from "@/shared/lib/format";
import { compressImage } from "@/shared/lib/image";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { Menu, MenuItem } from "@/shared/types/api";
import type { AddOnGroup, Category } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormModal } from "@/shared/ui/form";
import { ConfirmButton, Modal, useToast } from "@/shared/ui/overlay";
import { Button, Card, Chip, ErrorText, Field, FoodMark, Input, Label, Loading, MoneyInput, PageTitle, Segmented, Select, Textarea, Toggle } from "@/shared/ui/primitives";

/** Menu management (M1.3, M2.2.1): items with photos, variants, add-ons, time slots, daily availability, import. */
export default function MenuAdmin() {
  useTitle("Menu");
  const [tab, setTab] = useState<"items" | "categories" | "addons" | "slots" | "import">("items");
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Menu" sub="What customers see in the app, on the QR menu and at the POS." />
      <Segmented value={tab} onChange={setTab} options={[{ value: "items", label: "Items" }, { value: "categories", label: "Categories" }, { value: "addons", label: "Add-ons" }, { value: "slots", label: "Time slots" }, { value: "import", label: "Import" }]} />
      {tab === "items" && <Items />}
      {tab === "categories" && <Categories />}
      {tab === "addons" && <AddOns />}
      {tab === "slots" && <Slots />}
      {tab === "import" && <Import />}
    </div>
  );
}

function Items() {
  const menu = useQ<Menu>("/menu/manage", { auth: "staff" });
  const [cat, setCat] = useState("all");
  const [edit, setEdit] = useState<MenuItem | "new" | null>(null);
  const avail = useM(({ id, b }: { id: string; b: { in_stock?: boolean; available_today?: boolean } }) => menuApi.availability(id, b));
  const reset = useM(() => menuApi.resetAvailability(), { success: "All items available today" });
  if (!menu.data) return <Loading />;
  const rows = menu.data.items.filter((i) => cat === "all" || i.category_id === cat);
  return (
    <>
      <DataTable rows={rows} rowKey={(r) => r.id} search exportName="menu" onRowClick={(r) => setEdit(r)}
        toolbar={<>
          <Select className="w-44" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="all">All categories</option>{menu.data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Button size="sm" onClick={() => reset.mutate(undefined)}>Make all available today</Button>
          <Button size="sm" variant="primary" onClick={() => setEdit("new")}>+ Item</Button>
        </>}
        columns={[
          { key: "code", header: "Code", cell: (r) => <span className="num text-mute">{r.code}</span> },
          { key: "name", header: "Item", cell: (r) => <span className="flex items-center gap-2"><FoodMark type={r.food_type} />{r.photo_url ? <img src={r.photo_url} alt="" className="size-8 rounded object-cover" /> : null}<b>{r.name}</b>{r.bestseller && <Chip tone="warn">Best</Chip>}</span> },
          { key: "category", header: "Category", value: (r) => menu.data!.categories.find((c) => c.id === r.category_id)?.name, hideSm: true },
          { key: "price", header: "Price", align: "right", value: (r) => r.price / 100, cell: (r) => <span className="num">{r.variants.length ? r.variants.map((v) => formatINR(v.price)).join(" / ") : formatINR(r.price)}</span> },
          { key: "recipe_cost", header: "Food cost", align: "right", hideSm: true, value: (r) => r.recipe_cost ?? 0, cell: (r) => r.recipe_cost ? <span className={cx("num", r.recipe_cost / r.price > 0.35 ? "text-warn" : "")}>{formatINR(r.recipe_cost)} · {((r.recipe_cost / r.price) * 100).toFixed(0)}%</span> : <span className="text-mute">no recipe</span> },
          { key: "in_stock", header: "In stock", value: (r) => (r.in_stock ? "yes" : "no"), cell: (r) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={r.in_stock} onChange={(v) => avail.mutate({ id: r.id, b: { in_stock: v } })} /></span> },
          { key: "available_today", header: "Today", value: (r) => (r.available_today ? "yes" : "no"), cell: (r) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={r.available_today} onChange={(v) => avail.mutate({ id: r.id, b: { available_today: v } })} /></span> },
        ]} />
      {edit && <ItemEditor item={edit === "new" ? null : edit} menu={menu.data} onClose={() => setEdit(null)} />}
    </>
  );
}

function ItemEditor({ item, menu, onClose }: { item: MenuItem | null; menu: Menu; onClose: () => void }) {
  const s = useSettings();
  const { can } = useStaff();
  const toast = useToast();
  const groups = useQ<AddOnGroup[]>("/add-on-groups", { auth: "staff" });
  const [f, setF] = useState<ItemBody>(item ? { ...item, variants: item.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, is_default: v.is_default })) } : { name: "", code: "", category_id: menu.categories[0]?.id, food_type: "veg", price: 0, description: "", bestseller: false, prep_minutes: 8, add_on_group_ids: [], variants: [], gst_rate: null, availability_slot_id: null, photo_url: null, name_hi: null });
  // A new dish goes straight on to its recipe once saved (stock deduction and food cost need it).
  const [recipeFor, setRecipeFor] = useState<string | null>(null);
  const save = useM(() => menuApi.saveItem(f), { success: "Item saved", onSuccess: (x) => (!item && can("menu.edit") ? setRecipeFor(x.id) : onClose()) });
  const del = useM(() => menuApi.deleteItem(item!.id), { success: "Item removed", onSuccess: onClose });
  const priceLocked = !!item && !can("menu.price");
  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.name}` : "New item"} wide
      footer={<>{item && <ConfirmButton variant="danger" confirm={`Remove ${item.name} from the menu? Old bills keep it.`} onConfirm={async () => { await del.mutateAsync(undefined); }}>Remove</ConfirmButton>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Name in Hindi (optional)"><Input value={f.name_hi ?? ""} onChange={(e) => setF({ ...f, name_hi: e.target.value || null })} /></Field>
          <Field label="Category"><Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>{menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Item code (POS keypad)"><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Type"><Select value={f.food_type} onChange={(e) => setF({ ...f, food_type: e.target.value as MenuItem["food_type"] })}><option value="veg">Veg</option><option value="non_veg">Non-veg</option><option value="egg">Egg</option></Select></Field>
          <Field label="Price (ex-GST)" hint={priceLocked ? "Only the owner can change prices" : "Changes are logged; old bills keep their price"}><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} disabled={priceLocked} /></Field>
          <Field label="GST rate" hint={`Blank = café default ${s.tax.default_gst_rate}%`}><Select value={f.gst_rate == null ? "" : String(f.gst_rate)} onChange={(e) => setF({ ...f, gst_rate: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Default</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option></Select></Field>
          <Field label="Prep time (min)"><Input type="number" value={f.prep_minutes ?? 8} onChange={(e) => setF({ ...f, prep_minutes: Number(e.target.value) })} /></Field>
          <Field label="Available during" className="sm:col-span-2"><Select value={f.availability_slot_id ?? ""} onChange={(e) => setF({ ...f, availability_slot_id: e.target.value || null })}><option value="">All day</option>{menu.slots.map((sl) => <option key={sl.id} value={sl.id}>{sl.name} ({sl.start_time}–{sl.end_time})</option>)}</Select></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Toggle checked={!!f.bestseller} onChange={(v) => setF({ ...f, bestseller: v })} label="Bestseller badge" /></div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Sizes / variants</Label>
            {f.variants?.map((v, i) => (
              <div key={i} className="flex gap-2">
                <Input value={v.name} placeholder="Regular" onChange={(e) => setF({ ...f, variants: f.variants!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <MoneyInput value={v.price} onChange={(p) => setF({ ...f, variants: f.variants!.map((x, j) => (j === i ? { ...x, price: p } : x)) })} disabled={priceLocked} />
                <Button variant="ghost" onClick={() => setF({ ...f, variants: f.variants!.filter((_, j) => j !== i) })} aria-label="Remove size">×</Button>
              </div>
            ))}
            <Button size="sm" variant="soft" onClick={() => setF({ ...f, variants: [...(f.variants ?? []), { name: "", price: f.price ?? 0 }] })}>+ Size</Button>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Recipe (stock and food cost)</Label>
            {item ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1">{item.recipe_cost ? <>One portion costs <b className="num">{formatINR(item.recipe_cost)}</b> · {Math.round((item.recipe_cost / item.price) * 100)}% of price</> : <span className="text-rose">No recipe yet: sales won&apos;t reduce stock.</span>}</span>
                <Button size="sm" variant={item.recipe_cost ? "outline" : "primary"} onClick={() => setRecipeFor(item.id)}>{item.recipe_cost ? "Edit recipe" : "+ Add recipe"}</Button>
              </div>
            ) : <p className="text-sm text-mute">Save the dish, then add what one portion uses (e.g. 120 ml milk + 5 g tea). The recipe opens right after saving.</p>}
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Add-on groups</Label>
            <div className="flex flex-wrap gap-2">{groups.data?.map((g) => {
              const on = f.add_on_group_ids?.includes(g.id);
              return <Chip key={g.id} onClick={() => setF({ ...f, add_on_group_ids: on ? f.add_on_group_ids!.filter((x) => x !== g.id) : [...(f.add_on_group_ids ?? []), g.id] })} active={on}>{g.name}</Chip>;
            })}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Photo</Label>
          {f.photo_url ? <img src={f.photo_url} alt="" className="aspect-square w-full rounded-xl object-cover" /> : <div className="img-ph grid aspect-square w-full place-items-center rounded-xl border-[1.5px] border-line text-xs text-mute">No photo</div>}
          <input type="file" accept="image/*" className="text-xs" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const url = await compressImage(file);
            setF({ ...f, photo_url: url });
            toast(`Photo compressed to WebP (${Math.round((url.length * 3) / 4 / 1024)} KB)`, "info");
          }} />
          {f.photo_url && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, photo_url: null })}>Remove photo</Button>}
          <p className="text-[11px] text-mute">Real photos of your dishes. Auto-compressed to WebP, max ~200 KB.</p>
        </div>
      </div>
      <ErrorText error={save.error} />
      {recipeFor && <RecipeEditor itemId={recipeFor} onClose={() => (item ? setRecipeFor(null) : onClose())} />}
    </Modal>
  );
}

function Categories() {
  const menu = useQ<Menu>("/menu/manage", { auth: "staff" });
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const save = useM((v: Partial<Category>) => menuApi.saveCategory(v as { id?: string }), { success: "Saved", onSuccess: () => setEdit(null) });
  return (
    <>
      <DataTable rows={menu.data?.categories ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit(r)} toolbar={<Button size="sm" variant="primary" onClick={() => setEdit({ name: "", station: "kitchen", sort: 99, active: true })}>+ Category</Button>}
        columns={[
          { key: "sort", header: "#" },
          { key: "name", header: "Category", cell: (r) => <b>{r.name}{r.name_hi ? <span className="ml-2 font-normal text-mute">{r.name_hi}</span> : null}</b> },
          { key: "station", header: "Kitchen station", value: (r) => label(r.station) },
          { key: "items", header: "Items", value: (r) => menu.data!.items.filter((i) => i.category_id === r.id).length },
          { key: "active", header: "Shown", value: (r) => (r.active ? "Yes" : "Hidden") },
        ]} />
      <FormModal open={!!edit} title={edit?.id ? "Edit category" : "New category"} initial={edit} onClose={() => setEdit(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "name_hi", label: "Name in Hindi", type: "text" },
          { name: "station", label: "Station (KOT goes to)", type: "select", options: [{ value: "kitchen", label: "Kitchen" }, { value: "bar", label: "Bar / beverages" }, { value: "dessert", label: "Dessert" }], required: true },
          { name: "sort", label: "Order", type: "number" },
          { name: "active", label: "Show on menu", type: "toggle" },
        ]} />
    </>
  );
}

function AddOns() {
  const menu = useQ<Menu>("/menu/manage", { auth: "staff" });
  const groups = useQ<AddOnGroup[]>("/add-on-groups", { auth: "staff" });
  const addOns = useQ<{ id: string; group_id: string; name: string; price: number; food_type: string }[]>("/add-ons", { auth: "staff" });
  const [g, setG] = useState<Partial<AddOnGroup> | null>(null);
  const [a, setA] = useState<Record<string, unknown> | null>(null);
  const saveG = useM((v: Record<string, unknown>) => menuApi.saveGroup(v), { success: "Saved", onSuccess: () => setG(null) });
  const saveA = useM((v: Record<string, unknown>) => menuApi.saveAddOn(v), { success: "Saved", onSuccess: () => setA(null) });
  const delA = useM((id: string) => menuApi.deleteAddOn(id));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.data?.map((gr) => (
        <Card key={gr.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2"><b className="flex-1">{gr.name}</b><span className="text-xs text-mute">pick {gr.min_select}–{gr.max_select}</span><Button size="sm" variant="ghost" onClick={() => setG(gr)}>Edit</Button></div>
          {addOns.data?.filter((x) => x.group_id === gr.id).map((x) => (
            <div key={x.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{x.name}</span><span className="num">{formatINR(x.price)}</span><button className="cursor-pointer text-mute" onClick={() => setA(x)}>Edit</button><button className="cursor-pointer text-rose" onClick={() => delA.mutate(x.id)}>×</button></div>
          ))}
          <Button size="sm" variant="soft" onClick={() => setA({ group_id: gr.id, name: "", price: 0, food_type: "veg" })}>+ Add-on</Button>
          <span className="text-[11px] text-mute">Used on: {menu.data?.items.filter((i) => i.add_on_group_ids.includes(gr.id)).map((i) => i.name).join(", ") || "no items yet"}</span>
        </Card>
      ))}
      <Button variant="primary" onClick={() => setG({ name: "", min_select: 0, max_select: 2 })}>+ Add-on group</Button>
      <FormModal open={!!g} title="Add-on group" initial={g} onClose={() => setG(null)} onSave={(v) => saveG.mutate(v)} saving={saveG.isPending}
        fields={[{ name: "name", label: "Group name", type: "text", required: true }, { name: "min_select", label: "Must pick at least", type: "number", min: 0 }, { name: "max_select", label: "Can pick up to", type: "number", min: 1 }]} />
      <FormModal open={!!a} title="Add-on" initial={a} onClose={() => setA(null)} onSave={(v) => saveA.mutate(v)} saving={saveA.isPending}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "price", label: "Extra price", type: "money" }, { name: "food_type", label: "Type", type: "select", options: [{ value: "veg", label: "Veg" }, { value: "non_veg", label: "Non-veg" }, { value: "egg", label: "Egg" }] }]} />
    </div>
  );
}

function Slots() {
  const menu = useQ<Menu>("/menu/manage", { auth: "staff" });
  const [e, setE] = useState<Record<string, unknown> | null>(null);
  const save = useM((v: Record<string, unknown>) => menuApi.saveSlot(v), { success: "Saved", onSuccess: () => setE(null) });
  return (
    <>
      <DataTable rows={menu.data?.slots ?? []} rowKey={(r) => r.id} onRowClick={(r) => setE(r as unknown as Record<string, unknown>)} toolbar={<Button size="sm" variant="primary" onClick={() => setE({ name: "", start_time: "08:00", end_time: "11:30" })}>+ Time slot</Button>}
        columns={[{ key: "name", header: "Slot" }, { key: "start_time", header: "From" }, { key: "end_time", header: "To" }, { key: "items", header: "Items", value: (r) => menu.data!.items.filter((i) => i.availability_slot_id === r.id).map((i) => i.name).join(", ") || "—" }]} />
      <FormModal open={!!e} title="Time slot" initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "start_time", label: "From", type: "time", required: true }, { name: "end_time", label: "To", type: "time", required: true }]} />
    </>
  );
}

/** Menu import from Excel (save as CSV) or pasted rows. Every row is checked; nothing is saved unless all pass. */
function Import() {
  const [text, setText] = useState("");
  const rows = parseCSV(text);
  const run = useM(() => menuApi.import(rows), { success: (r) => `${r.created} items imported` });
  const errors = run.error?.fields;
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm">Columns: <span className="num">name, category, price, type (veg / non-veg / egg), code, description</span>. In Excel use File → Save As → CSV, then choose the file or paste below.</p>
      <div className="flex flex-wrap gap-2">
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <Button size="sm" onClick={() => downloadCSV("menu-template", [{ name: "Masala Chai", category: "Chai", price: "40", type: "veg", code: "101", description: "Assam CTC with spices" }])}>Download template</Button>
      </div>
      <Textarea className="num min-h-40 text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"name,category,price,type\nMasala Chai,Chai,40,veg"} />
      {rows.length > 0 && <p className="text-sm text-mute">{rows.length} rows ready.</p>}
      {errors && <div className="rounded-xl border border-rose/40 bg-rose/10 p-3 text-sm text-rose">{run.error?.message}<ul className="list-disc pl-5">{Object.values(errors).slice(0, 10).map((m) => <li key={m}>{m}</li>)}</ul></div>}
      <Button variant="primary" disabled={!rows.length} loading={run.isPending} onClick={() => run.mutate(undefined)}>Import {rows.length} items</Button>
    </Card>
  );
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const head = split(lines[0].replace(/^﻿/, "")).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

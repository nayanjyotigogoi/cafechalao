"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Storefront } from "@/modules/menu/components/Storefront";
import { cart } from "@/modules/orders/cart";
import { ordersApi } from "@/modules/orders/api";
import { useM, useQ } from "@/shared/api/hooks";
import { useT } from "@/shared/i18n";
import { useTitle } from "@/shared/tenant/TenantProvider";
import { Button, Card, Empty, Loading } from "@/shared/ui/primitives";
import Link from "next/link";
import { Icon } from "@/shared/ui/icons";

/** Table QR (M2.3): the scan opens the branded menu tied to that table. Sign-in is optional for dine-in. */
export default function TablePage() {
  const { code } = useParams<{ code: string }>();
  const { t } = useT();
  const info = useQ<{ table: { id: string; name: string; area: string }; open_order_id: string | null; flow: string }>(`/qr/${code}`);
  useTitle(info.data ? `Table ${info.data.table.name}` : undefined);
  useEffect(() => {
    if (info.data) cart.setTable(code, info.data.table.name);
  }, [info.data, code]);
  const call = useM(() => ordersApi.callWaiter(code), { success: "A waiter is on the way" });
  const bill = useM(() => ordersApi.requestBill(info.data!.open_order_id!, code), { success: "Bill requested. We'll bring it shortly." });

  if (info.isLoading) return <Loading />;
  if (!info.data) return <Empty title="This QR code isn't valid">Please ask the staff for help.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-2 bg-paper">
        <span className="flex-1 text-sm">
          Scanned at <b>{info.data.table.name}</b> · {info.data.table.area} · Dine-in
        </span>
        <Button size="sm" onClick={() => call.mutate(undefined)} loading={call.isPending}><Icon name="bell" size={16} className="mr-1" />{t("Call waiter")}</Button>
        {info.data.open_order_id && (
          <>
            <Link href={`/orders/${info.data.open_order_id}?table=${code}`}><Button size="sm">Your order</Button></Link>
            <Button size="sm" onClick={() => bill.mutate(undefined)} loading={bill.isPending}>{t("Request bill")}</Button>
          </>
        )}
      </Card>
      <Storefront tableName={info.data.table.name} scanned />
    </div>
  );
}

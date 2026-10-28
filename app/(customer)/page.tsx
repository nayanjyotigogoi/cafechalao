"use client";

import { Storefront } from "@/modules/menu/components/Storefront";
import { useCart } from "@/modules/orders/cart";
import { useTitle } from "@/shared/tenant/TenantProvider";

export default function HomePage() {
  useTitle();
  const c = useCart();
  return <Storefront tableName={c.table_name} />;
}

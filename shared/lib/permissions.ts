import type { RoleKey } from "@/shared/types/entities";

/**
 * Permission keys (SRS section 2). The owner edits the grid in Settings → Roles;
 * these are the defaults. The API returns the same list for the signed-in user and
 * the UI checks it with can().
 */
export const PERMISSIONS = {
  "pos.bill": "Bill and take payments",
  "pos.discount_preset": "Apply preset discounts",
  "pos.discount_any": "Apply any discount (within limit)",
  "pos.void": "Void items (within limit)",
  "pos.refund": "Refund (within limit)",
  "pos.reprint": "Reprint bills and KOTs",
  "pos.day_close": "Close the day",
  "orders.take": "Take orders and send KOT",
  "orders.accept_online": "Accept online orders",
  "tables.manage": "Seat guests, merge and move tables",
  "reservations.manage": "Reservations and waitlist",
  "customers.create": "Create customer profiles",
  "customers.view": "View customer database",
  "kds.use": "Use kitchen display",
  "kds.wastage": "Record wastage",
  "stock.view": "View stock",
  "stock.receive": "Receive goods (GRN) and stock counts",
  "stock.request": "Raise purchase requests",
  "stock.approve": "Approve purchase requests and POs",
  "menu.edit": "Edit menu and availability",
  "menu.price": "Change prices",
  "marketing.manage": "Coupons, loyalty, gift cards, memberships, offers",
  "expenses.create": "Enter expenses",
  "expenses.approve": "Approve expenses",
  "staff.manage": "Manage staff and attendance",
  "staff.salary": "View and pay salaries",
  "delivery.assign": "Assign riders and settle",
  "delivery.ride": "Rider app",
  "aggregators.manage": "Swiggy/Zomato tracker",
  "reports.view": "View reports",
  "dashboard.owner": "Owner dashboard",
  "audit.view": "View audit log",
  "settings.manage": "All settings, branding and roles",
  "approvals.decide": "Approve requests in the queue",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Defaults for demo mode only; with the real API the role grid comes from api/config/cafechalao.php (the source of truth).
 * Stock, purchase, expenses, staff and salary are for the owner and manager only.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => !["settings.manage", "menu.price"].includes(p)),
  cashier: ["pos.bill", "pos.discount_preset", "pos.reprint", "pos.day_close", "orders.take", "orders.accept_online", "customers.create", "delivery.assign", "tables.manage"],
  receptionist: ["reservations.manage", "customers.create", "customers.view", "tables.manage", "orders.take"],
  captain: ["orders.take", "customers.create", "tables.manage"],
  kitchen: ["kds.use", "kds.wastage"],
  storekeeper: ["kds.wastage"],
  rider: ["delivery.ride"],
};

export const ROLE_LABEL: Record<RoleKey, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  receptionist: "Receptionist",
  captain: "Captain",
  kitchen: "Kitchen",
  storekeeper: "Storekeeper",
  rider: "Rider",
};

/** Where each role lands after PIN login. */
export const ROLE_HOME: Record<RoleKey, string> = {
  owner: "/admin",
  manager: "/admin",
  cashier: "/pos",
  receptionist: "/admin/reservations",
  captain: "/captain",
  kitchen: "/kds",
  storekeeper: "/admin/stock",
  rider: "/rider",
};

/** Role rank for "higher-role PIN" approvals. */
export const ROLE_RANK: Record<RoleKey, number> = {
  owner: 100, manager: 80, cashier: 40, receptionist: 30, captain: 30, storekeeper: 30, kitchen: 20, rider: 10,
};

export const can = (perms: readonly string[] | undefined, p: Permission) => !!perms?.includes(p);

import type * as E from "@/shared/types/entities";
import { emptyTables, type Tables } from "./tables";
import { businessTypeDefaults } from "@/shared/lib/features";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_LABEL } from "@/shared/lib/permissions";
import { priceOrder, financialYear, pointsEarned } from "@/shared/lib/pricing";
import { convert } from "@/shared/lib/units";

/**
 * Dummy data for four different cafés (CafeChalao's customers), each with its own menu,
 * staff, customers (the café's customers), stock, suppliers and 30 days of order history.
 * Deterministic: the same seed always produces the same rows, so tests can rely on it.
 */

export const DEMO_OTP = "123456";

/* ---------- deterministic helpers ---------- */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(42);
const r = () => rnd();
const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
const chance = (p: number) => r() < p;
let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}${Math.floor(r() * 46656).toString(36).padStart(3, "0")}`;
const P = (rupees: number) => Math.round(rupees * 100);
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const atTime = (d: Date, h: number, m: number) => {
  const x = new Date(d);
  x.setHours(h, m, int(0, 59), 0);
  return x;
};

/* ---------- café definitions ---------- */
type MenuSpec = [code: string, name: string, type: E.FoodType, price: number, opts?: {
  best?: boolean; oos?: boolean; desc?: string; prep?: number; variants?: [string, number][]; addons?: string; recipe?: [string, number, E.UnitCode][]; hi?: string;
}];
interface CafeDef {
  slug: string; name: string; legal: string; type: E.BusinessType; city: string; state: string; address: string;
  phone: string; email: string; owner: string; ownerPhone: string; primary: string; accent: string; tagline: string;
  heroTitle: string; heroSub: string; gstin: string | null; scheme: E.TaxSettings["gst_scheme"]; prefix: string;
  fssai: string; status: E.LicenceStatus; open: string; close: string; ordersPerDay: number; mix: Partial<Record<E.OrderType, number>>;
  areas: [string, number][]; categories: { name: string; hi?: string; station: E.Station; items: MenuSpec[] }[];
  addons: Record<string, { name: string; min: number; max: number; items: [string, number, E.FoodType][] }>;
  materials: [name: string, cat: string, unit: E.UnitCode, cost: number, min: number, stock: number, supplier: number][];
  suppliers: [name: string, contact: string, phone: string, items: string, gstin: string | null][];
  coupons: [code: string, kind: "pct" | "flat", value: number, min: number, max: number | null][];
  staff: [name: string, role: E.RoleKey, pin: string][];
  riders: [name: string, phone: string, vehicle: string, type: "own" | "freelance"][];
}

const CAFES: CafeDef[] = [
  {
    slug: "chai-adda", name: "Chai Adda", legal: "Chai Adda Hospitality LLP", type: "cafe", city: "Guwahati", state: "Assam (18)",
    address: "GS Road, Christian Basti, Guwahati 781005", phone: "+91 98640 11223", email: "hello@chaiadda.in",
    owner: "Nayan Gogoi", ownerPhone: "+91 98640 11223", primary: "#5E6B33", accent: "#F9D1D9", tagline: "Assam chai, done right.",
    heroTitle: "What's brewing?", heroSub: "Hot chai and snacks, delivered or ready for pickup.",
    gstin: "18AAKFC1234M1Z5", scheme: "regular", prefix: "CA", fssai: "10319001000123", status: "active", open: "08:00", close: "23:00",
    ordersPerDay: 34, mix: { dine_in: 0.55, takeaway: 0.25, delivery: 0.2 },
    areas: [["Ground floor", 8], ["Rooftop", 4]],
    categories: [
      { name: "Chai", hi: "चाय", station: "bar", items: [
        ["101", "Masala Chai", "veg", 40, { best: true, hi: "मसाला चाय", desc: "Assam CTC brewed with ginger, cardamom and fresh milk.", prep: 5, recipe: [["Milk", 120, "ml"], ["Assam CTC tea", 5, "g"], ["Sugar", 10, "g"], ["Ginger", 3, "g"]] }],
        ["102", "Ginger Chai", "veg", 45, { recipe: [["Milk", 120, "ml"], ["Assam CTC tea", 5, "g"], ["Sugar", 10, "g"], ["Ginger", 6, "g"]] }],
        ["103", "Lemon Tea", "veg", 35, { recipe: [["Assam CTC tea", 4, "g"], ["Sugar", 10, "g"], ["Lemon", 0.25, "pcs"]] }],
        ["104", "Kulhad Chai", "veg", 60, { best: true, desc: "Served in a clay cup.", recipe: [["Milk", 150, "ml"], ["Assam CTC tea", 6, "g"], ["Sugar", 12, "g"], ["Kulhad cups", 1, "pcs"]] }],
        ["105", "Green Tea", "veg", 50, { recipe: [["Green tea bags", 1, "pcs"]] }],
      ] },
      { name: "Coffee", hi: "कॉफ़ी", station: "bar", items: [
        ["201", "Filter Coffee", "veg", 60, { recipe: [["Milk", 100, "ml"], ["Coffee powder", 8, "g"], ["Sugar", 8, "g"]] }],
        ["202", "Cold Coffee", "veg", 110, { best: true, variants: [["Regular", 110], ["Large", 150]], addons: "coffee", recipe: [["Milk", 200, "ml"], ["Coffee powder", 10, "g"], ["Sugar", 15, "g"], ["Ice cream", 40, "g"]] }],
        ["203", "Matcha Latte", "veg", 160, { oos: true, recipe: [["Milk", 200, "ml"], ["Matcha powder", 4, "g"]] }],
      ] },
      { name: "Snacks", hi: "नाश्ता", station: "kitchen", items: [
        ["301", "Veg Puff", "veg", 30, { recipe: [["Puff pastry", 1, "pcs"]] }],
        ["302", "Bun Maska", "veg", 50, { best: true, recipe: [["Bun", 1, "pcs"], ["Butter", 15, "g"]] }],
        ["303", "Veg Sandwich", "veg", 90, { addons: "snack", recipe: [["Bread", 3, "pcs"], ["Butter", 10, "g"], ["Vegetables", 80, "g"]] }],
        ["304", "Paneer Wrap", "veg", 140, { addons: "snack", recipe: [["Tortilla", 1, "pcs"], ["Paneer", 80, "g"], ["Vegetables", 50, "g"]] }],
        ["305", "Chicken Momo", "non_veg", 140, { desc: "8 pieces, with red chutney.", prep: 12, recipe: [["Chicken", 120, "g"], ["Flour", 80, "g"]] }],
        ["306", "Egg Roll", "egg", 80, { recipe: [["Eggs", 1, "pcs"], ["Flour", 60, "g"], ["Vegetables", 30, "g"]] }],
      ] },
      { name: "Maggi", station: "kitchen", items: [
        ["401", "Plain Maggi", "veg", 60, { recipe: [["Maggi packets", 1, "pcs"]] }],
        ["402", "Cheese Maggi", "veg", 90, { best: true, prep: 10, addons: "snack", recipe: [["Maggi packets", 1, "pcs"], ["Cheese", 20, "g"]] }],
        ["403", "Masala Maggi", "veg", 70, { recipe: [["Maggi packets", 1, "pcs"], ["Vegetables", 40, "g"]] }],
      ] },
      { name: "Desserts", hi: "मिठाई", station: "dessert", items: [
        ["501", "Chocolate Brownie", "egg", 120, { addons: "dessert", recipe: [["Cocoa powder", 15, "g"], ["Flour", 40, "g"], ["Eggs", 1, "pcs"]] }],
        ["502", "Gulab Jamun", "veg", 60, { recipe: [["Gulab jamun", 2, "pcs"]] }],
      ] },
    ],
    addons: {
      coffee: { name: "Coffee extras", min: 0, max: 2, items: [["Extra shot", 30, "veg"], ["Hazelnut syrup", 25, "veg"]] },
      snack: { name: "Add extra", min: 0, max: 3, items: [["Extra cheese", 20, "veg"], ["Extra paneer", 30, "veg"], ["Jain (no onion-garlic)", 0, "veg"]] },
      dessert: { name: "Make it better", min: 0, max: 1, items: [["Vanilla scoop", 40, "veg"]] },
    },
    materials: [
      ["Milk", "Dairy", "L", 56, 10, 4.5, 0], ["Assam CTC tea", "Tea", "kg", 380, 2, 6, 1], ["Sugar", "Grocery", "kg", 44, 5, 12, 2],
      ["Ginger", "Vegetables", "kg", 120, 1, 1.8, 2], ["Lemon", "Vegetables", "pcs", 4, 30, 60, 2], ["Kulhad cups", "Packaging", "pcs", 6, 100, 240, 2],
      ["Green tea bags", "Tea", "pcs", 5, 50, 120, 1], ["Coffee powder", "Coffee", "kg", 900, 1, 2.2, 1], ["Ice cream", "Dairy", "kg", 260, 2, 3, 0],
      ["Matcha powder", "Tea", "g", 3, 100, 0, 1], ["Puff pastry", "Bakery", "pcs", 14, 20, 36, 2], ["Bun", "Bakery", "pcs", 8, 30, 50, 2],
      ["Butter", "Dairy", "kg", 520, 1, 2.5, 0], ["Bread", "Bakery", "pcs", 3, 60, 90, 2], ["Vegetables", "Vegetables", "kg", 60, 5, 9, 2],
      ["Tortilla", "Bakery", "pcs", 12, 20, 40, 2], ["Paneer", "Dairy", "kg", 380, 2, 3.2, 0], ["Chicken", "Meat", "kg", 240, 3, 5, 2],
      ["Flour", "Grocery", "kg", 38, 5, 14, 2], ["Eggs", "Dairy", "pcs", 6.5, 60, 90, 2], ["Maggi packets", "Grocery", "pcs", 14, 50, 38, 2],
      ["Cheese", "Dairy", "kg", 480, 1, 1.6, 0], ["Cocoa powder", "Grocery", "kg", 620, 0.5, 0, 2], ["Gulab jamun", "Sweets", "pcs", 12, 30, 60, 2],
    ],
    suppliers: [
      ["Purabi Dairy", "Ranjit Das", "+91 98540 22110", "Milk, butter, paneer, cheese, ice cream", "18AABCP1111D1Z2"],
      ["Tezpur Traders", "Bipul Saikia", "+91 94350 55667", "Tea, coffee", "18AAFFT2222T1Z9"],
      ["Metro Cash & Carry", "Store desk", "+91 36120 00000", "Groceries, bakery, packaging", "18AACCM3333M1Z1"],
    ],
    coupons: [["CHAI10", "pct", 10, 150, 50], ["FIRST50", "flat", 50, 300, null], ["ROOFTOP20", "pct", 20, 500, 120]],
    staff: [["Nayan Gogoi", "owner", "1111"], ["Pooja Baruah", "manager", "2222"], ["Anu Kalita", "cashier", "3333"], ["Meena Das", "receptionist", "4444"],
      ["Rahul Bora", "captain", "5555"], ["Dipankar Nath", "captain", "5556"], ["Suresh Rai", "kitchen", "6666"], ["Hemanta Deka", "storekeeper", "7777"]],
    riders: [["Amit Sharma", "+91 90000 11111", "Honda Activa · AS01 AB 1234", "own"], ["Bikash Roy", "+91 90000 22222", "Hero Splendor · AS01 CD 5678", "freelance"]],
  },
  {
    slug: "momo-mahal", name: "Momo Mahal", legal: "Momo Mahal Restaurants Pvt Ltd", type: "restaurant", city: "Siliguri", state: "West Bengal (19)",
    address: "Hill Cart Road, Siliguri 734001", phone: "+91 97330 44556", email: "orders@momomahal.in",
    owner: "Tenzin Lama", ownerPhone: "+91 97330 44556", primary: "#8C2F1B", accent: "#F6D7B0", tagline: "Himalayan kitchen since 2012.",
    heroTitle: "Hot momos, warm bowls", heroSub: "Book a table for dinner or order to your door.",
    gstin: "19AAHCM5678K1Z3", scheme: "regular", prefix: "MM", fssai: "12819002000456", status: "active", open: "11:00", close: "23:00",
    ordersPerDay: 42, mix: { dine_in: 0.65, takeaway: 0.15, delivery: 0.2 },
    areas: [["AC hall", 10], ["Family section", 6], ["Outdoor", 4]],
    categories: [
      { name: "Momos", station: "kitchen", items: [
        ["11", "Veg Steamed Momo", "veg", 120, { best: true, variants: [["6 pcs", 120], ["10 pcs", 180]], addons: "dip", recipe: [["Flour", 90, "g"], ["Cabbage", 80, "g"]] }],
        ["12", "Chicken Steamed Momo", "non_veg", 150, { best: true, variants: [["6 pcs", 150], ["10 pcs", 230]], addons: "dip", recipe: [["Flour", 90, "g"], ["Chicken", 110, "g"]] }],
        ["13", "Pork Momo", "non_veg", 180, { variants: [["6 pcs", 180], ["10 pcs", 270]], recipe: [["Flour", 90, "g"], ["Pork", 110, "g"]] }],
        ["14", "Paneer Fried Momo", "veg", 160, { addons: "dip", recipe: [["Flour", 90, "g"], ["Paneer", 80, "g"], ["Oil", 30, "ml"]] }],
      ] },
      { name: "Starters", station: "kitchen", items: [
        ["21", "Honey Chilli Potato", "veg", 150, { recipe: [["Potato", 200, "g"], ["Oil", 40, "ml"]] }],
        ["22", "Chilli Chicken", "non_veg", 240, { best: true, recipe: [["Chicken", 200, "g"], ["Oil", 40, "ml"], ["Cabbage", 30, "g"]] }],
        ["23", "Paneer Chilli", "veg", 220, { recipe: [["Paneer", 150, "g"], ["Oil", 30, "ml"]] }],
      ] },
      { name: "Thukpa & Soups", station: "kitchen", items: [
        ["31", "Veg Thukpa", "veg", 140, { recipe: [["Noodles", 120, "g"], ["Cabbage", 60, "g"]] }],
        ["32", "Chicken Thukpa", "non_veg", 170, { best: true, recipe: [["Noodles", 120, "g"], ["Chicken", 90, "g"]] }],
        ["33", "Manchow Soup", "veg", 110, { recipe: [["Cabbage", 50, "g"], ["Noodles", 30, "g"]] }],
      ] },
      { name: "Mains", station: "kitchen", items: [
        ["41", "Veg Hakka Noodles", "veg", 160, { recipe: [["Noodles", 150, "g"], ["Cabbage", 60, "g"], ["Oil", 20, "ml"]] }],
        ["42", "Chicken Fried Rice", "non_veg", 190, { recipe: [["Rice", 180, "g"], ["Chicken", 80, "g"], ["Oil", 20, "ml"]] }],
        ["43", "Egg Fried Rice", "egg", 160, { recipe: [["Rice", 180, "g"], ["Eggs", 2, "pcs"]] }],
      ] },
      { name: "Drinks", station: "bar", items: [
        ["51", "Lemon Iced Tea", "veg", 90, { recipe: [["Tea leaves", 5, "g"], ["Lemon", 0.5, "pcs"]] }],
        ["52", "Fresh Lime Soda", "veg", 80, { recipe: [["Lemon", 1, "pcs"], ["Soda", 1, "pcs"]] }],
        ["53", "Butter Tea", "veg", 70, { recipe: [["Tea leaves", 5, "g"], ["Butter", 15, "g"]] }],
      ] },
      { name: "Desserts", station: "dessert", items: [
        ["61", "Date Pancake", "egg", 130, { recipe: [["Flour", 60, "g"], ["Eggs", 1, "pcs"]] }],
      ] },
    ],
    addons: { dip: { name: "Dips", min: 0, max: 2, items: [["Schezwan dip", 20, "veg"], ["Mayo dip", 20, "egg"], ["Extra jhol", 30, "veg"]] } },
    materials: [
      ["Flour", "Grocery", "kg", 36, 10, 28, 1], ["Cabbage", "Vegetables", "kg", 30, 5, 12, 1], ["Chicken", "Meat", "kg", 230, 8, 14, 0],
      ["Pork", "Meat", "kg", 320, 4, 3.5, 0], ["Paneer", "Dairy", "kg", 360, 3, 4, 1], ["Oil", "Grocery", "L", 140, 10, 22, 1],
      ["Potato", "Vegetables", "kg", 25, 10, 18, 1], ["Noodles", "Grocery", "kg", 90, 5, 9, 1], ["Rice", "Grocery", "kg", 70, 15, 32, 1],
      ["Eggs", "Dairy", "pcs", 6.5, 60, 150, 1], ["Tea leaves", "Tea", "kg", 420, 1, 2, 1], ["Lemon", "Vegetables", "pcs", 4, 40, 70, 1],
      ["Soda", "Beverages", "pcs", 15, 24, 48, 1], ["Butter", "Dairy", "kg", 520, 1, 1.5, 1],
    ],
    suppliers: [["Himalayan Meats", "Karma Sherpa", "+91 97330 11000", "Chicken, pork", "19AAFH9876H1Z0"], ["Siliguri Wholesale Mart", "Amit Agarwal", "+91 98320 66000", "Groceries, vegetables, dairy", "19AACS4321S1Z7"]],
    coupons: [["MOMO15", "pct", 15, 400, 100], ["FAMILY100", "flat", 100, 1200, null]],
    staff: [["Tenzin Lama", "owner", "1111"], ["Sonam Bhutia", "manager", "2222"], ["Rita Sharma", "cashier", "3333"], ["Neha Thapa", "receptionist", "4444"],
      ["Pemba Tamang", "captain", "5555"], ["Kiran Rai", "captain", "5556"], ["Dawa Sherpa", "kitchen", "6666"], ["Raju Mondal", "storekeeper", "7777"]],
    riders: [["Sanjay Barman", "+91 90000 33333", "TVS Jupiter · WB74 AB 2211", "own"]],
  },
  {
    slug: "brew-bros", name: "Brew Bros", legal: "Brew Bros Foods", type: "qsr", city: "Shillong", state: "Meghalaya (17)",
    address: "Police Bazar, Shillong 793001", phone: "+91 98630 77889", email: "hey@brewbros.in",
    owner: "Daniel Kharkongor", ownerPhone: "+91 98630 77889", primary: "#0F3C65", accent: "#CFE3F5", tagline: "Burgers, fries and thick shakes.",
    heroTitle: "Hungry? Grab a token.", heroSub: "Order ahead for pickup or get it delivered across Shillong.",
    gstin: null, scheme: "composition", prefix: "BB", fssai: "21719003000789", status: "trial", open: "10:00", close: "22:00",
    ordersPerDay: 48, mix: { counter: 0.6, takeaway: 0.2, delivery: 0.2 },
    areas: [],
    categories: [
      { name: "Burgers", station: "kitchen", items: [
        ["1", "Veg Crunch Burger", "veg", 99, { best: true, addons: "burger", recipe: [["Burger buns", 1, "pcs"], ["Veg patty", 1, "pcs"], ["Cheese slices", 1, "pcs"]] }],
        ["2", "Chicken Zinger Burger", "non_veg", 149, { best: true, addons: "burger", recipe: [["Burger buns", 1, "pcs"], ["Chicken fillet", 1, "pcs"]] }],
        ["3", "Paneer Tikka Burger", "veg", 129, { addons: "burger", recipe: [["Burger buns", 1, "pcs"], ["Paneer", 70, "g"]] }],
      ] },
      { name: "Fries & Sides", station: "kitchen", items: [
        ["4", "Peri Peri Fries", "veg", 89, { variants: [["Regular", 89], ["Large", 119]], recipe: [["Frozen fries", 150, "g"], ["Oil", 20, "ml"]] }],
        ["5", "Cheese Fries", "veg", 119, { recipe: [["Frozen fries", 150, "g"], ["Cheese slices", 2, "pcs"]] }],
        ["6", "Chicken Nuggets (6)", "non_veg", 139, { recipe: [["Chicken nuggets", 6, "pcs"], ["Oil", 20, "ml"]] }],
      ] },
      { name: "Wraps", station: "kitchen", items: [["7", "Egg Wrap", "egg", 99, { recipe: [["Tortilla", 1, "pcs"], ["Eggs", 2, "pcs"]] }]] },
      { name: "Shakes", station: "bar", items: [
        ["8", "Oreo Shake", "veg", 129, { best: true, recipe: [["Milk", 250, "ml"], ["Ice cream", 60, "g"], ["Oreo", 3, "pcs"]] }],
        ["9", "Cold Coffee", "veg", 109, { recipe: [["Milk", 250, "ml"], ["Coffee powder", 8, "g"]] }],
        ["10", "Strawberry Shake", "veg", 119, { recipe: [["Milk", 250, "ml"], ["Strawberry syrup", 30, "ml"]] }],
      ] },
    ],
    addons: { burger: { name: "Upgrade", min: 0, max: 2, items: [["Extra cheese slice", 15, "veg"], ["Make it a meal (fries + coke)", 79, "veg"]] } },
    materials: [
      ["Burger buns", "Bakery", "pcs", 9, 60, 140, 0], ["Veg patty", "Frozen", "pcs", 18, 40, 80, 0], ["Chicken fillet", "Frozen", "pcs", 38, 40, 55, 0],
      ["Cheese slices", "Dairy", "pcs", 9, 60, 120, 0], ["Paneer", "Dairy", "kg", 380, 2, 2.5, 0], ["Frozen fries", "Frozen", "kg", 140, 10, 16, 0],
      ["Oil", "Grocery", "L", 140, 10, 18, 0], ["Chicken nuggets", "Frozen", "pcs", 9, 60, 140, 0], ["Tortilla", "Bakery", "pcs", 12, 20, 30, 0],
      ["Eggs", "Dairy", "pcs", 6.5, 60, 90, 0], ["Milk", "Dairy", "L", 58, 10, 14, 0], ["Ice cream", "Dairy", "kg", 260, 3, 4, 0],
      ["Oreo", "Grocery", "pcs", 3, 60, 100, 0], ["Coffee powder", "Coffee", "kg", 900, 1, 1.5, 0], ["Strawberry syrup", "Grocery", "L", 300, 1, 1.2, 0],
    ],
    suppliers: [["Shillong Frozen Foods", "Wanphrang Lyngdoh", "+91 98630 10101", "Frozen, bakery, dairy", null]],
    coupons: [["BROS20", "pct", 20, 250, 60]],
    staff: [["Daniel Kharkongor", "owner", "1111"], ["Ibapyntngen Syiem", "manager", "2222"], ["Shanbor Nongrum", "cashier", "3333"], ["Kyrsoibor Warjri", "kitchen", "6666"], ["Banri Lyngdoh", "storekeeper", "7777"]],
    riders: [["Ricky Marak", "+91 90000 44444", "Bajaj Pulsar · ML05 AB 9090", "freelance"]],
  },
  {
    slug: "tiffin-tales", name: "Tiffin Tales", legal: "Tiffin Tales Cloud Kitchen", type: "cloud_kitchen", city: "Kolkata", state: "West Bengal (19)",
    address: "Salt Lake Sector V, Kolkata 700091", phone: "+91 98300 12345", email: "khana@tiffintales.in",
    owner: "Ritika Sen", ownerPhone: "+91 98300 12345", primary: "#2B1E16", accent: "#F3C98B", tagline: "Ghar jaisa khana, delivered.",
    heroTitle: "Lunch is sorted", heroSub: "Thalis, rolls and Kolkata biryani delivered hot in Salt Lake and New Town.",
    gstin: "19AAJFT4455Q1Z8", scheme: "regular", prefix: "TT", fssai: "12819004000999", status: "active", open: "11:00", close: "23:30",
    ordersPerDay: 38, mix: { delivery: 0.8, takeaway: 0.2 },
    areas: [],
    categories: [
      { name: "Thalis", station: "kitchen", items: [
        ["1", "Veg Thali", "veg", 179, { best: true, desc: "Rice, dal, 2 sabzi, roti, salad, papad.", recipe: [["Rice", 150, "g"], ["Dal", 60, "g"], ["Vegetables", 150, "g"]] }],
        ["2", "Fish Thali", "non_veg", 249, { best: true, desc: "Macher jhol with rice and dal.", recipe: [["Rice", 150, "g"], ["Fish", 150, "g"], ["Dal", 60, "g"]] }],
        ["3", "Chicken Thali", "non_veg", 229, { recipe: [["Rice", 150, "g"], ["Chicken", 150, "g"], ["Dal", 60, "g"]] }],
      ] },
      { name: "Rolls", station: "kitchen", items: [
        ["4", "Egg Roll", "egg", 70, { recipe: [["Paratha", 1, "pcs"], ["Eggs", 1, "pcs"]] }],
        ["5", "Chicken Roll", "non_veg", 110, { best: true, recipe: [["Paratha", 1, "pcs"], ["Chicken", 90, "g"]] }],
        ["6", "Paneer Roll", "veg", 100, { recipe: [["Paratha", 1, "pcs"], ["Paneer", 70, "g"]] }],
      ] },
      { name: "Biryani", station: "kitchen", items: [
        ["7", "Kolkata Chicken Biryani", "non_veg", 230, { best: true, variants: [["Half", 230], ["Full", 380]], recipe: [["Basmati rice", 200, "g"], ["Chicken", 180, "g"], ["Potato", 80, "g"]] }],
        ["8", "Mutton Biryani", "non_veg", 320, { variants: [["Half", 320], ["Full", 560]], recipe: [["Basmati rice", 200, "g"], ["Mutton", 180, "g"], ["Potato", 80, "g"]] }],
        ["9", "Veg Biryani", "veg", 180, { recipe: [["Basmati rice", 200, "g"], ["Vegetables", 120, "g"]] }],
      ] },
      { name: "Sweets", station: "dessert", items: [
        ["10", "Rasgulla (2)", "veg", 50, { recipe: [["Rasgulla", 2, "pcs"]] }],
        ["11", "Mishti Doi", "veg", 60, { best: true, recipe: [["Mishti doi cups", 1, "pcs"]] }],
      ] },
    ],
    addons: {},
    materials: [
      ["Rice", "Grocery", "kg", 55, 20, 40, 0], ["Basmati rice", "Grocery", "kg", 120, 15, 22, 0], ["Dal", "Grocery", "kg", 110, 5, 9, 0],
      ["Vegetables", "Vegetables", "kg", 50, 10, 16, 0], ["Fish", "Meat", "kg", 380, 5, 6, 1], ["Chicken", "Meat", "kg", 230, 10, 12, 1],
      ["Mutton", "Meat", "kg", 720, 4, 3, 1], ["Paratha", "Bakery", "pcs", 8, 60, 120, 0], ["Eggs", "Dairy", "pcs", 6.5, 60, 100, 0],
      ["Paneer", "Dairy", "kg", 360, 2, 2.5, 0], ["Potato", "Vegetables", "kg", 25, 10, 20, 0], ["Rasgulla", "Sweets", "pcs", 12, 40, 80, 0],
      ["Mishti doi cups", "Sweets", "pcs", 22, 30, 45, 0],
    ],
    suppliers: [["Sector V Provisions", "Subhash Ghosh", "+91 98310 20202", "Groceries, vegetables, dairy, sweets", "19AAESP7777P1Z4"], ["Gariahat Fish & Meat", "Babu Mia", "+91 98310 30303", "Fish, chicken, mutton", null]],
    coupons: [["LUNCH50", "flat", 50, 350, null], ["TALES10", "pct", 10, 200, 80]],
    staff: [["Ritika Sen", "owner", "1111"], ["Arnab Dutta", "manager", "2222"], ["Moumita Paul", "cashier", "3333"], ["Gopal Haldar", "kitchen", "6666"], ["Sujoy Mitra", "storekeeper", "7777"]],
    riders: [["Rakesh Mondal", "+91 90000 55555", "Honda Shine · WB02 XY 3344", "own"], ["Imran Sheikh", "+91 90000 66666", "TVS XL · WB02 ZZ 1122", "freelance"]],
  },
];

const FIRST = ["Priya", "Rohan", "Ananya", "Arjun", "Ishita", "Kabir", "Meera", "Aditya", "Sneha", "Vikram", "Riya", "Sahil", "Tanvi", "Nikhil", "Pallavi", "Manish", "Kavya", "Deepak", "Aisha", "Rahul", "Simran", "Abhishek", "Neha", "Siddharth", "Pooja", "Gaurav", "Shreya", "Varun", "Bidisha", "Pranjal", "Jahnavi", "Debajit", "Mitali", "Hrishikesh", "Ankita", "Sourav", "Puja", "Tanmoy", "Rupam", "Barsha"];
const LAST = ["Sharma", "Das", "Baruah", "Saikia", "Bora", "Gogoi", "Sen", "Ghosh", "Roy", "Paul", "Singh", "Gupta", "Kalita", "Deka", "Chakraborty", "Bhattacharya", "Lama", "Tamang", "Nongrum", "Agarwal"];
const COMMENTS = ["Loved it!", "Chai was perfect.", "A bit slow today.", "Great service, will come again.", "Food was cold on arrival.", "Value for money.", "Too salty.", "Best momos in town.", "Packaging could be better.", ""];

export function buildSeed(now = new Date()): Tables {
  rnd = mulberry32(42);
  seq = 0;
  const t = emptyTables();

  t.platform_admins.push(
    { id: "pa_1", name: "Nayanjyoti Gogoi", email: "admin@cafechalao.in", role: "super_admin" },
    { id: "pa_2", name: "Support Desk", email: "support@cafechalao.in", role: "support" },
  );

  for (const def of CAFES) seedCafe(t, def, now);
  return t;
}

function seedCafe(t: Tables, def: CafeDef, now: Date) {
  const tenantId = `tn_${def.slug.replace(/-/g, "_")}`;
  const created = addDays(now, -120);
  const base = (by: string | null = null, at: Date = created): E.BaseRow => ({
    id: "", tenant_id: tenantId, created_at: iso(at), updated_at: iso(at), created_by: by, deleted_at: null,
  });
  const row = <T extends E.BaseRow>(prefix: string, data: Omit<T, keyof E.BaseRow>, at?: Date, by: string | null = null): T =>
    ({ ...base(by, at), ...data, id: id(prefix) }) as T;

  /* tenant (L1 register) */
  t.tenants.push({
    id: tenantId, slug: def.slug, domains: [`${def.slug}.localhost`, `order.${def.slug.replace("-", "")}.in`], name: def.name,
    owner_name: def.owner, owner_phone: def.ownerPhone, owner_email: def.email, city: def.city, business_type: def.type,
    hosting: "shared", licence_key: `CC-P1-${def.slug.toUpperCase().slice(0, 4)}-${int(1000, 9999)}-${int(1000, 9999)}`, plan: "phase1",
    purchase_date: iso(created), support_expiry: iso(addDays(created, def.status === "trial" ? 14 : 365)), status: def.status,
    version: def.status === "trial" ? "1.4.1" : "1.4.2", last_backup_at: iso(atTime(now, 3, 0)), uptime_pct: 99.9,
    go_live_date: def.status === "trial" ? null : iso(addDays(created, 3)), support_access_until: null, created_at: iso(created),
  });
  t.support_tickets.push(
    { id: id("tk"), tenant_id: tenantId, subject: "Printer not printing KOT on rooftop", kind: "support", quote: null, billing_status: "none", status: def.slug === "chai-adda" ? "open" : "closed", created_at: iso(addDays(now, -2)) },
    { id: id("tk"), tenant_id: tenantId, subject: "Add Bengali language", kind: "change_request", quote: P(15000), billing_status: "quoted", status: "open", created_at: iso(addDays(now, -9)) },
  );

  /* outlet + settings */
  t.outlets.push(row<E.Outlet>("ot", {
    name: def.name, legal_name: def.legal, business_type: def.type, address: def.address, city: def.city, phone: def.phone, email: def.email,
    opening_time: def.open, closing_time: def.close, tagline: def.tagline, setup_step: def.status === "trial" ? 7 : 10,
  }));
  t.brand_settings.push(row<E.BrandSettings>("bs", {
    app_name: def.name, short_name: def.name.split(" ")[0], logo_url: null, primary_color: def.primary, accent_color: def.accent,
    hero_title: def.heroTitle, hero_subtitle: def.heroSub,
  }));
  t.tax_settings.push(row<E.TaxSettings>("tx", {
    gstin: def.gstin, gst_scheme: def.scheme, default_gst_rate: 5, fssai_number: def.fssai, invoice_prefix: `${def.prefix}/`,
    hsn_sac: "9963", place_of_supply: def.state, service_charge_enabled: def.type === "restaurant", service_charge_pct: 5, round_off: true,
  }));
  const features = businessTypeDefaults(def.type);
  t.business_type_flags.push(row<E.BusinessTypeFlags>("bf", {
    features, qr_order_flow: "direct_to_kitchen", auto_accept_online: def.type !== "restaurant", kds_amber_min: 10, kds_red_min: 15, language: "en",
  }));
  t.payment_settings.push(row<E.PaymentSettings>("ps", {
    modes: { cash: true, upi: true, card: true, online: true, cod: true, upi_on_delivery: true }, gateway: "dummy",
    gateway_key_id: "dummy_key_test", gateway_configured: true, upi_id: `${def.slug.replace("-", "")}@okaxis`,
  }));
  t.delivery_settings.push(row<E.DeliverySettings>("ds", {
    enabled: features.delivery, mode: def.riders.some((x) => x[3] === "freelance") && def.riders.some((x) => x[3] === "own") ? "both" : def.riders[0][3],
    charge_type: def.type === "cloud_kitchen" ? "slab" : "flat", flat_charge: P(30),
    slabs: [{ upto_amount: P(299), charge: P(40) }, { upto_amount: P(599), charge: P(25) }, { upto_amount: P(100000), charge: 0 }],
    min_order: P(def.type === "cloud_kitchen" ? 149 : 99), allow_prepaid: true, allow_cod: true, allow_upi_on_delivery: true,
  }));
  t.loyalty_settings.push(row<E.LoyaltySettings>("ls", { enabled: true, earn_per_rupees: 10, point_value: 25, min_bill_to_redeem: P(200), expiry_days: 365 }));
  t.printers.push(
    row<E.Printer>("pr", { name: "Counter 80mm", station: "bill", width_mm: 80, connection: "network", address: "192.168.1.50:9100", online: true }),
    row<E.Printer>("pr", { name: "Kitchen 58mm", station: "kitchen", width_mm: 58, connection: "bluetooth", address: "BT:66:12:AB", online: def.slug !== "chai-adda" }),
  );
  t.devices.push(
    row<E.Device>("dv", { name: "Counter tablet", kind: "pos", station: null, last_seen_at: iso(now) }),
    row<E.Device>("dv", { name: "Kitchen screen", kind: "kds", station: "kitchen", last_seen_at: iso(now) }),
  );

  /* roles, limits, staff */
  for (const key of Object.keys(DEFAULT_ROLE_PERMISSIONS) as E.RoleKey[]) {
    t.roles.push(row<E.Role>("rl", { key, name: ROLE_LABEL[key], permissions: [...DEFAULT_ROLE_PERMISSIONS[key]] }));
  }
  const limits: Partial<Record<E.RoleKey, [number, number, number, number, number]>> = {
    owner: [100, 1e9, 1e9, 1e9, 1e9], manager: [25, P(2000), P(2000), P(5000), P(25000)], cashier: [5, 0, 0, P(500), 0], storekeeper: [0, 0, 0, 0, 0],
  };
  for (const [role, v] of Object.entries(limits) as [E.RoleKey, number[]][]) {
    t.approval_limits.push(row<E.ApprovalLimit>("al", { role, discount_pct: v[0], void_value: v[1], refund_value: v[2], expense_value: v[3], po_value: v[4] }));
  }
  const colors = ["#C2566E", "#5E6B33", "#0F3C65", "#A9770A", "#3E7D4F", "#6B4E9B", "#8C2F1B", "#2B6F77"];
  const users = def.staff.map(([name, role, pin], i) => {
    const u = row<E.User>("us", {
      employee_code: `E${String(i + 1).padStart(3, "0")}`, name, role, phone: `+91 9${int(100000000, 999999999)}`, email: role === "owner" || role === "manager" ? `${name.split(" ")[0].toLowerCase()}@${def.slug.replace("-", "")}.in` : null,
      pin_hash: pin, active: true, avatar_color: colors[i % colors.length],
    });
    t.users.push(u);
    t.staff_profiles.push(row<E.StaffProfile>("sp", {
      user_id: u.id, salary_type: role === "kitchen" && i % 2 ? "daily" : "monthly",
      salary_amount: role === "owner" ? 0 : P(({ manager: 28000, cashier: 16000, receptionist: 14000, captain: 13000, kitchen: 15000, storekeeper: 14000, rider: 12000, owner: 0 } as const)[role]),
      weekly_off: i % 7, shift_start: def.open, shift_end: def.close, id_document: null, joined_on: ymd(addDays(created, -int(30, 600))),
    }));
    return u;
  });
  const userBy = (role: E.RoleKey) => users.find((u) => u.role === role) ?? users[0];
  const owner = userBy("owner");
  const cashier = userBy("cashier");
  const captains = users.filter((u) => u.role === "captain");

  /* riders */
  const riders = def.riders.map(([name, phone, vehicle, type]) => {
    let userId: string | null = null;
    if (type === "own") {
      const u = row<E.User>("us", { employee_code: `E${String(t.users.length + 1).padStart(3, "0")}`, name, role: "rider", phone, email: null, pin_hash: "", active: true, avatar_color: "#A9770A" });
      t.users.push(u);
      t.staff_profiles.push(row<E.StaffProfile>("sp", { user_id: u.id, salary_type: "monthly", salary_amount: P(12000), weekly_off: 2, shift_start: def.open, shift_end: def.close, id_document: "DL-XXXX", joined_on: ymd(addDays(created, -200)) }));
      userId = u.id;
    }
    const rd = row<E.Rider>("rd", { user_id: userId, name, phone, vehicle, id_document: "Driving licence", type, online: true, active: true });
    t.riders.push(rd);
    return rd;
  });

  /* suppliers + materials */
  const suppliers = def.suppliers.map(([name, contact, phone, items, gstin]) => {
    const s = row<E.Supplier>("su", { name, gstin, contact_person: contact, phone, email: null, payment_terms_days: 15, items_supplied: items, outstanding: 0 });
    t.suppliers.push(s);
    return s;
  });
  const mats = new Map<string, E.RawMaterial>();
  for (const [name, cat, unit, cost, min, stock, sup] of def.materials) {
    const m = row<E.RawMaterial>("rm", {
      name, category: cat, unit, storage: cat === "Dairy" || cat === "Meat" || cat === "Frozen" ? "Cold room" : "Dry store",
      min_level: min, stock, avg_cost: P(cost), last_cost: P(cost), supplier_id: suppliers[sup]?.id ?? null,
    });
    mats.set(name, m);
    t.raw_materials.push(m);
    t.stock_ledger.push(row<E.StockLedger>("sl", { raw_material_id: m.id, qty: stock, reason: "opening", ref_id: null, balance_after: stock }, created));
  }

  /* menu */
  const breakfast = row<E.AvailabilitySlot>("as", { name: "Breakfast", start_time: "08:00", end_time: "11:30" });
  t.availability_slots.push(breakfast);
  const groups = new Map<string, E.AddOnGroup>();
  for (const [key, g] of Object.entries(def.addons)) {
    const grp = row<E.AddOnGroup>("ag", { name: g.name, min_select: g.min, max_select: g.max });
    groups.set(key, grp);
    t.add_on_groups.push(grp);
    for (const [n, price, ft] of g.items) t.add_ons.push(row<E.AddOn>("ao", { group_id: grp.id, name: n, price: P(price), food_type: ft }));
  }
  const menu: { item: E.Item; variants: E.Variant[]; recipeCost: number }[] = [];
  def.categories.forEach((c, ci) => {
    const cat = row<E.Category>("ct", { name: c.name, name_hi: c.hi ?? null, sort: ci, station: c.station, active: true });
    t.categories.push(cat);
    c.items.forEach(([code, name, ft, price, o = {}], ii) => {
      const item = row<E.Item>("it", {
        category_id: cat.id, code, name, name_hi: o.hi ?? null, description: o.desc ?? "", food_type: ft, price: P(price), gst_rate: null,
        photo_url: null, bestseller: !!o.best, in_stock: !o.oos, available_today: true, prep_minutes: o.prep ?? 8,
        availability_slot_id: code === "302" ? breakfast.id : null, add_on_group_ids: o.addons && groups.get(o.addons) ? [groups.get(o.addons)!.id] : [], sort: ii,
      });
      t.items.push(item);
      const variants = (o.variants ?? []).map(([vn, vp], vi) => row<E.Variant>("va", { item_id: item.id, name: vn, price: P(vp), is_default: vi === 0 }));
      t.variants.push(...variants);
      let recipeCost = 0;
      if (o.recipe) {
        const rec = row<E.Recipe>("rc", { item_id: item.id, variant_id: null });
        t.recipes.push(rec);
        for (const [mn, q, u] of o.recipe) {
          const m = mats.get(mn);
          if (!m) continue;
          t.recipe_lines.push(row<E.RecipeLine>("rcl", { recipe_id: rec.id, raw_material_id: m.id, qty: q, unit: u }));
          recipeCost += convert(q, u, m.unit) * m.avg_cost;
        }
      }
      menu.push({ item, variants, recipeCost: Math.round(recipeCost) });
    });
  });

  /* floor */
  const tables: E.DiningTable[] = [];
  let tn = 1;
  def.areas.forEach(([name, count], ai) => {
    const area = row<E.Area>("ar", { name, sort: ai });
    t.areas.push(area);
    for (let i = 0; i < count; i++) {
      const tb = row<E.DiningTable>("tb", { area_id: area.id, name: `T${tn}`, seats: pick([2, 2, 4, 4, 4, 6]), status: "free", qr_code: `${def.slug.slice(0, 2)}${tn}${int(100, 999)}`, merged_into: null, current_session_id: null });
      tn++;
      tables.push(tb);
      t.dining_tables.push(tb);
    }
  });

  /* customers (the café's own customers) */
  const customers: E.Customer[] = [];
  for (let i = 0; i < 46; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const bdayToday = i < 2;
    const bd = bdayToday ? addDays(now, 0) : addDays(now, int(-180, 180));
    const c = row<E.Customer>("cu", {
      name, phone: `+91 ${pick(["98", "97", "94", "70", "88"])}${int(100, 999)} ${int(10000, 99999)}`, phone_verified: i % 5 !== 0,
      email: i % 3 === 0 ? `${name.split(" ")[0].toLowerCase()}${i}@gmail.com` : null, google_id: i % 3 === 0 ? `g_${i}${def.slug}` : null,
      birthday: `${int(1975, 2005)}-${String(bd.getMonth() + 1).padStart(2, "0")}-${String(bd.getDate()).padStart(2, "0")}`,
      anniversary: i % 7 === 0 ? `2015-${String(((i + now.getMonth()) % 12) + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` : null,
      gender: pick(["male", "female", null] as const), source: i % 4 === 0 ? "walk_in" : i % 4 === 1 ? "qr" : "app",
      marketing_consent: i % 4 !== 3, tags: [], loyalty_points: 0, total_spend: 0, visits: 0, last_visit_at: null,
    }, addDays(now, -int(10, 110)));
    customers.push(c);
    t.customers.push(c);
    if (i % 2 === 0) {
      t.addresses.push(row<E.Address>("ad", { customer_id: c.id, label: "Home", line1: `House ${int(1, 120)}, ${pick(["Zoo Road", "Beltola", "Ganeshguri", "Lane 4", "Park Street", "Sevoke Road", "Laitumkhrah"])}`, line2: "", landmark: pick(["Near temple", "Opp. school", "Behind petrol pump", ""]), city: def.city, pincode: `7${int(10000, 99999)}` }));
    }
    t.consent_logs.push(row<E.ConsentLog>("cl", { customer_id: c.id, purpose: "marketing_whatsapp", granted: c.marketing_consent }));
  }
  // The demo Google account used by "Continue with Google" is already a customer here (separately per café).
  const demo = row<E.Customer>("cu", {
    name: "Priya Sharma", phone: "+91 98640 55555", phone_verified: true, email: "priya.demo@gmail.com", google_id: "g_demo_priya",
    birthday: "1996-03-14", anniversary: null, gender: "female", source: "app", marketing_consent: true, tags: [], loyalty_points: 0, total_spend: 0, visits: 0, last_visit_at: null,
  });
  customers.push(demo);
  t.customers.push(demo);
  t.addresses.push(row<E.Address>("ad", { customer_id: demo.id, label: "Home", line1: "House 12, Zoo Road", line2: "", landmark: "Near Zoo gate", city: def.city, pincode: "781024" }));

  /* marketing setup */
  def.coupons.forEach(([code, kind, value, min, max]) => {
    t.coupons.push(row<E.Coupon>("cp", {
      code, kind, value: kind === "pct" ? value : P(value), max_discount: max == null ? null : P(max), min_order: P(min),
      valid_from: ymd(addDays(now, -60)), valid_to: ymd(addDays(now, 60)), usage_limit_total: 500, usage_limit_per_customer: code.startsWith("FIRST") ? 1 : 5,
      used_count: int(5, 80), order_types: [], item_ids: [], active: true,
    }));
  });
  const plan = row<E.MembershipPlan>("mp", { name: `${def.name} Gold`, price: P(999), validity_days: 365, discount_pct: 10, free_item_id: menu[0].item.id, benefits: "10% off every bill and one free item on your birthday.", active: true });
  t.membership_plans.push(plan);
  for (const c of customers.slice(0, 5)) t.memberships.push(row<E.Membership>("mb", { plan_id: plan.id, customer_id: c.id, starts_on: ymd(addDays(now, -int(30, 330))), ends_on: ymd(addDays(now, int(5, 300))), status: "active" }));
  t.membership_plans.push(row<E.MembershipPlan>("mp", { name: "Student pass", price: P(299), validity_days: 90, discount_pct: 5, free_item_id: null, benefits: "5% off on weekdays.", active: true }));
  for (let i = 0; i < 4; i++) {
    const v = pick([500, 1000, 2000]);
    t.gift_cards.push(row<E.GiftCard>("gc", { code: `GIFT-${int(1000, 9999)}-${int(1000, 9999)}`, initial_value: P(v), balance: P(i === 0 ? v : int(0, v)), customer_id: customers[i + 3].id, expires_on: ymd(addDays(now, 300)), active: true }));
  }
  t.gift_cards.push(row<E.GiftCard>("gc", { code: "GIFT-DEMO-0500", initial_value: P(500), balance: P(500), customer_id: demo.id, expires_on: ymd(addDays(now, 200)), active: true }));
  const firstCat = t.categories.filter((c) => c.tenant_id === tenantId)[0];
  t.offers.push(
    row<E.Offer>("of", { name: "Happy hour", kind: "happy_hour", description: "15% off 3–6 pm on weekdays", discount_pct: 15, days: [1, 2, 3, 4, 5], start_time: "15:00", end_time: "18:00", item_ids: menu.filter((m) => m.item.category_id === firstCat.id).map((m) => m.item.id), buy_qty: 0, get_qty: 0, combo_price: null, active: true }),
    row<E.Offer>("of", { name: "Buy 2 get 1", kind: "bxgy", description: `Buy 2 ${menu[0].item.name}, get 1 free`, discount_pct: 0, days: [0, 6], start_time: "00:00", end_time: "23:59", item_ids: [menu[0].item.id], buy_qty: 2, get_qty: 1, combo_price: null, active: true }),
  );

  /* history: 30 days of orders */
  const typeWeights = Object.entries(def.mix) as [E.OrderType, number][];
  const pickType = () => {
    let x = r();
    for (const [k, w] of typeWeights) if ((x -= w) <= 0) return k;
    return typeWeights[0][0];
  };
  const tax = t.tax_settings.find((x) => x.tenant_id === tenantId)!;
  const ds = t.delivery_settings.find((x) => x.tenant_id === tenantId)!;
  const counter = (name: string, v: number) => t.counters.push({ id: `${tenantId}:${name}`, tenant_id: tenantId, name, value: v });
  let orderNo = 1000;
  let kotNo = 100;
  let invNo = 0;
  const [oh] = def.open.split(":").map(Number);
  const [ch] = def.close.split(":").map(Number);
  const peaks = [oh + 1, 13, 17, 20].filter((h) => h >= oh && h < ch);

  for (let d = 29; d >= 0; d--) {
    const day = addDays(now, -d);
    const weekend = [0, 6].includes(day.getDay());
    const n = Math.round(def.ordersPerDay * (weekend ? 1.3 : 1) * (0.75 + r() * 0.5) * (d === 0 ? Math.min(1, (now.getHours() - oh) / (ch - oh)) : 1));
    for (let k = 0; k < Math.max(0, n); k++) {
      const hour = chance(0.6) ? pick(peaks) : int(oh, ch - 1);
      const at = atTime(day, hour, int(0, 59));
      if (at > now) continue;
      let type = pickType();
      const live = d === 0 && now.getTime() - at.getTime() < 40 * 60000;
      const table = type === "dine_in" && tables.length ? (live ? tables.find((x) => x.status === "free") ?? null : pick(tables)) : null;
      if (type === "dine_in" && !table) type = "takeaway";
      const lines = Array.from({ length: int(1, 4) }, () => {
        const m = pick(menu.filter((x) => x.item.in_stock));
        const v = m.variants.length ? pick(m.variants) : null;
        return { m, v, qty: chance(0.7) ? 1 : int(2, 3) };
      });
      const cust = chance(type === "delivery" ? 1 : 0.55) ? pick(customers) : null;
      const priceLines = lines.map((l) => ({ item_id: l.m.item.id, unit_price: l.v ? l.v.price : l.m.item.price, qty: l.qty, gst_rate: tax.default_gst_rate }));
      const sub = priceLines.reduce((s, l) => s + l.unit_price * l.qty, 0);
      const coupon = chance(0.08) ? t.coupons.find((c) => c.tenant_id === tenantId) ?? null : null;
      const q = priceOrder({ lines: priceLines, order_type: type, tax, coupon, delivery_charge: type === "delivery" ? (ds.charge_type === "flat" ? ds.flat_charge : sub < P(299) ? P(40) : sub < P(599) ? P(25) : 0) : 0 });
      const status: E.OrderStatus = live ? pick(["placed", "accepted", "preparing", "preparing", "ready"] as const) : "completed";
      const paid = !live || type === "delivery" || chance(0.3);
      const method: E.PaymentMode = type === "delivery" ? pick(["online", "online", "cod", "upi_on_delivery"] as const) : pick(["cash", "upi", "upi", "card"] as const);
      const captain = type === "dine_in" && captains.length ? pick(captains) : null;
      const order = row<E.Order>("or", {
        number: `O-${++orderNo}`, token: type === "counter" ? (k % 99) + 1 : null, type, channel: type === "dine_in" ? (chance(0.3) && def.type !== "qsr" ? "qr" : "captain") : type === "delivery" ? "app" : "pos",
        status, payment_status: paid ? "paid" : "unpaid", payment_method: paid ? method : null, customer_id: cust?.id ?? null, customer_name: cust?.name ?? null,
        customer_phone: cust?.phone ?? null, table_id: table?.id ?? null, table_session_id: null, guests: table ? int(1, table.seats) : null,
        captain_id: captain?.id ?? null, cashier_id: cashier.id, address_text: type === "delivery" ? `House ${int(1, 99)}, ${pick(["Zoo Road", "Beltola", "Sector V", "Hill Cart Road", "Laitumkhrah"])}, ${def.city}` : null,
        pickup_time: type === "takeaway" ? `${String(hour).padStart(2, "0")}:${pick(["15", "30", "45"])}` : null, note: chance(0.1) ? "Less spicy" : "",
        coupon_code: coupon && !q.coupon_error ? coupon.code : null, points_redeemed: 0, gift_card_code: null, subtotal: q.subtotal, discount: q.discount,
        service_charge: q.service_charge, tax: q.tax, delivery_charge: q.delivery_charge, packaging: 0, tip: 0, round_off: q.round_off, total: q.total,
        delivery_otp: type === "delivery" ? String(int(1000, 9999)) : null, idempotency_key: null, bill_requested: false,
        accepted_at: iso(new Date(at.getTime() + 60000)), ready_at: status === "completed" || status === "ready" ? iso(new Date(at.getTime() + int(6, 18) * 60000)) : null,
        completed_at: status === "completed" ? iso(new Date(at.getTime() + int(20, 55) * 60000)) : null,
      }, at, captain?.id ?? cashier.id);
      t.orders.push(order);

      // KOT per station
      const byStation = new Map<E.Station, typeof lines>();
      for (const l of lines) {
        const st = t.categories.find((c) => c.id === l.m.item.category_id)!.station;
        byStation.set(st, [...(byStation.get(st) ?? []), l]);
      }
      for (const [station, ls] of byStation) {
        const kotStatus: E.KOT["status"] = status === "completed" ? "served" : status === "ready" ? "ready" : status === "preparing" ? "preparing" : "new";
        const prep = int(4, 17);
        const kot = row<E.KOT>("kt", {
          order_id: order.id, number: ++kotNo, station, status: kotStatus, table_name: table?.name ?? null, order_type: type,
          started_at: kotStatus !== "new" ? iso(new Date(at.getTime() + 90000)) : null, ready_at: kotStatus === "ready" || kotStatus === "served" ? iso(new Date(at.getTime() + prep * 60000)) : null, printed: true,
        }, at);
        if (status === "placed") continue;
        t.kots.push(kot);
        for (const l of ls) {
          t.order_items.push(row<E.OrderItem>("oi", {
            order_id: order.id, item_id: l.m.item.id, variant_id: l.v?.id ?? null, name: l.m.item.name, variant_name: l.v?.name ?? null, add_ons: [],
            unit_price: l.v ? l.v.price : l.m.item.price, qty: l.qty, gst_rate: tax.default_gst_rate, note: "", course: null, kot_id: kot.id,
            status: kotStatus === "served" ? "served" : kotStatus === "new" ? "sent" : kotStatus, complimentary: false,
          }, at));
        }
      }
      if (status === "placed") {
        for (const l of lines) t.order_items.push(row<E.OrderItem>("oi", { order_id: order.id, item_id: l.m.item.id, variant_id: l.v?.id ?? null, name: l.m.item.name, variant_name: l.v?.name ?? null, add_ons: [], unit_price: l.v ? l.v.price : l.m.item.price, qty: l.qty, gst_rate: tax.default_gst_rate, note: "", course: null, kot_id: null, status: "new", complimentary: false }, at));
      }

      // live dine-in → occupy the table
      if (live && table) {
        const sess = row<E.TableSession>("ts", { table_id: table.id, guests: order.guests ?? 2, captain_id: captain?.id ?? null, customer_id: cust?.id ?? null, opened_at: iso(at), closed_at: null, waiter_called_at: null }, at);
        t.table_sessions.push(sess);
        table.status = "occupied";
        table.current_session_id = sess.id;
        order.table_session_id = sess.id;
      }

      if (paid && status === "completed") {
        invNo++;
        const inv = row<E.Invoice>("iv", {
          order_id: order.id, number: `${tax.invoice_prefix}${financialYear(at).slice(2)}/${String(invNo).padStart(6, "0")}`, financial_year: financialYear(at),
          bill_of_supply: q.bill_of_supply, subtotal: q.subtotal, discount: q.discount, service_charge: q.service_charge, taxable: q.taxable,
          cgst: q.tax_lines.reduce((s, x) => s + x.cgst, 0), sgst: q.tax_lines.reduce((s, x) => s + x.sgst, 0), round_off: q.round_off, total: q.total,
          cashier_id: cashier.id, shift_id: null, reprints: 0,
        }, new Date(order.completed_at!));
        t.invoices.push(inv);
        for (const tl of q.tax_lines) t.invoice_taxes.push(row<E.InvoiceTax>("ivt", { invoice_id: inv.id, rate: tl.rate, taxable: tl.taxable, cgst: tl.cgst, sgst: tl.sgst }, at));
        t.payments.push(row<E.Payment>("py", { invoice_id: inv.id, order_id: order.id, mode: method, amount: q.total, reference: method === "cash" ? null : `TXN${int(100000, 999999)}`, status: "success", gateway: method === "online" ? "dummy" : null, shift_id: null }, at));
        if (cust) {
          cust.visits++;
          cust.total_spend += q.total;
          cust.last_visit_at = order.completed_at;
          const pts = pointsEarned(q.taxable, 10);
          cust.loyalty_points += pts;
          if (pts) t.loyalty_ledger.push(row<E.LoyaltyLedger>("ll", { customer_id: cust.id, order_id: order.id, points: pts, reason: "earn", expires_at: iso(addDays(at, 365)) }, at));
        }
        if (chance(0.25)) {
          const lo = chance(0.15);
          t.feedback.push(row<E.Feedback>("fb", { order_id: order.id, customer_id: cust?.id ?? null, food: lo ? int(1, 2) : int(4, 5), service: lo ? int(1, 3) : int(3, 5), ambience: int(3, 5), comment: lo ? pick(["A bit slow today.", "Food was cold on arrival.", "Too salty."]) : pick(COMMENTS), replied: !lo }, new Date(order.completed_at!)));
        }
      }
      if (type === "delivery" && riders.length) {
        const rd = pick(riders);
        const done = status === "completed";
        t.deliveries.push(row<E.Delivery>("dl", {
          order_id: order.id, rider_id: done || status === "ready" ? rd.id : null, status: done ? "delivered" : "unassigned", charge: q.delivery_charge,
          distance_km: Math.round((1 + r() * 6) * 10) / 10, to_collect: method === "cod" || method === "upi_on_delivery" ? q.total : 0,
          collected: done && (method === "cod" || method === "upi_on_delivery") ? q.total : 0, collected_mode: done ? (method === "cod" ? "cash" : method === "upi_on_delivery" ? "upi" : null) : null,
          proof: done ? "otp" : null, accepted_at: done ? order.accepted_at : null, picked_at: done ? iso(new Date(at.getTime() + 18 * 60000)) : null, delivered_at: done ? order.completed_at : null,
        }, at));
      }
    }
  }
  counter("order", orderNo);
  counter("kot", kotNo);
  counter("invoice", invNo);
  counter("token", 1);

  /* customer tags */
  for (const c of customers) {
    const days = c.last_visit_at ? (now.getTime() - new Date(c.last_visit_at).getTime()) / 86400000 : 999;
    c.tags = [c.total_spend > P(4000) ? "vip" : null, c.visits >= 3 ? "regular" : null, c.visits <= 1 ? "new" : null, days > 21 ? "lapsed" : null].filter(Boolean) as E.CustomerTag[];
  }

  /* dine-in extras */
  if (features.reservations) {
    const free = tables.filter((x) => x.status === "free");
    [["Ankur Mehta", 19, 30, 4], ["Shalini Bose", 20, 0, 6], ["Kunal Roy", 21, 0, 2]].forEach(([n, h, m, ps], i) => {
      const res = row<E.Reservation>("rs", { customer_id: null, name: n as string, phone: `+91 98${int(10000000, 99999999)}`, date: ymd(i === 2 ? addDays(now, 1) : now), time: `${h}:${String(m).padStart(2, "0")}`, party_size: ps as number, table_preference: i === 1 ? "Window, family section" : "", table_id: free[i]?.id ?? null, notes: i === 0 ? "Anniversary dinner" : "", status: i === 0 ? "confirmed" : "booked" });
      t.reservations.push(res);
    });
    if (free[0]) free[0].status = "reserved";
    if (free[3]) free[3].status = "cleaning";
  }
  if (features.waitlist) {
    t.waitlist_entries.push(
      row<E.WaitlistEntry>("wl", { name: "Arindam Sen", phone: "+91 98300 11122", party_size: 4, quoted_wait_min: 15, status: "waiting", table_id: null }, new Date(now.getTime() - 8 * 60000)),
      row<E.WaitlistEntry>("wl", { name: "Lalita Devi", phone: "+91 94350 33344", party_size: 2, quoted_wait_min: 10, status: "waiting", table_id: null }, new Date(now.getTime() - 3 * 60000)),
    );
  }
  const occupied = tables.find((x) => x.status === "occupied");
  if (occupied) {
    const o = t.orders.find((x) => x.table_id === occupied.id && x.status !== "completed");
    if (o) {
      o.bill_requested = true;
      occupied.status = "bill_requested";
    }
  }

  /* purchase flow */
  const low = [...mats.values()].filter((m) => m.stock < m.min_level);
  const pr = row<E.PurchaseRequest>("pq", { number: "PR-0012", lines: low.slice(0, 3).map((m) => ({ raw_material_id: m.id, qty: m.min_level * 2, note: "" })), status: "pending", estimated_value: low.slice(0, 3).reduce((s, m) => s + m.min_level * 2 * m.last_cost, 0) }, addDays(now, -1), userBy("storekeeper").id);
  t.purchase_requests.push(pr);
  t.approvals.push(row<E.Approval>("ap", { kind: "purchase_request", ref_id: pr.id, amount: pr.estimated_value, summary: `Purchase request ${pr.number} · ${pr.lines.length} items`, requested_by: userBy("storekeeper").id, status: "pending", decided_by: null, decided_at: null, required_role: "manager" }, addDays(now, -1)));
  for (const s of suppliers) {
    const qt = row<E.Quotation>("qt", { purchase_request_id: pr.id, supplier_id: s.id, received_on: ymd(now) });
    t.quotations.push(qt);
    for (const l of pr.lines) {
      const m = t.raw_materials.find((x) => x.id === l.raw_material_id)!;
      t.quotation_lines.push(row<E.QuotationLine>("ql", { quotation_id: qt.id, raw_material_id: m.id, rate: Math.round(m.last_cost * (0.9 + r() * 0.25)) }));
    }
  }
  const s0 = suppliers[0];
  const poMats = [...mats.values()].filter((m) => m.supplier_id === s0.id).slice(0, 3);
  const mkPO = (num: string, status: E.PurchaseOrder["status"], daysAgo: number) => {
    const po = row<E.PurchaseOrder>("po", { number: num, supplier_id: s0.id, purchase_request_id: null, status, expected_on: ymd(addDays(now, -daysAgo + 2)), total: 0 }, addDays(now, -daysAgo), userBy("manager").id);
    t.purchase_orders.push(po);
    const lines = poMats.map((m) => row<E.POLine>("pol", { purchase_order_id: po.id, raw_material_id: m.id, qty: m.min_level * 3, rate: m.last_cost, received_qty: status === "received" ? m.min_level * 3 : 0 }));
    t.po_lines.push(...lines);
    po.total = lines.reduce((s, l) => s + Math.round(l.qty * l.rate), 0);
    return { po, lines };
  };
  const done = mkPO("PO-0041", "received", 9);
  mkPO("PO-0042", "sent", 1);
  const grn = row<E.GRN>("gr", { number: "GRN-0031", purchase_order_id: done.po.id, supplier_id: s0.id, received_on: ymd(addDays(now, -7)), total: done.po.total, invoice_ref: `INV-${int(1000, 9999)}` }, addDays(now, -7));
  t.grns.push(grn);
  for (const l of done.lines) t.grn_lines.push(row<E.GRNLine>("grl", { grn_id: grn.id, po_line_id: l.id, raw_material_id: l.raw_material_id, received_qty: l.qty, rate: l.rate, batch: null, expiry: null, shortfall: 0 }, addDays(now, -7)));
  s0.outstanding = done.po.total - Math.round(done.po.total / 2);
  t.supplier_payments.push(row<E.SupplierPayment>("spy", { supplier_id: s0.id, amount: Math.round(done.po.total / 2), mode: "upi", reference: `UPI${int(100000, 999999)}`, paid_on: ymd(addDays(now, -5)) }));
  t.wastage.push(row<E.Wastage>("ws", { raw_material_id: [...mats.values()][0].id, item_id: null, qty: 0.5, unit: [...mats.values()][0].unit === "L" ? "L" : [...mats.values()][0].unit, reason: "spoiled", note: "Left out overnight", value: Math.round(0.5 * [...mats.values()][0].avg_cost) }, addDays(now, -2), userBy("kitchen").id));

  /* expenses + budgets */
  const cats = [["Rent", 45000], ["Electricity", 9000], ["Gas", 6000], ["Salary", 0], ["Marketing", 5000], ["Repairs", 3000], ["Misc", 4000]] as const;
  const month = ymd(now).slice(0, 7);
  for (const [name, budget] of cats) {
    const ec = row<E.ExpenseCategory>("ec", { name, monthly_budget: P(budget) });
    t.expense_categories.push(ec);
    if (budget) t.budgets.push(row<E.Budget>("bg", { category_id: ec.id, month, amount: P(budget) }));
    for (let m = 0; m < 2; m++) {
      const md = addDays(now, -m * 30);
      if (name === "Rent") t.expenses.push(row<E.Expense>("ex", { category_id: ec.id, amount: P(45000), mode: "bank", spent_on: ymd(new Date(md.getFullYear(), md.getMonth(), 1)), note: "Monthly rent", bill_photo_url: null, status: "approved", petty_cash: false }, md, owner.id));
      if (["Electricity", "Gas", "Marketing", "Repairs", "Misc"].includes(name)) {
        for (let j = 0; j < (name === "Misc" ? 5 : 2); j++) {
          const sd = addDays(md, -int(0, 25));
          if (sd > now) continue;
          t.expenses.push(row<E.Expense>("ex", { category_id: ec.id, amount: P(int(budget / 6, budget / 2)), mode: pick(["cash", "upi"] as const), spent_on: ymd(sd), note: pick(["Cylinder refill", "Bulb replacement", "Instagram boost", "Cleaning supplies", "Electric bill"]), bill_photo_url: null, status: "approved", petty_cash: name === "Misc" }, sd, cashier.id));
        }
      }
    }
  }
  const pend = row<E.Expense>("ex", { category_id: t.expense_categories.find((c) => c.tenant_id === tenantId && c.name === "Repairs")!.id, amount: P(7800), mode: "upi", spent_on: ymd(now), note: "Fridge compressor repair", bill_photo_url: null, status: "pending", petty_cash: false }, now, userBy("manager").id);
  t.expenses.push(pend);
  t.approvals.push(row<E.Approval>("ap", { kind: "expense", ref_id: pend.id, amount: pend.amount, summary: "Expense · Fridge compressor repair", requested_by: userBy("manager").id, status: "pending", decided_by: null, decided_at: null, required_role: "owner" }, now));

  /* staff: attendance, advances, salary */
  for (const u of users) {
    if (u.role === "owner") continue;
    for (let d = 29; d >= 0; d--) {
      const day = addDays(now, -d);
      const prof = t.staff_profiles.find((p) => p.user_id === u.id)!;
      const off = day.getDay() === prof.weekly_off;
      const absent = !off && chance(0.05);
      const inAt = atTime(day, oh, int(0, 25));
      const today = d === 0;
      t.attendance.push(row<E.Attendance>("at", {
        user_id: u.id, date: ymd(day), clock_in: off || absent ? null : iso(inAt), clock_out: off || absent || today ? null : iso(atTime(day, ch, int(0, 40))),
        selfie_url: null, status: off ? "weekly_off" : absent ? "absent" : "present", overtime_min: !off && !absent && chance(0.15) ? int(30, 120) : 0, correction_note: null,
      }, day));
    }
  }
  const capt = captains[0] ?? cashier;
  t.advances.push(row<E.Advance>("av", { user_id: capt.id, amount: P(2000), given_on: ymd(addDays(now, -12)), note: "Festival advance", recovered: false }));
  const prevMonth = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  for (const u of users.filter((x) => x.role !== "owner")) {
    const prof = t.staff_profiles.find((p) => p.user_id === u.id)!;
    const gross = prof.salary_type === "monthly" ? prof.salary_amount : prof.salary_amount * 26;
    t.salary_slips.push(row<E.SalarySlip>("ss", { user_id: u.id, month: prevMonth, days_present: 26, overtime_pay: 0, gross, advances: 0, deductions: 0, delivery_earnings: 0, net: gross, paid: true }));
  }

  /* aggregators */
  const platforms = [
    row<E.AggregatorPlatform>("ag", { name: "Swiggy", commission_pct: 22, pg_fee_pct: 1.84, tcs_pct: 1, tds_pct: 0.1 }),
    row<E.AggregatorPlatform>("ag", { name: "Zomato", commission_pct: 20, pg_fee_pct: 1.84, tcs_pct: 1, tds_pct: 0.1 }),
  ];
  t.aggregator_platforms.push(...platforms);
  if (features.aggregator_tracker) {
    for (let w = 4; w >= 1; w--) {
      for (const p of platforms) {
        const gross = P(int(18000, 42000) * (def.type === "cloud_kitchen" ? 2 : 1));
        const e = row<E.AggregatorEntry>("ae", {
          platform_id: p.id, period_from: ymd(addDays(now, -w * 7)), period_to: ymd(addDays(now, -w * 7 + 6)), orders: int(60, 180),
          gross_sales: gross, outlet_discount: Math.round(gross * 0.06), packaging: Math.round(gross * 0.03), ads: P(int(500, 2500)), other_deductions: P(int(0, 400)), commission_pct: p.commission_pct,
        }, addDays(now, -w * 7 + 7));
        t.aggregator_entries.push(e);
        if (w > 1) t.aggregator_payouts.push(row<E.AggregatorPayout>("apo", { entry_id: e.id, received_on: ymd(addDays(now, -w * 7 + 10)), amount: Math.round(gross * 0.66), reference: `NEFT${int(100000, 999999)}` }));
      }
    }
  }

  /* messages, audit, notifications */
  t.audit_logs.push(
    row<E.AuditLog>("au", { user_id: userBy("manager").id, user_name: userBy("manager").name, action: "void", entity: "order_item", entity_id: null, device: "Counter tablet", old_value: { qty: 2 }, new_value: { qty: 1, reason: "Customer changed mind" } }, addDays(now, -1)),
    row<E.AuditLog>("au", { user_id: owner.id, user_name: owner.name, action: "price_change", entity: "item", entity_id: menu[0].item.id, device: "Owner phone", old_value: { price: menu[0].item.price - P(5) }, new_value: { price: menu[0].item.price } }, addDays(now, -6)),
    row<E.AuditLog>("au", { user_id: cashier.id, user_name: cashier.name, action: "reprint", entity: "invoice", entity_id: null, device: "Counter tablet", old_value: null, new_value: { reprints: 1 } }, addDays(now, -3)),
    row<E.AuditLog>("au", { user_id: userBy("manager").id, user_name: userBy("manager").name, action: "discount", entity: "order", entity_id: null, device: "Counter tablet", old_value: null, new_value: { pct: 15, reason: "Regular customer" } }, addDays(now, -2)),
  );
  t.notifications.push(row<E.Notification>("nt", { audience: "owner", user_id: null, title: "Pending approvals", body: "1 purchase request and 1 expense need your approval.", link: "/admin/approvals", read: false }, now));
}

/** Public tenant directory used by the PWA manifest route and dev tenant switcher (no private data). */
export const DEMO_TENANTS = CAFES.map((c) => ({ slug: c.slug, name: c.name, type: c.type, city: c.city, primary: c.primary, accent: c.accent, short: c.name.split(" ")[0] }));

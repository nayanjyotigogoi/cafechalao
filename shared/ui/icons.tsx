import type { ReactNode } from "react";
import { cx } from "@/shared/lib/format";

/**
 * CafeChalao icon set: rounded line icons in the text colour with a soft fill in the café's accent
 * (strawberry pink by default). One look on every phone, in light and dark mode, instead of emoji.
 * Drawn on a 24×24 grid; `t` = tinted shapes (drawn first), `s` = the outline on top.
 */
const T = (d: string) => <path d={d} fill="var(--accent)" stroke="none" />;
const S = (d: string) => <path d={d} />;

const ICONS: Record<string, ReactNode> = {
  /** Bowl with steam: menu, dine-in */
  menu: <>{T("M4 12h16a8 8 0 0 1-16 0Z")}{S("M3 12h18")}{S("M4 12a8 8 0 0 0 16 0")}{S("M9.5 8.5c-.8-1 .8-2-.1-3.2")}{S("M14.5 8.5c-.8-1 .8-2-.1-3.2")}{S("M9 20.5h6")}</>,
  /** Shopping bag with a smile: order online, takeaway */
  bag: <>{T("M5.5 8h13l-1 12.5h-11Z")}{S("M5.5 8h13l-1 12.5h-11Z")}{S("M9 8V7a3 3 0 0 1 6 0v1")}{S("M10 13.5a2 2 0 0 0 4 0")}</>,
  /** Scooter with a delivery box */
  scooter: <>{T("M4.5 3.5h5.5v5H4.5Z")}{S("M4.5 3.5h5.5v5H4.5Z")}{T("M3 15.5a5 5 0 0 1 5-5h3.5l1.5 5Z")}{S("M3 15.5a5 5 0 0 1 5-5h3.5l1.5 5Z")}{S("M13 15.5h3.2")}{S("M18.5 17 16.3 6.5H14")}<circle cx="6.5" cy="18" r="2.3" /><circle cx="18.5" cy="18" r="2.3" /></>,
  /** Receipt: orders, bills */
  receipt: <>{T("M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21Z")}{S("M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21Z")}{S("M9 8h6")}{S("M9 11.5h6")}{S("M9 15h3")}</>,
  /** Calendar with a heart: book a table, reservations */
  calendar: <>{T("M4 9h16V8a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3Z")}<rect x="4" y="5" width="16" height="15" rx="3" />{S("M4 9.5h16")}{S("M8 3v4")}{S("M16 3v4")}{T("M12 17.5l-2.1-2.1a1.3 1.3 0 0 1 2.1-1.6 1.3 1.3 0 0 1 2.1 1.6Z")}</>,
  /** Person: profile */
  user: <>{T("M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z")}<circle cx="12" cy="8" r="3.5" />{S("M5 20.5a7 7 0 0 1 14 0")}</>,
  /** Bars: dashboard */
  chart: <>{T("M10 9h4v11h-4Z")}{S("M4 20.5h16")}<rect x="5" y="13" width="3.5" height="7" rx="1.2" /><rect x="10.2" y="8.5" width="3.6" height="11.5" rx="1.2" /><rect x="15.5" y="4.5" width="3.5" height="15.5" rx="1.2" /></>,
  /** Table QR code: tables & QR */
  qr: <>{T("M4 4h6v6H4Z")}<rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" />{S("M14 14h2.5v2.5H14Z")}{S("M19 14v1")}{S("M14 19.5h1")}{S("M17.5 17.5H20V20h-2.5Z")}</>,
  /** Two people: customers */
  users: <>{T("M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z")}<circle cx="9" cy="8" r="3" />{S("M3.5 19.5a5.5 5.5 0 0 1 11 0")}{S("M15.5 5.3a3 3 0 0 1 0 5.4")}{S("M17 14.5a5.5 5.5 0 0 1 3.5 5")}</>,
  /** Gift: marketing, offers */
  gift: <>{T("M5 11h14v9.5H5Z")}<rect x="3.5" y="7.5" width="17" height="4" rx="1.2" />{S("M5 11.5v9h14v-9")}{S("M12 7.5v13")}{S("M12 7.5C10.5 4 7.5 4.5 8 6.5 8.3 7.5 12 7.5 12 7.5Z")}{S("M12 7.5c1.5-3.5 4.5-3 4-1-.3 1-4 1-4 1Z")}</>,
  /** Box: stock & purchase */
  box: <>{T("M4 8l8 4 8-4v9l-8 4-8-4Z")}{S("M4 8l8-4 8 4-8 4Z")}{S("M4 8v9l8 4 8-4V8")}{S("M12 12v9")}</>,
  /** Wallet: expenses */
  wallet: <>{T("M4 8h16v11.5H4Z")}<rect x="3.5" y="7" width="17" height="13" rx="3" />{S("M6 7l9-3.5 1.5 3.5")}{S("M15 12.5h5.5v4H15a2 2 0 0 1 0-4Z")}</>,
  /** Chef hat: staff */
  chef: <>{T("M7 13a4 4 0 0 1 .9-7.9 4.2 4.2 0 0 1 8.2 0A4 4 0 0 1 17 13Z")}{S("M7 13a4 4 0 0 1 .9-7.9 4.2 4.2 0 0 1 8.2 0A4 4 0 0 1 17 13")}{S("M7 13v6.5h10V13")}{S("M7 16.5h10")}</>,
  /** Phone: aggregators */
  phone: <>{T("M7.5 3.5h9v4h-9Z")}<rect x="6.5" y="2.5" width="11" height="19" rx="3" />{S("M10.5 18.5h3")}</>,
  /** Rising line: reports */
  trend: <>{T("M4 20l5-7 4 3 7-8v12Z")}{S("M4 15.5l5-5 4 3 7-7.5")}{S("M15.5 6H20v4.5")}{S("M4 20.5h16")}</>,
  /** Check in a circle: approvals, done */
  check: <>{T("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z")}<circle cx="12" cy="12" r="9" />{S("M8 12.3l2.7 2.7L16 9.5")}</>,
  /** Magnifier: search, audit */
  search: <>{T("M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z")}<circle cx="10.5" cy="10.5" r="6.5" />{S("M15.5 15.5l5 5")}</>,
  /** Cog: settings */
  gear: <>{T("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z")}<circle cx="12" cy="12" r="3" />{S("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1")}<circle cx="12" cy="12" r="6.5" /></>,
  /** Bell: alerts, call waiter */
  bell: <>{T("M6 16.5V11a6 6 0 0 1 12 0v5.5Z")}{S("M5 16.5h14l-1-1.5V11a6 6 0 0 0-12 0v4Z")}{S("M10 19.5a2 2 0 0 0 4 0")}{S("M12 3v2")}</>,
  /** Map pin: address */
  pin: <>{T("M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11Z")}{S("M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11Z")}<circle cx="12" cy="10" r="2.3" /></>,
  /** Camera: upload a photo */
  camera: <>{T("M3.5 9h17v10h-17Z")}<rect x="3" y="7" width="18" height="13" rx="3" />{S("M8.5 7l1.5-2.5h4L15.5 7")}<circle cx="12" cy="13.5" r="3.2" /></>,
  /** Light bulb: tips */
  bulb: <>{T("M12 3.5a6 6 0 0 0-3.5 10.9V16h7v-1.6A6 6 0 0 0 12 3.5Z")}{S("M12 3.5a6 6 0 0 0-3.5 10.9V16h7v-1.6A6 6 0 0 0 12 3.5Z")}{S("M9.5 19h5")}{S("M10.5 21.5h3")}</>,
  /** Cake: birthday */
  cake: <>{T("M4.5 13h15v7.5h-15Z")}<rect x="4" y="12" width="16" height="8.5" rx="2" />{S("M4 15.5c2 1.3 3.3 1.3 5.3 0s3.4-1.3 5.4 0 3.3 1.3 5.3 0")}{S("M12 12V8.5")}{S("M12 6.5c-1-1 0-2.5 0-3 0 .5 1 2 0 3Z")}</>,
  /** Flower: anniversary */
  flower: <>{T("M12 10.5a3 3 0 1 1 0-6 3 3 0 1 1 0 6Z")}<circle cx="12" cy="7.5" r="3" /><circle cx="8.3" cy="10.8" r="2.6" /><circle cx="15.7" cy="10.8" r="2.6" />{S("M12 13v8")}{S("M12 18c-2.5 0-3.5-1.5-4-3 2 0 3.5.8 4 3Z")}</>,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={cx("inline-block shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

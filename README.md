# CafeChalao: frontend

CafeChalao is a white-label app for cafés and restaurants in India. One café's website runs everything:

- **Guests:** the menu and online ordering (delivery and takeaway), and dine-in by scanning the table's QR. They pay with the café's own UPI QR, and see and print their bills.
- **Staff:**
  - **POS:** billing, payments and open bills.
  - **Captain:** waiter app for tables.
  - **Kitchen display:** live KOTs.
  - **Rider:** deliveries confirmed with the customer's OTP.
- **Owner and manager:** the admin area for:
  - Menu, recipes, stock and purchase orders.
  - Staff, attendance and salaries.
  - Offers, customers and reports.
  - Settings: branding, GST, payments and delivery.
- **CafeChalao team:** a Control Panel (`/control`) to onboard new cafés.

This repository is the **frontend**: a Next.js 15 PWA (TypeScript, Tailwind CSS 4), installable on phones and tablets. The Laravel API it talks to is in a separate repository: **[CC-BEND](https://github.com/nayanjyotigogoi/CC-BEND)**.

## Run it locally

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 3001
```

Open http://localhost:3001. What `.env.local` controls:

| Setting | Meaning |
| --- | --- |
| `NEXT_PUBLIC_API_MODE` | `http`: use the Laravel API at `NEXT_PUBLIC_API_URL`. `mock`: no backend needed; a complete fake API with four demo cafés runs inside the browser. |
| `NEXT_PUBLIC_API_URL` | The API's address, e.g. `http://localhost:8000` |
| `NEXT_PUBLIC_DEFAULT_TENANT` | The café this site shows (its slug, e.g. `cafe-1bhk`) |
| `NEXT_PUBLIC_TENANT_LOCKED` | `true` in production: the site always shows that one café. Locally `false`, and `?outlet=<slug>` in the address switches café. |

## Signing in

| Who | How |
| --- | --- |
| Guests | Email (an account is made on first use) or phone OTP. In demo mode the code is always `123456` and is shown on screen. |
| Staff | **Employee ID + PIN** at `/staff`. Staff names are never listed: each person types their ID (E001, E002, … shown in Admin → Staff) the first time, then that device remembers them. |
| New café owner | Employee ID **E001**. There is no default PIN: they confirm a code sent to their mobile and choose their own. |
| Rider | Phone number + OTP at `/rider` |
| Control Panel | `/control`, email + code |

## Production (Docker)

The site is built into a small Node server image (`Dockerfile`). `NEXT_PUBLIC_*` values are baked in when the image is built, so each café's site is built with its own values. `.env.production.example` explains them.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This serves the site on `127.0.0.1:3000`. HTTPS for `https://tohfaah.com` comes from the Caddy proxy in the backend repository, which forwards that domain to this port. Deploy the backend first; see its README.

## Folder layout

```text
app/
  (customer)/        menu, cart, login, orders, profile, reserve, t/[code] (table QR), bill/[id]
  (staff)/           staff login, pos, captain, kds, rider, admin/*
  control/           CafeChalao Control Panel
  demo/              demo launcher (mock mode)
modules/<module>/    api.ts + components, one folder per backend module
shared/
  api/               API client (mock | http), React Query hooks
  auth/              sessions for customer, staff, rider and control
  lib/               money, GST pricing, KPIs, units, permissions, formatting
  offline/           outbox with idempotency keys
  tenant/            café settings and theme (light and dark)
  types/             one interface per database table + API responses
  ui/                component library
  i18n/              English + Hindi
mock/                the in-browser fake API and its demo data
tests/unit/          Vitest: business rules, KPIs, API, café isolation
tests/e2e/           Playwright: main flows on phone and tablet
```

Screens never call `fetch` directly. They call `modules/<module>/api.ts`, which goes through `shared/api/client.ts`, so the same screens work against the mock or the real API.

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm test             # unit and API tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright; first run: npx playwright install chromium)
npm run typecheck
npm run seed:export  # writes seed-data/<table>.json: the demo cafés for the backend's seeder
```

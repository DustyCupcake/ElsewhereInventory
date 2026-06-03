# Elsewhere Inventory

An event-wide equipment management platform built for large-scale camp operations. Production staff manage a central equipment pool; departments check out equipment and sub-lend it to barrios, artists, or individual people. Every transaction is tracked with a full audit trail and offline-first QR scanning.

## Features

### Role system

The app uses a named-permission model. Base roles carry default permission sets; individual permissions can be granted or denied per user on top of their base role.

| Role | Default capabilities |
|---|---|
| `production_admin` | Everything |
| `production_staff` | Checkout/checkin to departments, view inventory, request water fills |
| `dept_admin` | Sub-checkout/sub-checkin to barrios/artists/persons, manage their sub-entities, create invite links, submit orders |
| `dept_staff` | Sub-checkout/sub-checkin (sub-lending depts only), view dept inventory, submit orders |

Shift sessions replace the old `validator` role — no persistent account is required for volunteers.

### Shift QR system

Production admins and dept admins create named **shifts** (e.g. "Wednesday Water Fill"). Each shift has a time window and a set of permissions. Admins generate one or more QR codes per shift and print them. A volunteer scans the QR, enters their name, and gets a temporary browser session with exactly the permissions defined for that shift — no account or password required.

- Shift QR sheet printable from the admin panel
- Same token can be re-scanned within the shift window (e.g. browser closed and reopened)
- Sessions expire automatically at the shift end time

### Invite tokens

User registration requires an invite link. Production admins can create links for any role; dept admins can create `dept_staff` links for their own department(s). Each link is single-use and has a configurable expiry.

The invite link pre-populates the role and department on the registration form. No admin activation step is needed — the account is created active.

### Two-tier equipment flow

Equipment moves through two tiers:

```
Production pool → Department pool → Barrio / Artist / Person
     (checkout)         (sub-checkout)
```

- **Production staff** check equipment out to a department (`POST /checkout`)
- **Dept staff** sub-lend from their department's pool to a barrio, artist, or person (`POST /sub-checkout`, `POST /sub-person-checkout`)
- **Check-in is automatic**: scanning a sub-lent item returns it to the dept pool; scanning a dept-pool item returns it to production. The same check-in button handles both tiers.
- Items carry a **dept label** (e.g. "Generator 1", "Sound Desk") set at checkout time or updated later with the label_equipment permission.

### Departments

Departments have a `sub_entity` type:

| Type | Sub-lends to |
|---|---|
| `barrio` | Barrios (theme camps) |
| `artist` | Artists |
| `none` | No sub-lending (internal dept only) |

The checkout UI automatically adapts to the logged-in user's department type.

### Artists

Art and creativity departments manage a list of artists (or artist cases). Each artist can have an assigned staff member. Equipment can be sub-lent to artists the same way it is to barrios.

### Person checkout (borrowing)

Certain equipment types (car keys, radios, etc.) can be marked **borrowable** and checked out to individual people rather than to a department or barrio.

- Users get a **personal QR code** (accessible from the admin user QR sheet or their profile)
- Scanning a person's QR from the checkout tab pre-selects them as the recipient
- Opening `/?person=<token>` in a browser navigates directly to a person-checkout flow
- Borrowable items show as "Available — check out to a person?" when scanned in the return tab
- If a borrowable item is already checked out to someone, scanning it in the return tab offers a **Transfer** option (return + re-checkout in one action)

**Borrow restrictions**: borrowability can be restricted by equipment type or individual item to an allowlist of departments and/or individual users. If no rules exist for a type/item, anyone with the relevant permission can borrow it.

### Equipment order form

Departments submit equipment orders (quantities requested by type) through an orders tab. Per equipment type:

- Quantities already ordered by this dept
- Items currently in the dept's inventory
- Order deadline set by production admin (ordering closes automatically)

Production admins see an aggregate pivot view across all departments. The Barrio Support department can pre-fill from the summed barrio equipment orders.

### QR scanning

- 3-step checkout flow: select entity (dept / barrio / artist / person) → scan items → confirm
- Equipment return with full-screen confirmation overlay, showing who currently holds the item
- Person search by name or direct QR scan for person checkout
- Manual code entry fallback for unreadable codes

### Water fill system

Replaces the old 2-QR physical voucher workflow with a persistent cube QR + digital fill request model.

**Concepts:**
- Each physical water cube has a QR code and is tracked as an `equipment_item` (type category `water_cube`). Cubes are checked out to barrios or NWP (the org managing scattered public cubes) at arrival.
- Entities have **fill credits** tracked in `barrio_entitlements` (consumable type `water_fill`). Credits are set by production at event setup or sold on-site by staff.
- Each cube has a **route position** — its numbered stop on the circular truck route.

**Requesting a fill:**
- **Self-service**: a barrio rep or NWP rep scans their entity QR or a cube QR in the app → selects how many fills (barrios) or which cube (NWP) → submits. Requires `request_fills` permission.
- **In-person at noinfo**: staff scans the barrio QR or looks up by name → sees their cubes and credit balance → creates the request. Barrios can also go in person and receive a color-coded backup sticker (different color each day) to place on their cube as a physical fallback.
- Blocked if 0 fill credits remain.

**Truck run:**
- When a truck crew shift starts, scanning their shift QR redirects to `/fill-route.html` where they choose **Clockwise (A→Z)** or **Counterclockwise (Z→A)**. The direction is locked in a `fill_run_claims` record so both trucks claim opposite directions automatically.
- The route view shows pending stops in order with a **next stop banner** at the top. Tapping the banner opens a full progress overlay (filled ✓ / next → / skipped ↷ / upcoming).
- Truck crew confirms fills by scanning the cube QR or tapping the stop row. If a scanned cube is not the expected next stop, an **out-of-order warning** shows which stops will be marked as skipped; the driver can confirm or cancel.
- **Sticker fallback** (no digital request): a "No request" button opens an ad-hoc confirm flow for cubes with a physical sticker but no digital fill request. Credits are used if available; the fill is logged as `fill_adhoc`.

**Public cube status page** (`/cube.html`):
- Anyone can scan a cube QR to see its entity, last fill time, and whether a fill is requested.
- Logged-in users with `request_fills` permission see a "Request fill" button if credits are available.

**Admin: Fill Route** (`/admin/#fill-route`):
- Drag-and-drop interface for setting route stop order (assigns `route_position` 1…N).
- Cubes not yet on the route are listed separately and can be dragged in.
- Accessible to `manage_barrios` or `manage_equipment` permission holders.

### Offline support

All checkout, check-in, and voucher validation operations queue locally when offline and sync automatically on reconnect. The service worker caches the app shell for instant load.

### Internationalisation

The full app UI is available in **English**, **Spanish**, and **French**. Language is stored per user account and can be changed at any time. All dynamically rendered strings, toasts, overlays, and admin panels are translated.

### Admin panel

- User management (create, edit, deactivate, reset passwords, assign dept roles, per-user permission overrides)
- Printable user QR sheet (for distributing personal checkout QR codes)
- Invite link management (create, list, revoke)
- Shift management (create shifts, generate QR tokens, print QR sheets)
- Equipment catalog (types + items, borrowable flag, borrow restriction rules, order deadlines)
- Department management (create, configure sub_entity type)
- Artist management (scoped to dept)
- Barrio configuration (entitlements, equipment orders, consumable types, CSV import)
- Aggregate dept orders view and barrio orders aggregate
- Bulk QR sheet for equipment labels
- **Fill Route** section: drag-and-drop route stop ordering for water cube fills

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES modules), HTML5, CSS3 |
| Backend | PHP 7.4+ with PDO |
| Database | MySQL 5.7+ or MariaDB 10.3+ |
| Offline | Service Worker + LocalStorage queue |
| QR Scanning | Native `BarcodeDetector` API with jsQR fallback |
| Hosting | Shared hosting compatible (cPanel etc.) |

No build system required — no npm, no bundler, no framework.

## Project Structure

```
else_inventory/
├── public/                  # Web root (set this as document root)
│   ├── index.html           # Main staff app
│   ├── login.html           # Login page
│   ├── register.html        # Invite-token registration
│   ├── shift.html           # Shift QR login (fill_truck sessions redirect to /fill-route.html)
│   ├── cube.html            # Public water cube status + fill request page
│   ├── fill-route.html      # Truck crew route + direction picker
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker
│   ├── admin/
│   │   └── index.html       # Admin panel
│   ├── api/
│   │   ├── index.php        # API router
│   │   ├── auth.php         # Session + permission middleware
│   │   ├── lib/             # DB connection, response helpers
│   │   └── routes/
│   │       ├── auth.php
│   │       ├── transactions.php
│   │       ├── items.php
│   │       ├── persons.php
│   │       ├── departments.php
│   │       ├── artists.php
│   │       ├── barrios.php
│   │       ├── orders.php
│   │       ├── consumables.php
│   │       ├── history.php
│   │       ├── sync.php
│   │       ├── voucher.php
│   │       ├── item_public.php
│   │       ├── fill_requests.php  # Water fill requests, route, direction claims
│   │       └── admin/
│   │           ├── departments.php
│   │           ├── artists.php
│   │           ├── barrios.php
│   │           ├── equipment.php
│   │           ├── users.php
│   │           ├── invite.php
│   │           ├── shifts.php
│   │           ├── qr_sheet.php
│   │           └── barrio_qr.php
│   └── assets/
│       ├── css/
│       ├── js/
│       │   ├── app.js
│       │   ├── checkout.js
│       │   ├── checkin.js
│       │   ├── order-form.js
│       │   ├── i18n.js
│       │   ├── cube.js            # Public cube status page
│       │   ├── fill-route.js      # Truck crew route + direction picker
│       │   ├── fill-requests.js   # Noinfo/NWP fill request creation
│       │   └── admin/
│       │       └── fill_route.js  # Admin drag-and-drop route ordering
│       └── vendor/          # jsqr, phpqrcode
├── schema.sql               # Full database schema
├── migrate_departments.sql  # Role + department overhaul
├── migrate_artists.sql      # Artists table
├── migrate_orders.sql       # Equipment order tables
├── migrate_person_checkout.sql  # Person QR + person checkout columns
├── migrate_borrow_restrictions.sql  # Borrowable flag + restriction rules
├── setup.php                # First-admin creation (delete after use)
├── .env.example
└── .htaccess
```

## Setup

### 1. Configure environment

Copy `.env.example` to `.env`:

```
DB_HOST=localhost
DB_NAME=else_inventory
DB_USER=your_db_user
DB_PASS=your_db_password
SETUP_TOKEN=<long_random_string>
```

### 2. Import the database schema

Fresh install:
```bash
mysql -u your_db_user -p else_inventory < schema.sql
```

Upgrading an existing installation — apply migrations in order:
```bash
mysql -u your_db_user -p else_inventory < migrate_departments.sql
mysql -u your_db_user -p else_inventory < migrate_artists.sql
mysql -u your_db_user -p else_inventory < migrate_orders.sql
mysql -u your_db_user -p else_inventory < migrate_person_checkout.sql
mysql -u your_db_user -p else_inventory < migrate_borrow_restrictions.sql
mysql -u your_db_user -p else_inventory < migrate_storage_locations.sql
mysql -u your_db_user -p else_inventory < migrate_entity_qr.sql
mysql -u your_db_user -p else_inventory < migrate_water_cubes.sql
```

### 3. Set the document root

Point your web server's document root to the `/public` directory. The `.htaccess` file handles URL rewriting for the API router.

### 4. Create the first admin account

Visit `https://yourdomain.com/setup.php?token=<your_SETUP_TOKEN>` and follow the prompts. **Delete `setup.php` immediately after.**

### 5. First-time configuration

1. Log in as production admin at `/login.html`
2. Go to Admin → Departments and create your departments (set `sub_entity` to `barrio`, `artist`, or `none` as appropriate)
3. Go to Admin → Invite Links and generate invite tokens to onboard other staff
4. Go to Admin → Equipment and add your equipment types and items
5. For shifts: Admin → Shifts → create a shift → generate tokens → print the QR sheet

## API Overview

All endpoints are under `/api/`. State-changing requests require a `X-CSRF-Token` header (obtained from `GET /api/auth/me`).

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/login` | Authenticate with username + password |
| `POST` | `/auth/shift-login` | Authenticate with shift token + volunteer name |
| `POST` | `/auth/logout` | End session |
| `GET` | `/auth/me` | Current session data + CSRF token |
| `GET` | `/auth/csrf` | Refresh CSRF token |
| `POST` | `/auth/language` | Set display language |
| `GET` | `/auth/invite-info?token=` | Validate invite token (public) |
| `GET` | `/auth/shift-info?token=` | Validate shift token (public) |
| `POST` | `/auth/register` | Register with invite token |

### Equipment

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/items/lookup?qr=` | Look up item by QR code (includes borrow eligibility) |
| `GET` | `/inventory` | All equipment with status |
| `POST` | `/checkout` | Check out items to a department (production) |
| `POST` | `/sub-checkout` | Sub-lend items to a barrio or artist (dept) |
| `POST` | `/checkin` | Return items — auto-detects tier |
| `POST` | `/person-checkout` | Check out borrowable items to a person (production) |
| `POST` | `/sub-person-checkout` | Check out borrowable items to a person (dept) |
| `PUT` | `/items/label` | Set or update dept label on a checked-out item |
| `POST` | `/items/use` | Mark a secure QR voucher as used (legacy) |
| `POST` | `/items/activate` | Activate dual-QR vouchers (legacy) |
| `POST` | `/items/fill-confirm` | Confirm fill + disinfection (legacy) |

### People

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/person-info?qr=` | Look up person by QR token |
| `GET` | `/persons?q=` | Search people by name |

### Departments, Barrios, Artists

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/departments` | List departments |
| `GET` | `/departments/:id` | Department detail |
| `GET` | `/barrios` | List barrios |
| `GET` | `/artists` | List artists |
| `POST` | `/barrio-arrival` | Mark barrio as arrived |
| `POST` | `/barrio-departure` | Mark barrio as departed |
| `POST` | `/barrio-distribute` | Distribute consumables |

### Orders

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/dept-orders` | Dept equipment order (own dept) |
| `PUT` | `/dept-orders` | Save dept equipment order |
| `GET` | `/admin/dept-orders` | Aggregate orders across all depts |
| `GET` | `/admin/barrio-orders-aggregate` | Sum of barrio equipment orders |

### Water fills

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/water/cube-status?qr=` | public | Cube status, last fill, credits, active request |
| `POST` | `/fill-requests` | `request_fills` | Create fill request (entity-level or cube-specific) |
| `DELETE` | `/fill-requests/:id` | `request_fills` | Cancel a fill request |
| `GET` | `/fill-route?direction=` | `fill_truck` | Ordered route list for truck crew |
| `POST` | `/fill/confirm` | `fill_truck` | Confirm fill by cube QR |
| `POST` | `/fill/confirm-adhoc` | `fill_truck` | Confirm sticker fill (no digital request) |
| `GET` | `/fill/direction-status` | `fill_truck` | Which directions are currently claimed |
| `POST` | `/fill/claim-direction` | `fill_truck` | Claim CW or CCW direction for this run |
| `POST` | `/fill/release-direction` | `fill_truck` | Release direction claim on logout |
| `GET` | `/barrios/:id/cubes` | `request_fills` | Barrio's cubes with credit balance |
| `POST` | `/admin/sell-fill-credits` | `manage_consumables` | Log on-site fill credit purchase |
| `GET` | `/admin/fill-route/cubes` | `manage_barrios` | All cube items for route admin |
| `PUT` | `/admin/fill-route/order` | `manage_barrios` | Save route stop order |

### Misc

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/history` | Transaction history |
| `POST` | `/sync/offline-queue` | Sync offline queue |
| `GET` | `/camps` | List barrios (alias used by checkout UI) |
| `GET` | `/voucher/status` | Public voucher status check (legacy) |
| `GET` | `/item/info` | Public item info page |

Admin routes follow the pattern `/api/admin/*` and require appropriate permissions (see auth.php).

## Permissions Reference

| Permission | Granted to |
|---|---|
| `validate_vouchers` | production_admin, production_staff |
| `checkout_equipment` | production_admin, production_staff |
| `checkin_equipment` | production_admin, production_staff |
| `sub_checkout` | production_admin, dept_admin, dept_staff (sub-lending depts) |
| `sub_checkin` | production_admin, dept_admin, dept_staff (sub-lending depts) |
| `view_inventory` | production_admin, production_staff |
| `view_dept_inventory` | all dept roles |
| `view_barrios` | production_admin, production_staff, barrio dept roles |
| `view_artists` | production_admin, production_staff, artist dept roles |
| `manage_barrios` | production_admin, barrio dept_admin |
| `manage_artists` | production_admin, artist dept_admin |
| `manage_equipment` | production_admin |
| `manage_consumables` | production_admin |
| `manage_users` | production_admin |
| `manage_departments` | production_admin |
| `create_invites` | production_admin, dept_admin |
| `manage_orders` | production_admin |
| `submit_orders` | production_admin, dept_admin, dept_staff |
| `label_equipment` | production_admin, dept_admin, dept_staff (sub-lending depts) |
| `manage_shifts` | production_admin |
| `request_fills` | production_admin, production_staff; also assignable to shift sessions (noinfo staff, NWP rep) |
| `fill_truck` | production_admin; assignable to shift sessions (truck crew) |

## Security

- Passwords hashed with bcrypt
- CSRF protection on all state-changing requests
- HTTP-only, same-site session cookies (3-day expiry)
- Row-level locking (`SELECT ... FOR UPDATE`) prevents concurrent double-checkouts
- All checkout/check-in operations run inside database transactions
- All routes enforce permission checks server-side via the named-permission system
- Shift sessions carry only the permissions explicitly defined for that shift
- Invite tokens are single-use and time-limited; registration is closed without a valid token
- Secure QR vouchers use cryptographically random codes (`random_int`) — unpredictable and not guessable in sequence
- Personal QR tokens are 32 random hex characters (`random_bytes(16)`)

## Requirements

- PHP 7.4+
- MySQL 5.7+ or MariaDB 10.3+
- A web server with `.htaccess` / `mod_rewrite` support
- HTTPS required (camera access and service workers need a secure context)

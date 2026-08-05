# Brava

Brava is a Windows desktop product-monitoring and checkout companion with encrypted local profiles, optional static network routes, a task builder, and device-bound license activation.

The central monitor consumes configured public product feeds or page metadata and broadcasts deduplicated SKU signals to licensed Brava clients. Store-session queue data and browser handoffs remain local to each task.

## Included

- Electron + React desktop application
- Seamless frameless Windows chrome with integrated window controls
- Animated tab transitions, staggered key-detail entrances, and reduced-motion support
- Encrypted shipping profiles, payment-method preferences, and proxy storage through Electron `safeStorage`
- Product task builder and live task state updates
- Centralized product-source polling with first-scan baselining, SKU-change deduplication, source health, and authenticated signal fan-out
- Per-task monitor phrases with either automatic exact-match application or one-click match approval
- Headless task execution: task actions never launch an external browser or their own window
- Commerce analytics for total spent, successful checkouts, and declines
- Previous-checkout history with All, Week, and Day filters plus site-level checkout and spending statistics
- Placeholder SKUs that can be replaced while a task is queued
- Per-task Wait for queue control that defaults off, allowing no-queue SKU drops to begin monitoring immediately
- Queue position or estimated-time display when the official response provides it, with configurable 2–10 minute refresh checks
- Explicit last-checked and next-check timing, timestamped task history, and carted / checked-out / declined filters
- Explicit monitoring, queue, found, cart, user-review, checkout, decline, and error states
- Optional profile looping after a decline and automatic bounded failover for ordinary proxy connection errors
- Per-task Loop profiles setting that advances to the next saved profile after a recorded decline and waits for user confirmation before retrying
- Official-domain checkout handoff through a configured harvester only
- Persistent human-review harvester entries with compact, tiled official-site windows
- Open All / Close All controls, open-on-launch preferences, and user-confirmed solve counts
- Isolated harvester browser sessions with no CAPTCHA token extraction, reuse, or automatic solving
- License creation, device activation limits, expiration, and revocation-ready heartbeats
- User-controlled device deactivation from Settings, which frees the license slot and clears the locally saved key
- Masked license-key display with explicit reveal and secure copy controls in Settings
- Encrypted Discord checkout and decline webhooks with success/failure embeds and explicit test controls
- Neutral Discord connection-test embeds for independently verifying each configured webhook
- Validated backup import with replacement confirmation while preserving device license and webhook secrets
- Compact two-column task builder with integrated mode, queue, profile, proxy, and profile-loop controls
- Persistent task groups that require a supported site selection before creation and isolate their task lists
- Cursor-positioned task context menus with start, stop, restart, duplicate, profile-email copy, edit, product management, task-specific timestamped logs, and delete actions
- Persistent click, Ctrl-click, and Shift-click task selection with contiguous range highlighting and bulk-safe context actions
- Short-lived HMAC-signed sessions
- Automatic update checks with user-controlled download and restart-to-install controls
- Windows NSIS packaging configuration

## Local development

Requirements: Node.js 22+ and pnpm 11+.

```powershell
pnpm install
pnpm license:create "Local development" 1
pnpm dev
```

Copy the generated `BRVA-...` key into the desktop activation screen. The API listens on `http://127.0.0.1:4310` by default.

For an owner-only development key with no device limit or expiration:

```powershell
pnpm license:create "Brava Owner Development" unlimited
```

## Product monitor

Set `MONITOR_SOURCE_URLS` to a comma-separated list of public JSON feeds or HTML pages containing JSON-LD Product records. The server polls each source once, establishes the first response as a baseline, and only broadcasts new or changed products afterward.

```powershell
$env:MONITOR_SOURCE_URLS = "https://example.com/pokemon-products.json"
$env:MONITOR_INTERVAL_SECONDS = "30"
pnpm --filter @brava/api dev
```

Each Brava desktop instance polls the authenticated signal stream once every five seconds regardless of its task count. Active placeholder tasks match their comma-separated monitor phrases against the product name, SKU, and URL. Queue-enabled tasks keep their existing queue state after a SKU is applied.

For a manual signal or an external monitor integration:

```powershell
pnpm monitor:signal "10-12345-100" "Celebration Box" "https://www.pokemoncenter.com/product/10-12345-100/celebration-box" "49.99"
```

For a remotely hosted monitor, set `HOST=0.0.0.0`, place the API behind HTTPS, and package the desktop with its `VITE_API_URL` pointed at that HTTPS service.

If a local reinstall changes the device ID and a development license reaches its limit, explicitly clear its old bindings by exact label or license ID:

```powershell
pnpm license:reset-devices "Local development"
```

Development uses intentionally obvious fallback secrets. Before any deployment, set independent secrets of at least 32 characters:

```powershell
$env:LICENSE_PEPPER = "replace-with-a-random-secret"
$env:TOKEN_SECRET = "replace-with-an-independent-secret"
$env:ADMIN_TOKEN = "replace-with-a-private-admin-token"
$env:NODE_ENV = "production"
```

Production must expose the license API through HTTPS. Only localhost HTTP is accepted by the desktop client.

## Validation and packaging

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @brava/desktop package
pnpm --filter @brava/desktop smoke:launch
```

The installer candidate is written to `apps/desktop/release-staging/`; packaging never changes the live update feed. Packaging also rejects the incompatible named `autoUpdater` import and automatically runs the launch smoke test. That test starts the packaged executable with a clean profile, verifies the renderer loaded and the window became visible, waits for a post-launch crash, and then closes only that test process. Full card numbers and CVVs are intentionally never stored; payment entry remains on the official checkout page.

## Automatic updates

Packaged builds check for an update shortly after launch and can also be checked from **Settings → Update center**. When a newer version is found, select **Download update** and then **Update and restart** after the download finishes.

For local testing, the license API publishes `apps/desktop/release/` at `http://127.0.0.1:4310/updates`. Keep the API running and leave `latest.yml`, the matching installer, and its `.blockmap` together in that directory.

For distributed releases, publish those three generated files to the same HTTPS directory and set `BRAVA_UPDATE_URL` when packaging, or replace the generic publish URL in `apps/desktop/package.json`. Every new public release should use a higher application version. Code-sign the installer before distribution so Windows can verify the publisher and the update chain.

Before publishing, update `apps/desktop/release-notes.json` so its version matches the application version and its sections describe the release. Configure `BRAVA_RELEASE_WEBHOOK_URL` in the ignored root `.env`; `BRAVA_RELEASE_PING_EVERYONE=true` enables the release ping. The guarded publisher requires that configuration, sends the Brava changelog first, copies the staged installer and blockmap second, and atomically replaces live `latest.yml` last. If the changelog fails, nothing becomes downloadable. The live feed retains the 0.33 installer and blockmap so clients can jump directly from 0.33 to the newest announced version, with full-installer fallback when a differential update cannot be used.

## Hosted accounts, PostgreSQL, and subscriptions

Production supports PostgreSQL license/device storage, Better Auth email/password accounts, and Polar subscriptions while retaining the desktop application's existing key activation protocol. Better Auth and Brava migrations run before the API begins listening. `/health` reports the active license store and the readiness of the database, account, and billing components.

Required hosted API variables:

```text
DATABASE_URL=<private PostgreSQL reference>
BETTER_AUTH_SECRET=<independent random secret, at least 32 characters>
BETTER_AUTH_URL=https://your-api-domain.example
POLAR_ACCESS_TOKEN=<matching sandbox or production organization token>
POLAR_PRODUCT_ID=<matching environment's Brava product ID>
POLAR_SERVER=sandbox
POLAR_WEBHOOK_SECRET=<secret generated by the Polar webhook endpoint>
LICENSE_STORAGE=postgres
```

Keep `LICENSE_STORAGE=json` for the first migration deployment. If a persistent JSON license file actually exists, back it up and run `pnpm license:import-json` (or perform the guarded one-time startup import) before switching to PostgreSQL. Never change `LICENSE_PEPPER` during that migration because existing license hashes depend on it. Do not enable `IMPORT_JSON_LICENSES` when the source JSON file is missing.

Configure Polar's Raw webhook endpoint at:

```text
https://your-api-domain.example/api/auth/polar/webhooks
```

Subscribe it to `customer.state_changed`. A signed customer-state update grants or revokes only Polar-managed licenses; admin and owner keys are never changed. An authenticated customer provisions a key once through `POST /v1/account/license/provision`. The plaintext is returned once and never stored. `POST /v1/account/license/rotate` is the separate explicit replacement action and clears the old device bindings.

The desktop continues using `/v1/licenses/activate`, heartbeat, and device deactivation. Package public desktop builds with `VITE_API_URL` set to the Railway HTTPS domain. Keep the API at one replica until monitor signals and public-checkout deduplication are moved from process memory to shared storage.

Never log raw license keys, authentication cookies, database URLs, webhook secrets, shipping data, proxy credentials, or payment data.

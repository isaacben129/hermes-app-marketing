# App Marketing System · Hermes Desktop plugin

The Marketing page is a local, service-backed workflow for app-scoped drafts, evidence, review, image rendering, exports, experiment recommendations, and aggregate outcome intake. Cherry is the first configured app. Claims, asset rights, CTA, channels, privacy/event definitions, and business metrics remain unconfigured until an owner provides evidence and approves them.

## Local services

Set an absolute `HERMES_MARKETING_DATA_DIR` and run `npm run start:local`. The service binds to `127.0.0.1`; it starts and supervises the Python/Pillow renderer, creates a private local `connection.json` with a bearer token, and removes that file on clean shutdown. Keep the data directory private and back it up as local application data. Do not copy the connection file or token into source control, exports, or messages.

Configure the service with the exact browser UI origin using `HERMES_MARKETING_ALLOWED_ORIGIN`. Never use `*` and do not expose the service to a LAN. The UI accepts `127.0.0.1`, `localhost` and `[::1]` service URLs; Host validation permits those three loopback names only on the bound service port. The service itself binds to `127.0.0.1`.

In **App settings**, enter the local service URL and bearer token from `connection.json`. Overview opens saved drafts and offers read-only Postiz sync. Slideshows supports evidence entry, structured slides, operator-supplied images, revision-checked saves, service review, render of a saved revision, thumbnail preview, and ZIP export. Legacy plugin-local drafts can be imported once; retain the backup until service readback succeeds.

A render/export does not approve campaign use or distribution. The service reports blocked, unavailable, stale and inconclusive states; no publishing, scheduling or external draft-write operation is provided.

## Installed bundle and native verification

Worktree mirrors `plugin.js`, `desktop/plugin.js`, and `desktop-plugins/marketing-system/plugin.js` are byte-identical. The separately installed `/opt/data/desktop-plugins/marketing-system/plugin.js` differs from this tested branch. It was not overwritten or reloaded. The browser preview uses an SDK shim, not the Hermes Desktop host; native installation and load verification remain blocked pending authorized reconciliation.

## Postiz and app outcomes

The Postiz adapter is read-only and requires `POSTIZ_BASE_URL` and `POSTIZ_API_KEY` in the service process environment. Keep credentials out of plugin storage, requests, logs, Git, and exports. Live credentials and post/metric reads were not verified. Engagement metrics do not establish qualified or paid outcomes. Outcome imports require an approved app profile, event definitions, privacy policy, and verified attribution; otherwise the result remains unavailable or inconclusive.

## Browser QA preview

Run `npm ci`, then `npm run preview`. Visit `http://127.0.0.1:8766` and configure that exact origin in the service if needed. The browser-only Hermes SDK shim and browser storage do not prove native Desktop behavior.

## Verification (WSL/Linux shell)

```sh
npm ci --ignore-scripts --no-audit --no-fund
export HERMES_MARKETING_DATA_DIR="$HOME/.local/share/hermes/marketing-system"
mkdir -p "$HERMES_MARKETING_DATA_DIR"
npm run start:local
```

The launcher prints the connection-file path. Keep its token private. Stop with Ctrl+C. Never expose the service to a LAN.

```sh
npm test
npm run build
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/plugin-smoke.mjs
node tests/pipeline.mjs
```

The registered UI integration test exercises UI→loopback service→supervised renderer→real ZIP export, but does not constitute native Desktop installation or host acceptance.

# App Marketing System · Hermes Desktop plugin

The Marketing page is a local, service-backed workflow for app-scoped drafts, evidence, review, image rendering, exports, experiment recommendations, and aggregate outcome intake. Cherry is the first configured app. It deliberately leaves claims, asset rights, CTA, channels, privacy/event definitions, and business metrics unconfigured until an owner provides evidence and approves them.

## Local services

Set an absolute `HERMES_MARKETING_DATA_DIR` and run `npm run start:local`. The service binds to `127.0.0.1`; it starts and supervises the Python/Pillow renderer, creates a private local connection file with a bearer token, and removes that file on clean shutdown. The UI never writes the provider token to plugin storage: its bearer token protects only calls to the loopback service. Keep the data directory private and back it up as local application data.

If the UI is hosted on a different origin, set `HERMES_MARKETING_ALLOWED_ORIGIN` to that exact origin before starting the service. Do not expose this service to a LAN. The runtime connection file is in the configured data directory and must not be copied into source control, exports, or messages.

In **App settings**, enter the local service URL and the bearer token from that connection file; the token field is masked and saved only in Hermes plugin storage. Connect to load service-owned records. **Overview** opens saved drafts and offers a read-only Postiz sync. **Slideshows** supports evidence entry, structured slides, operator-supplied images, save with revision checking, service review, render of the saved revision, thumbnail selection, and service ZIP export. Legacy plugin-local drafts can be imported once; the local backup is retained after successful service readback.

The service returns explicit blocked, unavailable, stale, and inconclusive states. A render or export does not approve campaign use or distribution. No publishing, scheduling, or provider draft-write operation is exposed.

## Postiz and app outcomes

The Postiz adapter is read-only and requires operator-provided `POSTIZ_BASE_URL` and `POSTIZ_API_KEY` in the service process environment. Do not put the key into plugin storage, requests, logs, Git, or exports. Live credentials and reads were not verified in this environment. Postiz engagement metrics do not establish qualified or paid outcomes. Outcome imports require an approved app profile, event definitions, privacy policy, and verified attribution; without these, the system must remain unavailable or inconclusive.

## Browser QA preview

Run `npm ci`, then `npm run preview`. Visit [http://127.0.0.1:8766](http://127.0.0.1:8766), and allow that exact origin in the marketing service CORS configuration. The preview uses a browser-only Hermes SDK shim and browser local storage; it does not prove native Hermes Desktop host behavior.

Build the production plugin and byte-identical package mirrors with `npm run build`. The host supplies React, JSX runtime, and `@hermes/plugin-sdk`.

## Verification (WSL/Linux shell)

```sh
npm ci --ignore-scripts --no-audit --no-fund
export HERMES_MARKETING_DATA_DIR="$HOME/.local/share/hermes/marketing-system"
mkdir -p "$HERMES_MARKETING_DATA_DIR"
npm run start:local
```

The process prints the path to `connection.json`; keep its bearer token private. Stop with Ctrl+C for normal cleanup. For a non-default Desktop origin, set `HERMES_MARKETING_ALLOWED_ORIGIN` to the exact origin before starting. Never expose the service to a LAN.

```sh
npm test
npm run build
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/plugin-smoke.mjs
node tests/pipeline.mjs
```

The registered UI integration test exercises the actual UI through the live loopback HTTP service, supervised renderer, saved-image readback, real ZIP response, and archive manifest. This browser/React harness is separate from installing and inspecting the plugin in the native Desktop app. The app plugin was previously installed under `/opt/data/desktop-plugins/marketing-system/plugin.js` and the Windows host mirror under `/opt/data/C:/Users/isaac/AppData/Local/hermes/desktop-plugins/marketing-system/plugin.js`; their equality to this final bundle and actual native load state require a separate verification.

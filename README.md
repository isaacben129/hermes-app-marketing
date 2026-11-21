# App Marketing · unified Hermes plugin

## Desktop connection (default)

This package uses the same native connection pattern as Weight Dashboard:

`desktop/plugin.js → ctx.rest('/workspace?...') → /api/plugins/marketing-system → dashboard/plugin_api.py → existing Node application → durable ledger`.

Install the **whole package**, not just its JavaScript. The connected Hermes backend must have `plugins/marketing-system/dashboard/manifest.json`, `plugin_api.py`, `scripts/plugin-request.mjs`, and `src/`. Its profile must enable `marketing-system`. Enable the Desktop UI in Capabilities → Plugins, then Reload desktop plugins and open Marketing. Desktop connects automatically through its existing authenticated Hermes connection. No marketing URL or bearer token is entered or stored by the native transport.

Node.js must be installed on the **Hermes backend host**, not necessarily the Windows Desktop computer. The Python router uses Hermes' existing FastAPI runtime. Node production code uses built-in modules; npm packages are build/test dependencies. Missing Node is reported as `runtime_unavailable`, not connected.

The Node application executes as a bounded child per request, reusing the existing HTTP validation/actions internally on an ephemeral loopback listener. The child and listener end with the request. There is no persistent marketing daemon, fixed marketing API port, connection-token file, boot-service modification, or new gateway. A per-store cross-process lock serializes ledger revision transactions. This is appropriate for the current operator-driven workspace, not a continuous background agent runner.

### Durable data and existing records

Default store: `<resolved Hermes profile home>/plugin-data/marketing-system/`. Resolution uses `get_hermes_home()` at request time, including context-scoped profiles. An absolute backend-side `HERMES_MARKETING_DATA_DIR` override selects an existing store deliberately; it shares that store across profiles and should be used only intentionally. Back up application data separately from plugin code.

No scratch service records are automatically promoted. `Cherry` and `cherry` remain distinct scopes. Existing browser/plugin-local records are not overwritten. The explicit legacy import retains a local backup and reads records back from the backend.

### Scope and remaining dependencies

This change connects workspace reads, saves, profile configuration and the existing routes. It does not create agents, turn on unattended work, publish, schedule, deploy, or grant external permissions. Claims, rights, CTA, privacy and measurement remain evidence-gated. The renderer is still a separate optional capability on backend loopback port 8765; health reports it unavailable if absent. Draft connection/save does not require that renderer. Native-path rendering/export startup and continuous agent lifecycle are not solved by this connection change.

The standalone launcher and browser QA preview retain their older explicit URL/token transport when no `ctx.rest` SDK is present. A native host with `ctx.rest` never silently falls back to that transport when its backend fails.

## Build and tests

```sh
npm ci --ignore-scripts
npm run build
HERMES_TEST_PYTHON=/path/to/hermes/python npm test
/path/to/hermes/python -m unittest discover -s tests -p 'test_*.py' -v
hermes plugins validate . --json
```

The HTTP/UI test requires FastAPI, httpx and uvicorn in the selected Hermes Python environment. Generated `plugin.js`, `desktop/plugin.js` and `desktop-plugins/marketing-system/plugin.js` must be byte-identical. Build before tests: the test loader executes the distributable bundle.

Tests include registered UI → real Python HTTP router → real Node actions → saved record → complete UI remount → reopen. Backend checks cover stale revision rejection, credential-shaped request rejection, cross-process concurrent writes, profile scope and app-case separation. The UI harness substitutes Hermes' SDK/React host components; it is **not native Windows Desktop load/visual evidence**.

## Native acceptance gate

Verify the exact installed Desktop copy, enable/reload it in the actual app, open Marketing, create and save a harmless draft, leave the page and reopen it, then confirm the same title and saved revision. Confirm App settings shows **Hermes backend connection**, not a manual URL/token form. Do not call native setup complete until this has run. A WSL path containing `C:` is not proof of installation on Windows.

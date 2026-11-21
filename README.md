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

## Images, rendering, and manual Cherry agent runs

- Native image selection uses the SDK's scoped folder grant (`folder.id`) and `readDataUrl(...).url`. Select a candidate explicitly. Saving imports the verified bytes into profile-private content-addressed storage; a fresh plugin module can retrieve them from the backend without the original folder grant. The ledger retains references, not inline image bytes.
- The native request bridge uses the local Python/Pillow renderer as a bounded subprocess. There is no separate renderer server to start for native operation. Install `renderer/requirements.txt` in the Python environment available to the backend; `PYTHON` can select that interpreter. Source image hashes and ordered PNGs are preserved in exports.
- **Start 5 Cherry drafts** is a manual, local operation. It requires the Codex CLI with an authorized ChatGPT OAuth session and a validated `agent-context/context.json` under this profile's marketing data directory. It does not configure another profile, start cron, or grant posting/scheduling authority.
- The context supplies exactly five directions, hashed local assets, separated product evidence and structural references, brand constraints, and an explicitly unapproved CTA. Missing or invalid context fails closed. The HTTP request cannot supply arbitrary executable paths, provider keys, model names, or asset paths.
- A batch uses fresh, ephemeral author and critic model executions: initial author → independent critique → author revision → local PNG/ZIP render → independent critique of those PNGs → ordinary draft save. It carries actual critique lessons to later packages; it never forces higher scores. An uninspected dimension stays unjudged rather than receiving invented evidence.
- `GET /agent-runs`, `POST /agent-runs` (`{"app":"Cherry","count":5}`), and `GET /agent-runs/{runId}` are relative to the Hermes-authenticated plugin route. Only one batch may be active in a profile. Server-generated IDs, durable stage/count/error records, per-call limits, and an overall runtime deadline make failures observable. Successful completion reports `succeeded`; package content remains `rendered-unapproved` with rights and CTA blockers.
- Critique is not permission to publish, and a successful run does not prove each package is strictly better on every rubric dimension. Inspect the actual comparative evidence and retain honest regressions/unknowns.
- Loading Postiz configuration now uses the same protected-file convention in both launch paths. Configuration presence is not connectivity. Keep a failing upstream marked blocked until a real provider read succeeds; local authoring/render/export do not require Postiz.

The native Desktop update must include **both** this backend package and the matching built Desktop module, followed by the host's normal reload. Tests of the real Python/Node path and SDK harness are not proof that a user's Windows host has loaded those files.
# Generated creative gallery

The native desktop plugin includes a read-only **Creatives** view for Cherry. It lists saved, rendered candidates from the connected profile, opens the actual saved PNG slides, and shows recorded critique scores and blockers. Candidates remain explicitly unapproved. Missing or unreadable artifacts are omitted; the gallery does not regenerate or publish content.

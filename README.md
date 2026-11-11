# App Marketing System — Hermes Desktop plugin

A local-first, app-agnostic workspace prototype for managing slideshow concepts across fictional **App A**, **App B**, and **App C**. It is not Cherry-specific.

## What this prototype includes

- An overview that limits itself to business outcome measures. Since no analytics are connected, unavailable outcomes are shown as unavailable—not zero or fabricated performance.
- Separate, tappable cards for each sample slideshow, with a detail/editor view.
- Local draft persistence in Hermes plugin storage.
- Explicit fictional/sample labeling and content-rights/review reminders.

## Install in Hermes Desktop on Windows

1. Download or clone this repository onto the Windows filesystem.
2. Open a terminal and run `hermes plugins install <path-to-this-repository>` if your installed Hermes CLI supports local plugin installation; otherwise follow the Desktop plugin SDK's local development install instructions for your version.
3. In Hermes Desktop, open the command palette and run **Reload desktop plugins**. Then open **Marketing** from the sidebar or use the **Open app marketing** command.

If your CLI does not list `plugins install`, check `hermes plugins --help` for the supported package installation command. The package entry is `desktop/plugin.js`; its source is `plugin.js`.

## Local slide renderer

Start the loopback-only service from the repository root with `python3 -m pip install -r renderer/requirements.txt && python3 renderer/server.py` (Windows: `py -m pip install -r renderer\requirements.txt && py renderer\server.py`). Keep it running while using **Render slides**. It binds only to 127.0.0.1:8765; the plugin checks `/api/health` before rendering. The service accepts only the Electron file origin or loopback HTTP, binds to localhost, caps requests, and makes no outbound calls. Start it manually; the plugin never launches a background process.

The renderer creates deterministic text-only 1080×1350 PNGs from ordered slide copy, previews the results, supports individual PNG downloads, and exports a ZIP with numbered PNGs and a JSON source manifest. The built-in neutral/ink templates are generic, not app-branded, and not an approved Cherry design. No remote or user assets are accessed. Copy/claim/asset review remains required before campaign use.

## Local pipeline

Open **Marketing → ＋ Fixture pipeline**. The entry creates a clearly marked fictional source (`fixture:focus-1`), an editable evidence-linked brief and untested hypothesis. **Generate static copy** creates four deterministic text slides locally; it uses no model or service. Edit slide text and move slides upward to change their order.

**Save draft** persists the draft and appends a numbered snapshot containing its source, brief, hypothesis, slide order, and review statuses. Open **Saved versions** to inspect prior snapshots. Return to the overview and open the draft again to resume; unsaved edits are discarded only after confirmation.

Rights start **unknown**, claims **unreviewed**, and CTA **unchecked**. Local review readiness requires cleared rights, supported claims, a checked CTA and at least one slide. Unknown or restricted rights block readiness. Copy or brief changes invalidate claim and CTA checks. These statuses are human attestations, not automatic verification; readiness only changes local metadata and never sends anything for external review. Fixture context does not establish effectiveness or real product claims. No real metrics are recorded.

Persistence uses only this plugin's storage when run by the user. Tests use an in-memory storage stub and do not write application data. There is no source fetching, integration, media generation, publishing, scheduling, or external review transport.

## Verification (Node.js)

```sh
node --check plugin.js
node --check desktop/plugin.js
node --check desktop-plugins/marketing-system/plugin.js
node tests/plugin-smoke.mjs
node tests/pipeline.mjs
python3 -m unittest tests/test_renderer.py tests/test_export.py tests/test_server.py -v
git diff --check
```

The pipeline test drives the registered UI through fixture creation, copy generation, edits, reordering, review gates, versioning, reopening, and discarding unsaved changes. It also checks all three plugin entry copies match. Python tests cover deterministic PNG output, ZIP provenance, HTTP render/export round trips, and rejection of remote origins.

The smoke test exercises plugin registration, navigation, the overview metrics, three separate sample cards, and opening the corresponding detail view. It uses runtime stubs, so it does **not** replace verification in the actual Windows Desktop renderer.

## Scope boundary

Prototype only: no real analytics, app accounts, external integrations, publishing/scheduling, generated media, spend, or real performance data.

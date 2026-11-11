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

## Verification (Node.js)

```sh
node --check plugin.js
node --check desktop/plugin.js
node tests/plugin-smoke.mjs
```

The smoke test exercises plugin registration, navigation, the overview metrics, three separate sample cards, and opening the corresponding detail view. It uses runtime stubs, so it does **not** replace verification in the actual Windows Desktop renderer.

## Scope boundary

Prototype only: no real analytics, app accounts, external integrations, publishing/scheduling, generated media, spend, or real performance data.

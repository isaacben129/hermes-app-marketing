# Local integration evidence supplement

## Runtime invocation repair
- `package.json` now declares `start:local: node scripts/start-local.mjs`, matching the existing README/runbook command.
- Verified with `npm run` output listing `start:local`; `npm run start:local` requires `HERMES_MARKETING_DATA_DIR` and was not started long-lived (ephemeral `startLocal` already exercised and shut down).

## Real generated-asset attempt
- Hermes `image_generate` returned request ID `10d1e4bd-62db-46ce-820b-83cb2f33a0a3` (provider `openai-codex`, model `gpt-image-2-medium`).
- Asset: `/opt/data/cache/generated/images/openai_codex_gpt-image-2-medium_20261117_154941_6c15c12f.png`; dimensions 941x1672; SHA-256 `41cb650a1c4efad0f11bf84ee0c5416bacc820e38282fc48907529f934edaf21`.
- Vision inspection: warm café background with large negative-space wall, no logo/text; draft-only, not cleared for campaign use.
- Live service startup/health succeeded, saved draft returned revision 1. Actual render call returned HTTP 502 sanitized `render_failed`; no render output or ZIP. This fails the live generated-image acceptance gate and requires investigation of detailed renderer/service output (safe event ledger category does not expose raw error).
- Temporary service/data directory was removed after the run.

## Installed package and boundary audit
- Worktree build mirrors `plugin.js`, `desktop/plugin.js`, and `desktop-plugins/marketing-system/plugin.js` match at SHA-256 `3a8d3ecbb7f8f56eb539a25afded1b46f42f49c893457ce0944aeb24db641247`.
- Active installed `/opt/data/desktop-plugins/marketing-system/plugin.js` differs (SHA-256 `0598de088a634bc410f9e280d76ce063fab325b5d69f5ed3ab09b156f6d94c70`). The candidate Windows path `/mnt/c/Users/isaac/AppData/Local/hermes/desktop-plugins/marketing-system/plugin.js` is absent. Do not call native acceptance complete; no install or overwrite was performed.
- A follow-up audit found the exact service Host alias check was a real usability issue: the UI accepts `localhost`, while service rejected it. The service now accepts only `127.0.0.1`, `localhost`, or `[::1]` with the exact bound port; it remains bound to IPv4 loopback. Regression test exercises both a permitted alias and another port.
- Renderer runs on loopback under the Node service, health reports protocol/features only, and POST render/export requires exact `Origin: file://`. `RendererClient` sets that header on POST; missing health `Origin` is not a vulnerability because health is uncredentialed protocol status only. Renderer CORS response helper advertising loopback web origins does not bypass the POST origin check.
- `HERMES_MARKETING_ALLOWED_ORIGIN=null` is the lifecycle default, explicitly allowing only browser opaque `Origin: null`; it is not a wildcard. Browser preview/network UI origins must configure the exact origin. The README/runbook document this.
- The independent audit's claim that the active continuation had a failing alias test was stale: it inspected commit `8099f80`, not the later `9fff0a9` version, where the test explicitly expected 403. The issue is now fixed and its updated test passes.

- Postiz MCP read-only group list `[]`; integration list has 3 integrations, one Cherry-named TikTok id `cmrb2tjm80001ow6vkzhk1yg9`. No posts/metrics read tool exposed. Local Node reader returned unconfigured because `POSTIZ_API_KEY` and `POSTIZ_BASE_URL` absent. Official docs confirm `GET /posts` and `GET /analytics/post/{postId}`, but no authenticated real read.
- Cherry `operations/weekly-funnel.md` at worktree `forge-benchmark-home-20261026`, commit `4842931b02089b76e7a6154e77cfaa06dd615953`, identifies candidate events including `practice_complete` and `purchase_completed`, and fields `campaign_id`/`hook_id`/`content_id`/`source`; explicitly records attribution is not populated and Firebase/BigQuery export is manual. No exported rows or approval available.
- DarkUGC official docs advertise remote OAuth MCP at `https://darkugc.com/mcp`; catalog search in current profile returned no result. No connection or audit performed.

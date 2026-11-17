# Local completion evidence · 2026-11-17

## Result
Local implementation is committed on `integration/marketing-completion-20261117`, HEAD `f5041116aa4e96dc5e4b5484ae1336772554e7fb` (local only; canonical `main` unchanged). Features include durable app-scoped drafts and revisions, evidence-linked review, local rendering and ZIP export, fail-closed outcome/experiment handling, read-only Postiz interfaces, and System Health queue counts.

## Verified
- `npm test`: 97/97 passing.
- `npm run build`: passed; React focused suite 3/3.
- Python unittest discovery: 19/19 passing.
- `node tests/plugin-smoke.mjs` and `node tests/pipeline.mjs`: passed.
- `node --test tests/service.test.mjs`: 4/4 passing after loopback alias fix.
- `node --test tests/system-health.test.mjs tests/ui-live.test.mjs tests/workflow-ui.test.mjs`: 8/8 passing with queue metric assertions.
- UI→live HTTP service→supervised renderer produced a real ZIP (29,391 bytes in test); service E2E produced a real ZIP (12,233 bytes).
- Built package mirrors `plugin.js`, `desktop/plugin.js`, and `desktop-plugins/marketing-system/plugin.js` SHA-256 all `56c0283623b8f624edb6860892eaa80f178329395fde3309a07f26f18776da3c` after the System Health change.

## Native Desktop verification boundary
Hermes docs identify the host's `desktop-plugins/<id>/plugin.js` as the app-level source. The only marketing plugin file found is `/opt/data/desktop-plugins/marketing-system/plugin.js` (28,567 bytes; SHA-256 `0598de088a634bc410f9e280d76ce063fab325b5d69f5ed3ab09b156f6d94c70`). The tested package mirrors are a different bundled output. The session found no running Desktop process, `127.0.0.1:9222` endpoint, Desktop log, or Windows Desktop install path; the active runtime is CLI under WSL. Thus the installed copy's loaded state and native visual flow remain unverified. I did not copy/install either file.

## Remaining external/system gates
1. **Postiz live data:** the available MCP methods list integrations but do not expose post history or analytics. MCP is disabled in the checked profile; the local reader has no configured API key/base URL. No live post/metric read was performed.
2. **Cherry readiness:** claims, asset rights, CTA, channels, privacy/event definitions, attribution and outcome windows require product evidence and owner approval. The located candidate source states attribution is not populated and export is manual.
3. **DarkUGC:** no registered MCP server or supplied corpus was found in the checked profiles/workspace; no video ingestion/audit was performed.
4. **Browser preview save issue:** browser-shim QA surfaced a draft-save error; automated registered UI/service tests pass, but do not prove native host behavior.
5. **Local service URL aliases:** fixed in `b16d32c`; only `127.0.0.1`, `localhost`, or `[::1]` on the exact listener port are accepted; listener remains IPv4 loopback. Regression test passed 4/4.

Image generation was available and already exercised for one draft-only image and local export; this is not rights or campaign approval. No publishing, scheduling, upload, OAuth/credential change, merge, push, PR, or deployment occurred.

## Evidence pointers
- Run plan: `/opt/data/.hermes/plans/2026-11-17_052651-hermes-marketing-finish-today.md`
- Manifest/assertions: `.artifacts/evidence/marketing-finish-20261117/manifest.json`, `assertions.md`
- Audit supplement: `.artifacts/evidence/marketing-finish-20261117/supplement.md`
- Local draft ZIP: `/opt/data/cache/scratch/cherry-generated-image-full-workflow.zip`
- Generated draft image: `/opt/data/cache/generated/images/openai_codex_gpt-image-2-medium_20261117_154941_6c15c12f.png`

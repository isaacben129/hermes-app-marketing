# Local completion evidence · 2026-11-17

## Result
Local implementation is complete at `integration/marketing-completion-20261117`, HEAD `10e460f2c4a5d32dc972b4b078eb3512af3b780f` (local branch only; canonical `main` unchanged). It includes durable scoped drafts/revisions, evidence-linked review, local rendering and ZIP export, fail-closed outcome/experiment states, read-only Postiz interfaces, and queued/running/failed job counts in System Health.

## Verified on this commit
- `npm test`: 97/97 passing.
- `npm run build`: passed; React focused suite 3/3.
- Python unittest discovery: 19/19 passing.
- `node tests/plugin-smoke.mjs`: passed.
- `node tests/pipeline.mjs`: passed.
- `node --test tests/service.test.mjs`: 4/4 passing after loopback alias fix.
- `node --test tests/system-health.test.mjs tests/ui-live.test.mjs tests/workflow-ui.test.mjs`: 8/8 passing with queue metrics assertions.
- UI-to-live-HTTP-service-to-supervised-renderer integration produced a real ZIP (29,391 bytes in test); service E2E produced a real ZIP (12,233 bytes in test).
- `git diff --check`: passed; worktree clean.
- Built package mirrors `plugin.js`, `desktop/plugin.js`, and `desktop-plugins/marketing-system/plugin.js` all SHA-256 `56c0283623b8f624edb6860892eaa80f178329395fde3309a07f26f18776da3c` after adding System Health queue counts.

The entire system is **not yet native-Desktop verified**. The only host folder found is `/opt/data/desktop-plugins/marketing-system/plugin.js` (28,567 bytes; SHA-256 `0598de088a634bc410f9e280d76ce063fab325b5d69f5ed3ab09b156f6d94c70`); the tested build mirrors are a different bundled output (SHA-256 `56c0283623b8f624edb6860892eaa80f178329395fde3309a07f26f18776da3c`). Hermes docs say the native Desktop app reads the host's `desktop-plugins/<id>/plugin.js`, which is app-level rather than profile-scoped. This session found no running Desktop process, `127.0.0.1:9222` endpoint, or Desktop log to verify the installed copy's load state. The agent runtime is CLI in WSL; no Windows Desktop install path was found. I did not copy or install either file.

## Remaining blockers
1. **Postiz live data:** the available MCP methods list integrations but do not provide historical posts/analytics; local reader lacks configured API credentials/base URL. No post/metric rows read.
2. **Cherry readiness:** claims, asset rights, CTA, channels, privacy/event definitions, verified attribution and business-outcome windows need owner/source approval. Candidate source notes attribution is not populated and export is manual.
3. **DarkUGC:** not installed/authorized and no source-video audit performed.
4. **Browser preview save issue:** browser-shim QA surfaced a draft-save error; automated registered-UI/service integration is green, but this does not substitute for native-host validation.
5. **Local service URL aliases:** fixed in `b16d32c`; service now allows only `127.0.0.1`, `localhost`, `[::1]` at its exact port and remains bound to IPv4 loopback. Regression test passed 4/4.

No publishing, scheduling, upload, OAuth/credential change, merge, push, PR, or deployment took place. One generated image and its successful local ZIP export remain draft-only; campaign rights/use are not cleared.

## Evidence pointers
- Run plan: `/opt/data/.hermes/plans/2026-11-17_052651-hermes-marketing-finish-today.md`
- Main evidence manifest and assertions: `.artifacts/evidence/marketing-finish-20261117/manifest.json` and `assertions.md`
- Audit supplement: `.artifacts/evidence/marketing-finish-20261117/supplement.md`
- Local draft ZIP: `/opt/data/cache/scratch/cherry-generated-image-full-workflow.zip`
- Generated draft image: `/opt/data/cache/generated/images/openai_codex_gpt-image-2-medium_20261117_154941_6c15c12f.png`

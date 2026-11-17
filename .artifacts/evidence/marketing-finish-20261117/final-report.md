# Local completion evidence · 2026-11-17

## Result
Local implementation work is complete at `integration/marketing-completion-20261117`, commit `b16d32cc05ce63375e7b41256a3db320fc368444`. The branch is clean and remains local; canonical `main` was not modified. The app-agnostic workflow supports durable scoped drafts/revisions, evidence-bound review, real local rendering and ZIP export, explicit unavailable/inconclusive states, read-only Postiz interfaces, and fail-closed outcome/experiment handling.

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

## Still open — not safely executable without more access or authorization
1. **Native Desktop acceptance:** separately installed `/opt/data/desktop-plugins/marketing-system/plugin.js` is still older/different, SHA-256 `0598de088a634bc410f9e280d76ce063fab325b5d69f5ed3ab09b156f6d94c70`. No native host/CDP (`127.0.0.1:9222` refused); no reload/load verification. Do not overwrite it automatically.
2. **Postiz live data:** account MCP lists three integrations, but its available calls do not expose historical posts/analytics; no configured local API key/base URL, posts or metrics have been read. No external writes were made.
3. **Cherry readiness:** claims, asset rights, CTA, channels, privacy/event definitions, verified attribution and business-outcome windows require owner/source approval. Local evidence says attribution is not populated and export is manual. No candidate assumptions were adopted as approvals.
4. **DarkUGC:** no relevant plugin found/installed; no source-video audit was performed.
5. **Browser preview save issue:** browser-shim QA surfaced a draft-save error; automated registered-UI/service integration is green, but this does not substitute for native-host validation.
7. **Local service URL aliases:** resolved in commit `b16d32cc05ce63375e7b41256a3db320fc368444`; `src/service/server.mjs` accepts only `127.0.0.1`, `localhost` or `[::1]` with the exact bound port. It remains bound to IPv4 loopback. Test `node --test tests/service.test.mjs` passed 4/4 and the fresh full suite passed 97/97.

No publishing, scheduling, upload, OAuth/credential change, merge, push, PR, or deployment took place. One generated image and its successful local ZIP export remain draft-only; campaign rights/use are not cleared.

## Evidence pointers
- Run plan: `/opt/data/.hermes/plans/2026-11-17_052651-hermes-marketing-finish-today.md`
- Main evidence manifest and assertions: `.artifacts/evidence/marketing-finish-20261117/manifest.json` and `assertions.md`
- Audit supplement: `.artifacts/evidence/marketing-finish-20261117/supplement.md`
- Local draft ZIP: `/opt/data/cache/scratch/cherry-generated-image-full-workflow.zip`
- Generated draft image: `/opt/data/cache/generated/images/openai_codex_gpt-image-2-medium_20261117_154941_6c15c12f.png`

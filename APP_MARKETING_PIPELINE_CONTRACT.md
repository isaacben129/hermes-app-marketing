# App Marketing System — Local Pipeline Contract (v0.1)

**Status:** Implementation contract for a local-only first vertical slice. The UI review surface exists; this contract authorizes the current requested local pipeline build without external services. It does not authorize network connections, content publication, scheduling, spend, or changes to app/store/account state.

## Outcomes and non-goals

Input: an explicitly supplied source record, either manually entered or fixture-labeled. Output: a provenance-linked campaign/experiment brief and ordered static-slide copy draft with a human-review checklist. Records distinguish `sample`, `user_provided`, and later `verified_external` source classes. Fixtures cannot imply market validation, asset license, audience response, or business performance.

No external source ingestion (DarkUGC is currently unauthenticated), generation provider, image generation, platform connection, Postiz writes, publishing, or analytics joins. A local draft is not approval to distribute.

The first local slice's static slide-copy draft is not an image-led renderer. Any later image/text renderer must meet the independent implementation, provenance/rights, quality, and local-preview boundaries in [`SLIDESHOW_RENDER_REFERENCE_POLICY.md`](SLIDESHOW_RENDER_REFERENCE_POLICY.md). The old `app-slideshow-engine` may inform only the abstract responsibility of composing image and text; its code, app-specific logic, campaign content, organization, wording, and assets are excluded. The reference has no declared GitHub license (`license: null`; `LICENSE` returned 404).

## App profile — required before real-app use

Profiles use fictional `App A/B/C` only until verified configuration is supplied. A real profile must have the following fields before claims or performance may be presented as facts:

| Field | Required value | Validation/evidence | Current status |
|---|---|---|---|
| `app_id`, display name, canonical product/store URL | Stable identifier and verified product destination | Owner confirmation plus live product/store listing | Missing |
| `audience` and market | Specific audience, geography, exclusions | Product evidence, not inferred from another app | Missing |
| `approved_claims[]` | Exact claim, evidence reference, allowed wording, expiry/reviewer | Primary product/source evidence; no unsupported superlatives | Missing |
| `cta` | Exact copy and verified destination | URL resolves to intended owned/approved destination | Missing |
| `brand_kit` | Approved assets, colors, fonts, prohibited usages | Owner-provided source and rights/usage scope | Missing |
| `qualified_activation_event` | Canonical event, semantic definition, schema/version | Product analytics owner confirms firing and denominator | Missing |
| `paid_outcome_event` / revenue basis | Canonical event and net/gross, currency, refunds basis | Billing/analytics source and owner validation | Missing |
| `analytics_sources[]`, attribution window, coverage | Systems, identifiers, timestamp semantics, missingness | Read-only connection plus privacy review and test record | Missing |
| `privacy_constraints` | Consent/basis, minimization, retention, deletion, access rules | Privacy owner/legal determination where applicable | Missing |
| `channels[]` and `permissions` | Accounts and allowed operations per channel | Explicit owner permission; operation default read-only | Missing |
| `experiment_policy` | Hypothesis, one variable, exposure/window/minimum evidence | Approved per-app decision rule; otherwise inconclusive | Missing |

Block factual app-specific claims and real outcome reporting when required fields/evidence are absent. `unavailable`, `not connected`, `stale`, and `inconclusive` are distinct from numeric zero.

## Provenance and rights

For each source, claim, slide, and asset retain immutable IDs and parent lineage: source URL/provider, retrieval/creation timestamp, source class, exact quoted text or summarized evidence, author/owner where available, permitted uses/channels, license/permission evidence reference, expiry/withdrawal state, human edits, reviewer, and decision timestamps. Do not copy or store source video/media bytes in this local ledger unless separately authorized; store minimal references/metadata and a citation/link. Never treat access to a video/library as a commercial reuse license. A missing or unclear right is `unknown` and blocks external use; it must not be turned into `allowed` by an automated score.

## Data handling

- Store only the minimum metadata needed for local draft creation/review; no email, credentials, tokens, or unnecessary personal data in creative records.
- Keep audit timestamps and versions; retain deletions/tombstones only if a separately documented policy requires it.
- Provide explicit export/delete path for locally stored drafts; handle storage failure visibly and never silently report unsaved data as saved.
- Log source IDs and transformation versions, not secrets or full private source payloads.
- No cross-app joins or reuse of audiences, event definitions, claims, or accounts unless each app explicitly defines them.
- Missing/failing integrations do not create zero-valued outcome observations.

## DarkUGC connector gate (pending)

The user supplied the server address `https://darkugc.com/mcp`; current unauthenticated MCP initialize returned HTTP 401 `invalid_token` / "Sign in with your DarkUGC account." The product page says it records tool, query, result count and returned videos; video records are retained for 2 days and request records 30 days. Before use, complete the user-controlled sign-in and OAuth approval, verify exact registered tool names and a narrow query, inspect returned source terms/privacy and applicable rights, and only request a small approved pilot. Treat DarkUGC entries as references and analytical observations, not reusable media or proof of product claims. Do not bulk-copy. Re-query or locally preserve only data allowed under current vendor terms; service retention is not permission for our independent storage. Authentication, terms, connector capability, and allowed downstream use remain unverified until tested.

## External action gates

1. DarkUGC: user OAuth approval + verified MCP test before read calls.
2. Postiz: verify account/channel read access first. Any draft-upload/create-post write requires explicit user authorization; scheduling and publishing require separate explicit approval per external boundary. Never make those tool actions part of an automated default.
3. Product analytics/billing: read-only access, validated event semantics and privacy-approved join; report source, denominator, window, freshness, coverage, and missingness.
4. Images/assets: asset-specific provenance and commercial/channel rights; no assumption of provider-generated media availability.

## Local acceptance rubric

1. Given a fixture/manual source item, create a durable local source record with source-class, link, timestamp, and rights=`unknown` unless evidence provided.
2. Given that source, create a brief/hypothesis and versioned ordered slide-copy draft with evidence refs and claim checks; do not assert unsupported facts.
3. Missing app profile, rights, CTA, analytics, or attribution remains explicit and blocks external approval; outcomes stay unavailable, never zero.
4. Edit/save/reopen preserves draft/version lineage; simulate storage failure and verify visible failure/no false success.
5. Local delete removes the draft from active records and is confirmed in storage readback.
6. UI visibly labels fictional fixtures; no route/action can invoke network, Postiz writes, schedules, publishes, media generation, or spend.
7. Exercise main entry → draft creation → edit → save → reload/re-entry → review detail. Mark native Windows renderer as untested until exercised in actual host.

## Canonical source anchors

- User-approved app-agnostic scope and known unresolved app details: `/opt/data/profiles/executive/workspace/slideshow-marketing-design-brief.md` lines 12–32, 37–42, 50–65, 90–97.
- Full lifecycle and app boundary: `/opt/data/profiles/executive/workspace/slideshow-marketing-system-design.md` lines 8–29, 38–40, 66.
- Build status and external gates: `/opt/data/profiles/executive/workspace/app-marketing-system-build-plan.md` lines 16–24, 28–36.
- Postiz endpoint research only (not connected): `/opt/data/profiles/executive/workspace/marketing-postiz-research-2026-11-11.md`.
- DarkUGC supplied landing-page description in this conversation: tools and policies as quoted by vendor; must be reverified after sign-in and before source use.

# Postiz connection capability boundary

The Postiz read-only adapter supports an operator-supplied `POSTIZ_BASE_URL` ending in `/api/public/v1` or `/public/v1` and `POSTIZ_API_KEY` in the local service process environment. It sends GET requests only, requires HTTPS except loopback development, denies redirects, applies request timeouts, and restricts access to documented integrations, posts, and analytics routes. The local app workspace must select the integration explicitly; for Cherry TikTok, use `cmrb2tjm80001ow6vkzhk1yg9`.

## Enable Cherry TikTok analytics

1. Generate a Postiz API key in Postiz settings.
2. Store it in the machine's protected secret manager or service environment as `POSTIZ_API_KEY`. Never place it in chat, plugin storage, request bodies, logs, Git, or exports.
3. Set `POSTIZ_BASE_URL=https://api.postiz.com/public/v1` (or a separately verified self-hosted URL).
4. Configure Cherry's app profile `configuration.channel` to the selected integration ID and approved status.
5. Restart the local marketing service and run its read-only sync. Confirm the selected integration is TikTok. The service has no create/upload/schedule/publish calls.

Without these environment variables the reader remains disconnected. Live analytics reads remain unverified until the user configures the key. Social views/impressions are channel observations, not qualified activations or paid outcomes; their app attribution remains unmapped. App-funnel analytics require a separate approved privacy/event profile and verified app data source.

- `GET /integrations`
- `GET /posts?startDate=...&endDate=...` (including cursor pagination only when the response advertises it)
- `GET /analytics/post/{postId}?date={days}`

This is the **current documented route/response contract**, not a live account verification. The documentation shows `/posts` with `startDate` and `endDate`, integration objects on posts (`id`, `providerIdentifier`, `name`, `picture`), and optional analytics `date` query. Its example analytics response contains per-metric dated buckets with `total` values and `percentageChange`; these fields are treated as provider-provided platform diagnostics, not app-funnel outcomes. The API documents required `Authorization` header but does not establish this account's credential scope, access, rate limits, freshness SLA, or pagination behavior. Those require an authenticated read against the owner's exact deployment and are **not verified** here.

The reader intentionally looks up a post through the list endpoint; the official API documentation reviewed for this integration does not document a single-post GET route. Metric data stays in dated buckets. A numeric zero remains zero; absent or non-finite totals are `unsupported`, never zero. Cached values returned after a failed request are marked stale. Provider authorization failures are not retried and rate-limit retries are bounded to one additional request.

App association requires the profile's approved channel configuration to identify a Postiz integration ID. Posts from other integrations remain unassigned and are not mixed into that app's workspace. Postiz analytics are diagnostic platform metrics; they do not establish qualified starts, paid outcomes, revenue, attribution, or experiment evidence. Those require a separate validated, owner-approved aggregate import and attribution policy. No schedule, publish, edit, or delete provider operation is implemented.

Current live access is **unavailable and unverified**: this environment has no `POSTIZ_API_KEY`, and the previously observed MCP connection timed out while the public host returned 403. No live provider call was made. Health remains disconnected until an actual sync succeeds. Missing configuration yields an explicit unavailable result with no fabricated posts or metrics.

Official API documentation:

- [List posts](https://docs.postiz.com/public-api/posts/list)
- [Integrations](https://docs.postiz.com/public-api/integrations/list)
- [Post analytics](https://docs.postiz.com/public-api/analytics/post)

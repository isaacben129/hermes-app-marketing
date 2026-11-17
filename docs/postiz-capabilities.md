# Postiz connection capability boundary

The local marketing service supports read-only Postiz access through an operator-supplied `POSTIZ_BASE_URL` ending in `/api/public/v1` (or `https://api.postiz.com/public/v1`) and `POSTIZ_API_KEY`. The default client sends `GET` requests only, uses the raw API key in `Authorization`, denies redirects, requires HTTPS except loopback development, applies request timeouts, and allows only these documented paths:

- `GET /integrations`
- `GET /posts?startDate=...&endDate=...` (including cursor pagination only when the response advertises it)
- `GET /analytics/post/{postId}?date={days}`

The reader intentionally looks up a post through the list endpoint; the official API documentation reviewed for this integration does not document a single-post GET route. Metric data stays in dated buckets. A numeric zero remains zero; absent or non-finite totals are `unsupported`, never zero. Cached values returned after a failed request are marked stale. Provider authorization failures are not retried and rate-limit retries are bounded to one additional request.

App association requires the profile's approved channel configuration to identify a Postiz integration ID. Posts from other integrations remain unassigned and are not mixed into that app's workspace. Postiz analytics are diagnostic platform metrics; they do not establish qualified starts, paid outcomes, revenue, attribution, or experiment evidence. Those require a separate validated, owner-approved aggregate import and attribution policy. No schedule, publish, edit, or delete provider operation is implemented.

Current live access is **unavailable and unverified**: this environment has no `POSTIZ_API_KEY`, and the previously observed MCP connection timed out while the public host returned 403. No live provider call was made. Health remains disconnected until an actual sync succeeds. Missing configuration yields an explicit unavailable result with no fabricated posts or metrics.

Official API documentation:

- [List posts](https://docs.postiz.com/public-api/posts/list)
- [Integrations](https://docs.postiz.com/public-api/integrations/list)
- [Post analytics](https://docs.postiz.com/public-api/analytics/post)

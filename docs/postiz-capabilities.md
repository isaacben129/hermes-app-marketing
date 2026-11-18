# Postiz connection capability boundary

The Postiz API key belongs in the main Hermes profile's central secrets file, outside the repository—not in a project `.env`. The reader uses `POSTIZ_API_KEY` and `POSTIZ_BASE_URL`; the local `scripts/start-local.mjs` launcher can load them from one owner-only file (on Linux/WSL, `chmod 600`). The proposed launcher variable is `HERMES_MARKETING_SECRETS_FILE`. A safe fallback location is `/opt/data/.config/hermes/marketing-secrets.env` **only if you decide to create it**; this is not a built-in Hermes-managed vault or an existing verified file. Include `POSTIZ_BASE_URL=https://api.postiz.com/public/v1`. Keep credentials out of chat, Git, logs, and repo `.env` files.

Integration IDs are explicit configuration values (one ID or a list per app); never auto-assign every Postiz account to every app. Read-only sync matches posts to selected IDs, keeps per-integration analytics separately identifiable, and excludes all other accounts. To bind accounts, choose IDs from `GET /integrations` and save them to that app's channel configuration.

- `GET /integrations`
- `GET /posts?startDate=...&endDate=...` (including cursor pagination only when the response advertises it)
- `GET /analytics/{integrationId}?date={days}`
- `GET /analytics/post/{postId}?date={days}`

Numeric zero remains zero. Unsupported values remain unavailable rather than becoming zero. Social platform metrics carry `attribution: unmapped` and must not be labelled as app conversions or revenue. No remote write, schedule, publish or delete capability is included.

Live analytics access remains unverified until the owner supplies a local key and runs the sync. Do not paste the key in chat or commit it.

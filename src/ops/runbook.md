# Local marketing service operations

## Start and connect

Run `scripts/start-local.mjs` with an absolute `HERMES_MARKETING_DATA_DIR`. The service binds to loopback and writes a private `connection.json` containing its local URL and bearer token. The token is not returned by API responses. Delete the local connection file by stopping the service normally.

Postiz remains disconnected until an operator configures `POSTIZ_BASE_URL` (ending in `/api/public/v1` or the official `https://api.postiz.com/public/v1`, HTTPS required except loopback) and `POSTIZ_API_KEY`, then sends an authenticated `POST /api/postiz/sync` request with an app name, ISO date window, and 1–365 day metric lookback. Only GET routes documented in [Postiz capabilities](../../docs/postiz-capabilities.md) are used. Never put provider credentials in plugin storage, request bodies, source references, or exported artifacts.

## Safe recovery

A failed local render job can be retried through the protected retry route. A stale workspace revision returns `409 stale_revision`; reload the app workspace before retrying a write. Persistence or renderer failures return safe error codes without returning success-shaped records. Job details are reconstructed from durable lifecycle events.

Postiz authorization, rate-limit, timeout, and invalid response failures produce an unavailable sync result. Previously successful Postiz data remains available only as explicitly stale data. Do not interpret platform analytics as attributed business outcomes. Import owner-approved aggregate rows only after the app profile has approved event definitions and privacy settings.

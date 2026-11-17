# Local marketing service operations

## Start and connect

Choose a private local directory, set its absolute path as `HERMES_MARKETING_DATA_DIR`, and run `npm run start:local`. This wrapper is declared in `package.json` and starts `scripts/start-local.mjs`. The service binds only to loopback, supervises the Python/Pillow renderer, creates a private `connection.json` containing its URL and bearer token, and removes that file on clean shutdown. Read the connection details only on this device; do not paste the token into chat, source files, Git, or exports. The data directory contains local workspace records and content-addressed images; back it up as private application data.

The UI service token is stored in local Hermes plugin storage and sent only in the Authorization header to the configured loopback service. An opaque `Origin: null` is accepted only when `HERMES_MARKETING_ALLOWED_ORIGIN=null` is explicitly set; missing origin is never treated as permission. If the UI uses a network origin, configure that exact origin before startup. Do not use a wildcard or expose the listener to a LAN.

## Postiz and outcomes

Postiz remains disconnected unless the service process is configured with `POSTIZ_BASE_URL` (ending in `/api/public/v1` or the official `https://api.postiz.com/public/v1`, HTTPS required except loopback) and `POSTIZ_API_KEY`. The adapter is GET-only. Configure these values in the service process's protected environment; never place provider credentials in plugin storage, request bodies, logs, source references, or exported artifacts. The provider credential and live account access were not verified here.

Only a read-only Postiz sync is exposed in the UI. Platform engagement is not an app outcome. Import owner-approved aggregate outcome rows only after the profile has approved event definitions, privacy settings, and an attribution policy. Missing, stale, suppressed, unsupported, and unconfigured data must not be treated as zero.

## Safe recovery

A failed local render can be retried through the protected retry route. A stale workspace revision returns `409 stale_revision`; reload service-owned records before retrying a write. Renderer or persistence failures return safe error codes and do not create success-shaped records. Job history is reconstructed from durable lifecycle events. An interrupted renderer or service can be restarted by the operator; do not delete the data directory to recover.

No Postiz draft-write, schedule, publish, spend, or external message operation is provided. Successful rendering/export is not creative, rights, claim, CTA, or distribution approval.

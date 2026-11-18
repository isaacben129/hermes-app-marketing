# Local marketing service operations

## Start and connect

Choose a private local directory, set its absolute path as `HERMES_MARKETING_DATA_DIR`, and run `npm run start:local`. This wrapper is declared in `package.json` and starts `scripts/start-local.mjs`. The service binds only to loopback, supervises the Python/Pillow renderer, creates a private `connection.json` containing its URL and bearer token, and removes that file on clean shutdown. Read the connection details only on this device; do not paste the token into chat, source files, Git, or exports. The data directory contains local workspace records and content-addressed images; back it up as private application data.

If the UI uses a network origin, configure that exact origin. The UI accepts loopback HTTP service URLs only; its hostname may be `127.0.0.1`, `localhost`, or `[::1]`. The service accepts those three Host names only when the port exactly matches its own listener, which remains bound to `127.0.0.1`. Missing origin is never allowed, and `null` is not a permissive wildcard. Do not use `*` or expose the listener to a LAN.

## Postiz and outcomes

Postiz remains disconnected unless the service process has `POSTIZ_BASE_URL` and `POSTIZ_API_KEY`. The optional local launcher can load those values from one central owner-only secrets file outside the repository, selected through `HERMES_MARKETING_SECRETS_FILE`; Linux/WSL mode must be `0600`. The suggested `/opt/data/.config/hermes/marketing-secrets.env` is a path you may create—not a built-in Hermes vault or verified existing location. Do not add per-project `.env` files, put credentials in plugin/workspace data, or commit secrets. All Postiz calls are GET-only. Credential access has not yet been verified.

Only a read-only Postiz sync is exposed in the UI. Platform engagement is not an app outcome. Import owner-approved aggregate outcome rows only after the profile has approved event definitions, privacy settings, and an attribution policy. Missing, stale, suppressed, unsupported, and unconfigured data must not be treated as zero.

## Safe recovery

A failed local render can be retried through the protected retry route. A stale workspace revision returns `409 stale_revision`; reload service-owned records before retrying a write. Renderer or persistence failures return safe error codes and do not create success-shaped records. Job history is reconstructed from durable lifecycle events. An interrupted renderer or service can be restarted by the operator; do not delete the data directory to recover.

No Postiz draft-write, schedule, publish, spend, or external message operation is provided. Successful rendering/export is not creative, rights, claim, CTA, or distribution approval.

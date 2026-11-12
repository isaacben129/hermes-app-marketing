# Operations runbook

## System health and job detail

The health view consumes an explicit snapshot supplied by its caller. It does not probe services or imply that the prototype has production telemetry. `observedAt` (or `timestamp`) is the snapshot observation time; the default freshness threshold is five minutes and callers may provide `now` and `staleAfterMs` for deterministic evaluation. Missing snapshots are unavailable; missing or over-age timestamps are stale. Unknown service statuses degrade the overall state instead of appearing healthy.

Metrics are caller-provided values. A missing, null, or non-finite metric is shown as `Unavailable`, never as zero. Empty metrics and service lists are described as unavailable. Retry, pause, and resume buttons are disabled without callbacks and do nothing until clicked; supplied callbacks run only on the click, with the job ID passed by job detail actions. This UI does not make provider calls or send alerts.

Job detail takes an explicit job record and displays its supplied identity, status, creation time, and event chronology ordered by timestamp (stable for equal or absent timestamps). Error text is redacted for bearer credentials and common `api_key`, token, password, and secret assignments before display. Supply only the minimum diagnostic detail appropriate to the operator; redaction is defense in depth, not a license to pass secrets.

No production worker, queue, service-health provider, or live metric source is implemented here. Integrate a real snapshot producer and explicit action handlers before treating the view as operational. Until then use the unavailable state; do not fabricate snapshots or health values.

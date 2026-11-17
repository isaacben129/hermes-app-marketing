# App Marketing System · Hermes Desktop plugin

The Marketing page is a service-backed workflow for app-scoped drafts, profile evidence, asset intake, creative review, rendering, exports, experiment decisions, and aggregate outcomes. It starts on Cherry and does not assume campaign facts, rights, approvals, or business metrics.

## Local services

Start the marketing API at `http://127.0.0.1:8764` and configure its browser CORS allowlist for the origin that will host the UI. In the page's **AppSettings**, enter that loopback URL and a bearer token. The token is stored only in Hermes plugin storage on this device and is sent only as the service Authorization header. The UI asks the service for health and the protected Cherry workspace; drafts, profiles, and decisions are then read from the service.

Use **Overview** to open a service draft, create a blank draft, inspect read-only outcomes, or request a read-only Postiz sync. In **Slideshows**, edit structured slides and evidence, save by expected revision, attach an operator supplied image, run service review, render the saved revision, select a thumbnail, and download the service ZIP artifact. The service owns validation, content references, review status, and durable revision changes. Unknown rights, unassessed quality, and missing evidence stay visibly blocked. No publish, schedule, or provider draft-write action is exposed.

The other views provide service health/job detail, aggregate outcome import, and an experiment recommendation form. An unconfigured policy yields an inconclusive service decision. No UI-side fallback fabricates posts or observations.

## Browser QA preview

Run `npm ci`, then `npm run preview`. Visit [http://127.0.0.1:8766](http://127.0.0.1:8766) and allow that exact origin in the marketing service CORS configuration. This harness renders the same `src/desktop/entry.js` using a clearly labeled browser-only Hermes SDK shim and browser local storage. Its file picker uses browser permissions; it does not verify native Hermes host behavior. It loads only actual service data.

Build the production plugin bundle and byte-identical mirrors with `npm run build`. The native bundle leaves React, JSX runtime, and `@hermes/plugin-sdk` external so the host supplies its own runtime.

## Verification

```sh
npm test
npm run build
```

The registered React workflow tests cover connection/auth, service-owned records, revision checked save/readback, rendering by saved revision, offline error handling, and the no fabricated data state. Service integration still needs to be exercised against the combined API once its owner lands the referenced route contracts; unit interaction tests mock only the HTTP boundary.

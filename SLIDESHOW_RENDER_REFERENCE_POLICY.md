# Slideshow Renderer Reference Policy

**Status:** Binding implementation boundary for the app-marketing system. This document defines what may and may not be taken from `app-slideshow-engine`; it does not authorize importing its code or changing project/authority selection.

## Decision

`app-slideshow-engine` is a noncanonical reference, not a product specification, source of campaign logic, or implementation dependency. Its GitHub repository has no declared license (`license: null`); the repository's `LICENSE` path returned 404. Do not copy, adapt, vendor, or derive implementation from its source.

The reference renderer is app-specific. Its coupling is not an acceptable foundation for this product. Do not copy its campaign content or logic, structure or organization, wording, or assets either. Similarity of a rendering task does not grant permission to reuse those materials. Keep this project independently designed and implemented.

## Permitted reference use

Use the old project only to identify the abstract responsibilities of rendering an image-led slide with text (for example: accepting image and text inputs, composing them, and producing a preview/output). Do not reproduce its design, implementation, templates, sequencing, copy, campaign concepts, or asset choices. Build a new renderer against this product's acceptance contract and independently sourced or generated assets with explicit provenance and rights.

## Implementation acceptance boundary

A future image/text renderer is acceptable only when its own tests and inspected output establish all of the following:

- Image and text are independently supplied inputs; neither depends on copied campaign content or app-specific assumptions.
- A slide visibly composes real imagery with readable text at the required target aspect ratio; blank/static text-only slides do not satisfy the image-led renderer requirement.
- Image provenance, rights/allowed use, and claim/source lineage are recorded. Unknown rights block external use; rendering or generation does not itself grant a license.
- Quality checks cover image presence/crop, text overflow/readability, contrast, and target-size preview. A successful render response alone is not evidence of acceptable creative quality.
- The renderer produces a local preview/draft only. No provider generation, external upload, schedule, publish, or other network write is implied or authorized.

## Operating-loop acceptance boundary

The renderer is only one component. Product acceptance for the operating loop requires evidence that:

1. One pipeline record appears as a card in the main workspace and stays connected through create, render, edit, save, and re-entry; do not create a separate disconnected demo pipeline.
2. The operator can see job state and system health, including unavailable, failed, and stale states; do not present absent services or data as healthy/successful.
3. Drafts persist locally and reopen with version and source lineage; storage failures are visible and never produce a false saved state.
4. Rights/provenance, claim evidence, and quality checks are explicit and reviewable; unknown/missing requirements block external approval.
5. Human approval is explicit and precedes any external action. Local draft creation or a renderer success is not approval to distribute.
6. Postiz remains write-disabled. Read access may be described or tested only after actual account/channel access is verified; do not claim it is connected beforehand. Draft creation/upload, scheduling, and publishing each remain unauthorized unless separately and explicitly approved.
7. Metrics are shown only when backed by actual accessible sources and validated event semantics. Without access, show unavailable/inconclusive—not zero, estimates, or fabricated performance.

## Evidence and scope

Acceptance tests should exercise the actual user-visible operating loop and renderer output, not just helper functions, static text assertions, or mocked success. Record each unverified external dependency as pending/untested with its exact gate. Do not change authority or project selection as part of implementing this boundary. This is a product contract, not evidence that any acceptance criterion has already been implemented.

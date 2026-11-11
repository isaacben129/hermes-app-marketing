# Renderer contract (first version)

- Deterministically render ordered text slides to PNG, default 1080×1350 (4:5), using the local Python Pillow service.
- Each slide uses editable title/body copy; output and source manifest are reproducible from the original text and selected built-in palette.
- No external images, fonts, network calls, user media, or app claims are silently introduced. Asset rights must be clear before image assets can be added.
- Validate unsupported themes and overflow/fit. Preserve copy source in the ZIP manifest and individual PNGs.
- Hermes UI calls the loopback-only renderer only on explicit user action, previews output, and downloads files locally; no background or external upload.
- First UI scope: render fixture pipeline static text into image slides and export. It remains illustrative, not an approved campaign creative. Do not use app-specific branding or treat sample copy as validated.

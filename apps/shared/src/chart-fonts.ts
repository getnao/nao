/**
 * Charts render both in the browser and, server-side, through resvg — a Rust
 * SVG renderer that resolves no CSS keyword. `system-ui` alone leaves resvg
 * without a family to match, so it draws the shapes and silently skips every
 * glyph. Naming a concrete embedded family first keeps server text visible,
 * while browsers that lack it fall through to their own system font.
 */
export const CHART_EMBEDDED_FONT_FAMILY = 'DejaVu Sans';

export const CHART_FONT_STACK = `'${CHART_EMBEDDED_FONT_FAMILY}', system-ui, sans-serif`;

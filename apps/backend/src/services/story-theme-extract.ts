/**
 * Pull design signals off a public website.
 *
 * Deliberately static: fetch the HTML, follow first-party stylesheets, and read
 * what is declarable. No headless browser, so no Playwright in the OSS install
 * path and no arbitrary JS execution on a URL an admin typed.
 *
 * The cost of that choice is real. A site that only expresses its system
 * through computed styles (CSS-in-JS with hashed class names, for example) will
 * yield thinner signals than one that publishes custom properties. That is why
 * this returns *candidates* with frequency counts rather than a finished theme:
 * the inference step decides which candidate plays which role, and the admin
 * gets the last word.
 */

import { FONT_CDN_HOSTS } from '@nao/shared/story-theme';

import { type ProbeResult, probeWithBrowser } from './story-theme-probe';

export type SourceKind = 'url' | 'manual';
export type ExtractionMode = 'rendered' | 'static';

export interface ColorCandidate {
	hex: string;
	/** How many declarations referenced it. A proxy for how load-bearing it is. */
	count: number;
	/** Properties it appeared in, e.g. `background-color`, `color`, `border`. */
	properties: string[];
}

export interface DesignSignals {
	url: string;
	/**
	 * `rendered` means we interrogated computed styles, which is the only way to
	 * read a CSS-in-JS design system. `static` means Chromium was unavailable and
	 * we fell back to parsing stylesheet text, which sees far less.
	 */
	mode: ExtractionMode;
	/** Present only in `rendered` mode: role-tagged computed styles. */
	probe: ProbeResult | null;
	/** The one or two colours that read as the brand, most salient first. */
	brandCandidates: { color: string; chroma: number; sources: string[] }[];
	title: string | null;
	/** Declared `--*` custom properties whose value looks like a colour. */
	customProperties: Record<string, string>;
	colors: ColorCandidate[];
	fontFamilies: { stack: string; count: number }[];
	/** Declared border-radius values in px, most frequent first. */
	radii: { px: number; count: number }[];
	/** True when the page's own body/background reads as dark. */
	prefersDarkGround: boolean;
	/** Notes surfaced to the admin when extraction was thin or partial. */
	warnings: string[];
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_CSS_BYTES = 1_500_000;
const MAX_STYLESHEETS = 6;
const USER_AGENT = 'nao-design-system-bot/1.0 (+https://getnao.io)';

/**
 * Reject anything that is not a public http(s) host. An admin-supplied URL is
 * fetched server-side, so without this the field is an SSRF hole pointed at the
 * cluster's own metadata endpoints.
 */
export function assertPublicHttpUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('That does not look like a valid URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only http and https URLs are supported.');
	}
	const host = url.hostname.toLowerCase();
	const blocked =
		host === 'localhost' ||
		host === '::1' ||
		host.endsWith('.localhost') ||
		host.endsWith('.internal') ||
		host.endsWith('.local') ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^169\.254\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host);
	if (blocked) {
		throw new Error('Private and loopback addresses cannot be used as a design source.');
	}
	return url;
}

export async function extractDesignSignals(rawUrl: string): Promise<DesignSignals> {
	const url = assertPublicHttpUrl(rawUrl);

	let renderReason: string;
	try {
		return await renderedSignals(url);
	} catch (error) {
		renderReason = error instanceof Error ? error.message : String(error);
	}

	// Chromium missing is an install-shape problem, not a bad URL: degrade rather
	// than fail, and say plainly that the read was shallower.
	try {
		const fallback = await staticSignals(url);
		fallback.warnings.unshift(
			`Could not render the page (${renderReason}). Fell back to reading stylesheet text, which misses design systems defined at runtime.`,
		);
		return fallback;
	} catch (staticError) {
		// Both paths failed. The rendered attempt has the more useful diagnosis
		// (bot protection, bad status) so that is what the admin should read,
		// not a bare "403 Forbidden" from the fallback.
		const staticReason = staticError instanceof Error ? staticError.message : String(staticError);
		throw new Error(`${renderReason} Reading the stylesheets directly also failed (${staticReason}).`);
	}
}

async function renderedSignals(url: URL): Promise<DesignSignals> {
	const probe = await probeWithBrowser(url.toString(), [...FONT_CDN_HOSTS]);
	return signalsFromProbe(probe, url.toString());
}

/**
 * Turn a probe result into design signals.
 *
 * Shared by the server-rendered path and the browser-capture path, so a theme
 * inferred from a pasted capture goes through exactly the same mapping as one
 * inferred from a URL we could fetch ourselves.
 */
export function signalsFromProbe(probe: ProbeResult, url: string): DesignSignals {
	const warnings: string[] = [];

	const unloadable = probe.fonts.filter((f) => !f.loadable).map((f) => f.family);
	if (unloadable.length) {
		warnings.push(
			`${unloadable.slice(0, 4).join(', ')} ${unloadable.length === 1 ? 'is' : 'are'} served from the brand's own domain under their licence, so nao cannot load ${unloadable.length === 1 ? 'it' : 'them'}. The closest fallback is used instead.`,
		);
	}
	if (!probe.roles.primaryButton) {
		warnings.push('No filled button was found, so control shape and accent are inferred from other elements.');
	}
	if (probe.colors.length < 4) {
		warnings.push('The page paints very few distinct colours; the palette is largely nao defaults.');
	}

	return {
		url,
		mode: 'rendered',
		probe,
		title: probe.title,
		brandCandidates: probe.brandCandidates.map((c) => ({ color: c.color, chroma: c.chroma, sources: c.sources })),
		customProperties: probe.customProperties,
		colors: probe.colors.map((c) => ({ hex: c.color, count: c.area, properties: c.properties })),
		fontFamilies: probe.fonts.map((f) => ({ stack: f.family, count: f.loadable ? 2 : 1 })),
		radii: probe.radii,
		prefersDarkGround: probe.prefersDarkGround,
		warnings,
	};
}

async function staticSignals(url: URL): Promise<DesignSignals> {
	const warnings: string[] = [];

	const html = await fetchText(url.toString(), MAX_HTML_BYTES);
	const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;

	const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
	const sheetUrls = resolveStylesheetUrls(html, url).slice(0, MAX_STYLESHEETS);

	const sheets: string[] = [];
	for (const href of sheetUrls) {
		try {
			sheets.push(await fetchText(href, MAX_CSS_BYTES));
		} catch {
			warnings.push(`Could not read stylesheet ${href}`);
		}
	}
	if (sheetUrls.length === 0 && !inline) {
		warnings.push('No stylesheets found on the page; signals come from inline attributes only.');
	}

	const css = [inline, ...sheets].join('\n');
	const customProperties = collectCustomProperties(css);
	const colors = collectColors(css, customProperties);
	const fontFamilies = collectFontFamilies(css);
	const radii = collectRadii(css);

	if (colors.length < 4) {
		warnings.push('Few colours could be read. This site likely styles itself at runtime rather than in CSS.');
	}
	if (fontFamilies.length === 0) {
		warnings.push('No font families declared in CSS; typography will fall back to the nao defaults.');
	}

	return {
		url: url.toString(),
		mode: 'static',
		probe: null,
		title,
		brandCandidates: [],
		customProperties,
		colors,
		fontFamilies,
		radii,
		prefersDarkGround: looksDarkGround(css, colors),
		warnings,
	};
}

async function fetchText(href: string, maxBytes: number): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(href, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/css,*/*' },
		});
		if (!res.ok) {
			throw new Error(`${res.status} ${res.statusText}`);
		}
		const text = await res.text();
		return text.length > maxBytes ? text.slice(0, maxBytes) : text;
	} finally {
		clearTimeout(timer);
	}
}

function resolveStylesheetUrls(html: string, base: URL): string[] {
	const out: string[] = [];
	const linkRe = /<link\b[^>]*>/gi;
	for (const [tag] of html.matchAll(linkRe)) {
		if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) {
			continue;
		}
		const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
		if (!href) {
			continue;
		}
		try {
			const resolved = new URL(href, base);
			// First-party plus Google Fonts, which is where brand faces are declared.
			if (resolved.hostname === base.hostname || resolved.hostname.endsWith('fonts.googleapis.com')) {
				out.push(resolved.toString());
			}
		} catch {
			/* skip malformed href */
		}
	}
	return [...new Set(out)];
}

function collectCustomProperties(css: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)[;}]/gi)) {
		const v = value.trim();
		if (v.length > 120) {
			continue;
		}
		const hex = normalizeColor(v);
		if (hex) {
			out[name.toLowerCase()] = hex;
		}
	}
	return out;
}

const COLOR_PROPERTIES = ['background-color', 'background', 'color', 'border-color', 'border', 'fill', 'stroke'];

function collectColors(css: string, customProperties: Record<string, string>): ColorCandidate[] {
	const tally = new Map<string, { count: number; properties: Set<string> }>();

	const bump = (hex: string, property: string) => {
		const entry = tally.get(hex) ?? { count: 0, properties: new Set<string>() };
		entry.count++;
		entry.properties.add(property);
		tally.set(hex, entry);
	};

	for (const [, property, value] of css.matchAll(
		/([a-z-]+)\s*:\s*([^;{}]*(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))[^;{}]*)[;}]/gi,
	)) {
		const prop = property.toLowerCase();
		if (!COLOR_PROPERTIES.includes(prop) && !prop.startsWith('--')) {
			continue;
		}
		for (const token of value.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) ?? []) {
			const hex = normalizeColor(token);
			if (hex) {
				bump(hex, prop);
			}
		}
	}

	// Custom properties are intentional design decisions, so weight them up.
	for (const hex of Object.values(customProperties)) {
		bump(hex, '--custom-property');
		bump(hex, '--custom-property');
	}

	return [...tally.entries()]
		.map(([hex, v]) => ({ hex, count: v.count, properties: [...v.properties] }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 40);
}

/** Normalise hex/rgb/hsl to `#rrggbb`, dropping anything transparent. */
export function normalizeColor(raw: string): string | null {
	const value = raw.trim().toLowerCase();

	const hex = /^#([0-9a-f]{3,8})$/.exec(value);
	if (hex) {
		const h = hex[1];
		if (h.length === 3) {
			return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
		}
		if (h.length === 6) {
			return `#${h}`;
		}
		if (h.length === 8) {
			return parseInt(h.slice(6, 8), 16) < 24 ? null : `#${h.slice(0, 6)}`;
		}
		return null;
	}

	const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
	if (rgb) {
		const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
		if (parts.length < 3) {
			return null;
		}
		if (parts.length > 3 && Number(parts[3]) < 0.1) {
			return null;
		}
		const [r, g, b] = parts.slice(0, 3).map((p) => clampByte(Number(p.replace('%', ''))));
		return toHex(r, g, b);
	}

	const hsl = /^hsla?\(([^)]+)\)$/.exec(value);
	if (hsl) {
		const parts = hsl[1].split(/[\s,/]+/).filter(Boolean);
		if (parts.length < 3) {
			return null;
		}
		if (parts.length > 3 && Number(parts[3]) < 0.1) {
			return null;
		}
		const h = Number(parts[0].replace('deg', ''));
		const s = Number(parts[1].replace('%', '')) / 100;
		const l = Number(parts[2].replace('%', '')) / 100;
		if ([h, s, l].some(Number.isNaN)) {
			return null;
		}
		return hslToHex(h, s, l);
	}

	return null;
}

function clampByte(n: number): number {
	if (Number.isNaN(n)) {
		return 0;
	}
	return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hslToHex(h: number, s: number, l: number): string {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const [r1, g1, b1] =
		hp < 1
			? [c, x, 0]
			: hp < 2
				? [x, c, 0]
				: hp < 3
					? [0, c, x]
					: hp < 4
						? [0, x, c]
						: hp < 5
							? [x, 0, c]
							: [c, 0, x];
	const m = l - c / 2;
	return toHex(clampByte((r1 + m) * 255), clampByte((g1 + m) * 255), clampByte((b1 + m) * 255));
}

function collectFontFamilies(css: string): { stack: string; count: number }[] {
	const tally = new Map<string, number>();
	for (const [, value] of css.matchAll(/font-family\s*:\s*([^;{}]+)[;}]/gi)) {
		const stack = value.replace(/\s+/g, ' ').trim();
		if (!stack || stack.length > 200 || stack.startsWith('var(')) {
			continue;
		}
		tally.set(stack, (tally.get(stack) ?? 0) + 1);
	}
	return [...tally.entries()]
		.map(([stack, count]) => ({ stack, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 12);
}

function collectRadii(css: string): { px: number; count: number }[] {
	const tally = new Map<number, number>();
	for (const [, value] of css.matchAll(/border-radius\s*:\s*([^;{}]+)[;}]/gi)) {
		const first = value.trim().split(/\s+/)[0];
		const px = /^(\d+(?:\.\d+)?)px$/.exec(first)
			? Number(RegExp.$1)
			: /^(\d+(?:\.\d+)?)rem$/.exec(first)
				? Number(RegExp.$1) * 16
				: null;
		if (px === null || px > 64) {
			continue;
		}
		const rounded = Math.round(px);
		tally.set(rounded, (tally.get(rounded) ?? 0) + 1);
	}
	return [...tally.entries()]
		.map(([px, count]) => ({ px, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 6);
}

function looksDarkGround(css: string, colors: ColorCandidate[]): boolean {
	const bodyBlock = /body\s*\{([^}]*)\}/i.exec(css)?.[1] ?? '';
	const declared = /background(?:-color)?\s*:\s*([^;]+)/i.exec(bodyBlock)?.[1];
	const hex = declared ? normalizeColor(declared.trim().split(/\s+/)[0]) : null;
	const target = hex ?? colors.find((c) => c.properties.includes('background-color'))?.hex;
	if (!target) {
		return false;
	}
	const r = parseInt(target.slice(1, 3), 16) / 255;
	const g = parseInt(target.slice(3, 5), 16) / 255;
	const b = parseInt(target.slice(5, 7), 16) / 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.25;
}

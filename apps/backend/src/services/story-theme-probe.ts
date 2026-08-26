/**
 * Read a brand's design system the way a browser sees it.
 *
 * The first version of this parsed stylesheets as text. That works on sites
 * that publish a token set in `:root`, and fails on everything built with
 * CSS-in-JS: such a site may expose only a handful of custom properties, while
 * its real system (the CTA fill, the accent, card and pill radii, its licensed
 * faces) exists only in computed styles behind hashed class names. Parsing text
 * there yields a soup of frequency-counted colours and the model has nothing to
 * map.
 *
 * So we render the page and interrogate real elements, which is what a designer
 * does by hand. Static parsing survives as a fallback for installs with no
 * Chromium.
 */

import type { Browser } from 'puppeteer-core';

import { getBrowser } from '../utils/headless-browser';

export interface ElementStyle {
	background: string | null;
	color: string | null;
	fontFamily: string | null;
	fontSize: number | null;
	fontWeight: string | null;
	letterSpacing: number | null;
	borderRadius: number | null;
	borderColor: string | null;
	hasBorder: boolean;
	hasShadow: boolean;
	sample: string | null;
}

export interface ProbeResult {
	title: string | null;
	/** Computed `--*` values from the document root: the strongest signal there is. */
	customProperties: Record<string, string>;
	/** Role-tagged computed styles from elements the probe identified on the page. */
	roles: {
		body: ElementStyle | null;
		heading: ElementStyle | null;
		bodyText: ElementStyle | null;
		primaryButton: ElementStyle | null;
		secondaryButton: ElementStyle | null;
		card: ElementStyle | null;
		input: ElementStyle | null;
	};
	/** Backgrounds of the largest surfaces, most page area first. */
	surfaces: { color: string; area: number }[];
	/** Colours weighted by how much of the page they actually paint. */
	colors: { color: string; area: number; properties: string[] }[];
	radii: { px: number; count: number }[];
	/** Families the page loaded, and whether we can load them too. */
	fonts: { family: string; loadable: boolean }[];
	fontLinks: string[];
	prefersDarkGround: boolean;
}

const NAV_TIMEOUT_MS = 20_000;
const VIEWPORT = { width: 1440, height: 900 };
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 nao-design-system-bot/1.0 (+https://getnao.io)';

/**
 * Runs inside the page. Stringified and evaluated, so it cannot close over
 * anything from this module and must stay self-contained.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function pageProbe(allowedFontHosts: string[]): ProbeResult {
	const px = (v: string | null | undefined): number | null => {
		if (!v) {
			return null;
		}
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : null;
	};

	const opaque = (raw: string | null | undefined): string | null => {
		if (!raw) {
			return null;
		}
		const m = /^rgba?\(([^)]+)\)$/.exec(raw.trim());
		if (!m) {
			return null;
		}
		const parts = m[1]
			.split(/[\s,/]+/)
			.filter(Boolean)
			.map(Number);
		if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) {
			return null;
		}
		// Anything close to transparent carries no design intent.
		if (parts.length > 3 && parts[3] < 0.35) {
			return null;
		}
		const hex = parts
			.slice(0, 3)
			.map((n) =>
				Math.max(0, Math.min(255, Math.round(n)))
					.toString(16)
					.padStart(2, '0'),
			)
			.join('');
		return `#${hex}`;
	};

	const luminance = (hex: string): number => {
		const ch = (i: number) => {
			const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
			return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
	};

	const visible = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) {
			return false;
		}
		const cs = getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.1;
	};

	const describe = (el: Element | null): ElementStyle | null => {
		if (!el) {
			return null;
		}
		const cs = getComputedStyle(el);
		const ls = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
		const size = px(cs.fontSize);
		return {
			background: opaque(cs.backgroundColor),
			color: opaque(cs.color),
			fontFamily: cs.fontFamily || null,
			fontSize: size,
			fontWeight: cs.fontWeight || null,
			// Tracking is only meaningful relative to size, so normalise to em.
			letterSpacing: ls !== null && size ? Number((ls / size).toFixed(4)) : 0,
			borderRadius: px(cs.borderTopLeftRadius),
			borderColor: cs.borderTopWidth !== '0px' ? opaque(cs.borderTopColor) : null,
			hasBorder: cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none',
			hasShadow: cs.boxShadow !== 'none' && cs.boxShadow.length > 0,
			sample: (el.textContent || '').trim().slice(0, 40) || null,
		};
	};

	/* ------------------------------------------------ custom properties */
	const customProperties: Record<string, string> = {};
	const rootStyle = getComputedStyle(document.documentElement);
	const names = new Set<string>();
	// Chrome exposes custom properties on the computed style object; older
	// builds do not, so also harvest declared names from same-origin sheets.
	for (let i = 0; i < rootStyle.length; i++) {
		const n = rootStyle[i];
		if (n.startsWith('--')) {
			names.add(n);
		}
	}
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList | null = null;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const rule of Array.from(rules ?? [])) {
			const style = (rule as any).style as CSSStyleDeclaration | undefined;
			if (!style) {
				continue;
			}
			for (let i = 0; i < style.length; i++) {
				if (style[i].startsWith('--')) {
					names.add(style[i]);
				}
			}
		}
	}
	for (const name of names) {
		const value = rootStyle.getPropertyValue(name).trim();
		if (value && value.length < 120) {
			customProperties[name] = value;
		}
	}

	/* ------------------------------------------------------ role finding */
	const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(visible).slice(0, 4000);
	const bodyStyle = getComputedStyle(document.body);
	const pageBg = opaque(bodyStyle.backgroundColor) ?? '#ffffff';

	const area = (el: Element) => {
		const r = el.getBoundingClientRect();
		return Math.max(0, r.width) * Math.max(0, r.height);
	};

	// Heading: the largest text actually rendered, not merely the first <h1>.
	let heading: HTMLElement | null = null;
	let headingSize = 0;
	for (const el of all) {
		if (!/^H[1-3]$/.test(el.tagName) && !(el.children.length === 0 && (el.textContent || '').trim().length > 8)) {
			continue;
		}
		const size = px(getComputedStyle(el).fontSize) ?? 0;
		if (size > headingSize && size >= 22) {
			headingSize = size;
			heading = el;
		}
	}

	// Body text: the most common font-size among paragraph-like leaves.
	const sizeTally = new Map<number, { count: number; el: HTMLElement }>();
	for (const el of all) {
		const text = (el.textContent || '').trim();
		if (el.children.length !== 0 || text.length < 25) {
			continue;
		}
		const size = Math.round(px(getComputedStyle(el).fontSize) ?? 0);
		if (size < 10 || size > 24) {
			continue;
		}
		const entry = sizeTally.get(size);
		sizeTally.set(size, { count: (entry?.count ?? 0) + 1, el: entry?.el ?? el });
	}
	const bodyText = [...sizeTally.values()].sort((a, b) => b.count - a.count)[0]?.el ?? null;

	// Buttons: a filled one carries the accent, an outlined one the border style.
	const clickable = all.filter(
		(el) =>
			el.tagName === 'BUTTON' ||
			el.tagName === 'A' ||
			el.getAttribute('role') === 'button' ||
			/(^|\s)(btn|button|cta)(\s|$|-)/i.test(el.className || ''),
	);
	let primaryButton: HTMLElement | null = null;
	let secondaryButton: HTMLElement | null = null;
	for (const el of clickable) {
		const cs = getComputedStyle(el);
		const bg = opaque(cs.backgroundColor);
		const a = area(el);
		if (a < 600 || a > 90_000) {
			continue;
		}
		if (bg && bg !== pageBg) {
			if (!primaryButton || area(primaryButton) < a) {
				primaryButton = el;
			}
		} else if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') {
			if (!secondaryButton || area(secondaryButton) < a) {
				secondaryButton = el;
			}
		}
	}

	// Card: a mid-sized block that lifts off the page with its own ground.
	// The accent colour is explicitly disqualified. On a brand site the biggest
	// rounded coloured block is usually a CTA or a promo panel, and mistaking one
	// for a card hands the whole dashboard a saturated card surface.
	const accentBg = primaryButton ? opaque(getComputedStyle(primaryButton).backgroundColor) : null;
	let card: HTMLElement | null = null;
	let cardScore = 0;
	for (const el of all) {
		const cs = getComputedStyle(el);
		const bg = opaque(cs.backgroundColor);
		const a = area(el);
		if (!bg || bg === pageBg || bg === accentBg || a < 12_000 || a > 500_000) {
			continue;
		}
		if (primaryButton && (el.contains(primaryButton) || primaryButton.contains(el))) {
			continue;
		}
		// A card is visually detached from the page. A full-bleed band with square
		// corners, no border and no shadow is a section, not a card - that is how
		// the green promo strip kept winning here.
		const radius = px(cs.borderTopLeftRadius) ?? 0;
		const detached = radius > 0 || cs.boxShadow !== 'none' || cs.borderTopWidth !== '0px';
		if (!detached) {
			continue;
		}
		// A card holds content; a decorative panel usually does not.
		const hasContent = (el.textContent || '').trim().length > 20;
		const score =
			Math.min(a, 200_000) / 4000 +
			Math.min(radius, 24) * 10 +
			(cs.boxShadow !== 'none' ? 80 : 0) +
			(hasContent ? 120 : 0);
		if (score > cardScore) {
			cardScore = score;
			card = el;
		}
	}

	const input =
		all.find((el) => el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') ?? null;

	/* ------------------------------------------- area-weighted colours */
	const colorTally = new Map<string, { area: number; properties: Set<string> }>();
	const bump = (color: string | null, property: string, weight: number) => {
		if (!color) {
			return;
		}
		const entry = colorTally.get(color) ?? { area: 0, properties: new Set<string>() };
		entry.area += weight;
		entry.properties.add(property);
		colorTally.set(color, entry);
	};
	const surfaceTally = new Map<string, number>();
	const radiusTally = new Map<number, number>();

	for (const el of all) {
		const cs = getComputedStyle(el);
		const a = area(el);
		const bg = opaque(cs.backgroundColor);
		// Weighting by painted area is what separates a brand colour from a
		// one-off: a hero fill outranks a hex mentioned once in a utility class.
		bump(bg, 'background', a);
		bump(opaque(cs.color), 'text', Math.min(a, 40_000));
		if (cs.borderTopWidth !== '0px') {
			bump(opaque(cs.borderTopColor), 'border', a / 8);
		}
		if (bg && a > 40_000) {
			surfaceTally.set(bg, (surfaceTally.get(bg) ?? 0) + a);
		}
		const r = Math.round(px(cs.borderTopLeftRadius) ?? 0);
		if (r > 0 && r <= 64 && a > 800) {
			radiusTally.set(r, (radiusTally.get(r) ?? 0) + 1);
		}
	}

	// SVG marks often carry the brand colour and never appear as a background.
	for (const el of Array.from(document.querySelectorAll('svg path, svg circle, svg rect')).slice(0, 400)) {
		const cs = getComputedStyle(el);
		bump(opaque(cs.fill), 'fill', 3000);
		bump(opaque(cs.stroke), 'stroke', 1500);
	}

	/* -------------------------------------------------------------- fonts */
	const fontLinks: string[] = [];
	for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))) {
		try {
			const url = new URL(link.href, location.href);
			if (url.protocol === 'https:' && allowedFontHosts.includes(url.hostname) && !fontLinks.includes(url.href)) {
				fontLinks.push(url.href);
			}
		} catch {
			/* ignore */
		}
	}

	const loadableFamilies = new Set<string>();
	const allFamilies = new Set<string>();
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList | null = null;
		try {
			rules = sheet.cssRules;
		} catch {
			// Cross-origin sheet. If it is an allowed font CDN its faces load anyway.
			const href = sheet.href ? new URL(sheet.href, location.href) : null;
			if (href && allowedFontHosts.includes(href.hostname)) {
				fontLinks.push(href.href);
			}
			continue;
		}
		for (const rule of Array.from(rules ?? [])) {
			if (rule.constructor.name !== 'CSSFontFaceRule') {
				continue;
			}
			const style = (rule as any).style as CSSStyleDeclaration;
			const family = (style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim();
			if (!family) {
				continue;
			}
			allFamilies.add(family);
			const src = style.getPropertyValue('src') || '';
			const urls = src.match(/url\(([^)]+)\)/g) ?? [];
			for (const u of urls) {
				try {
					const parsed = new URL(u.slice(4, -1).replace(/['"]/g, ''), sheet.href ?? location.href);
					if (allowedFontHosts.includes(parsed.hostname)) {
						loadableFamilies.add(family);
					}
				} catch {
					/* ignore */
				}
			}
		}
	}

	const prefersDarkGround = luminance(pageBg) < 0.25;

	return {
		title: document.title || null,
		customProperties,
		roles: {
			body: describe(document.body),
			heading: describe(heading),
			bodyText: describe(bodyText),
			primaryButton: describe(primaryButton),
			secondaryButton: describe(secondaryButton),
			card: describe(card),
			input: describe(input),
		},
		surfaces: [...surfaceTally.entries()]
			.map(([color, a]) => ({ color, area: Math.round(a) }))
			.sort((x, y) => y.area - x.area)
			.slice(0, 8),
		colors: [...colorTally.entries()]
			.map(([color, v]) => ({ color, area: Math.round(v.area), properties: [...v.properties] }))
			.sort((x, y) => y.area - x.area)
			.slice(0, 30),
		radii: [...radiusTally.entries()]
			.map(([p, count]) => ({ px: p, count }))
			.sort((x, y) => y.count - x.count)
			.slice(0, 6),
		fonts: [...allFamilies].slice(0, 16).map((family) => ({ family, loadable: loadableFamilies.has(family) })),
		fontLinks: [...new Set(fontLinks)].slice(0, 4),
		prefersDarkGround,
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Render the page in the shared headless Chromium and interrogate it. */
export async function probeWithBrowser(url: string, allowedFontHosts: string[]): Promise<ProbeResult> {
	const browser: Browser = await getBrowser();
	const page = await browser.newPage();
	try {
		await page.setViewport(VIEWPORT);
		await page.setUserAgent(USER_AGENT);
		await page.setJavaScriptEnabled(true);
		const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
		if (response && !response.ok() && response.status() >= 400) {
			const status = response.status();
			// Plenty of brand sites sit behind a WAF that refuses automated clients.
			// We identify ourselves honestly and take no for an answer rather than
			// playing cat-and-mouse with bot detection.
			if (status === 403 || status === 401 || status === 429) {
				throw new Error(
					`The site refused an automated request (HTTP ${status}). Its bot protection blocks nao. Ask them to allow the nao-design-system-bot user agent, or set the design system by hand.`,
				);
			}
			throw new Error(`The site returned HTTP ${status}.`);
		}
		// Webfonts settle after first paint; without this the probe reads fallbacks.
		await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
		// Bundlers that keep function names (esbuild `keepNames`, which tsx and our
		// own build both enable) wrap declarations in `__name(...)`. That helper
		// exists in the bundle, not in the page, so a serialized probe throws
		// ReferenceError the moment it runs. Shim it before evaluating.
		await page.evaluate('globalThis.__name = globalThis.__name || function (f) { return f; }');
		return (await page.evaluate(pageProbe, allowedFontHosts)) as ProbeResult;
	} finally {
		await page.close().catch(() => undefined);
	}
}

/**
 * The same probe, packaged to run in the admin's own browser.
 *
 * Plenty of brand sites sit behind a WAF that refuses datacenter traffic and
 * headless clients, and we do not work around bot protection. But the admin is
 * already logged into a normal browser on their own company's site, where no
 * such problem exists. They paste this into the console and hand us the result.
 *
 * Serialising the very same function keeps one source of truth: whatever the
 * server probe reads, the snippet reads.
 */
export function buildProbeSnippet(allowedFontHosts: string[]): string {
	return [
		'(function () {',
		'  // Bundlers that keep function names emit __name(); the page has no such helper.',
		'  globalThis.__name = globalThis.__name || function (f) { return f; };',
		`  var probe = ${pageProbe.toString()};`,
		`  var result = JSON.stringify(probe(${JSON.stringify(allowedFontHosts)}));`,
		'  if (typeof copy === "function") { copy(result); console.log("Copied. Paste it into nao."); }',
		'  else { console.log(result); }',
		'  return result;',
		'})()',
	].join('\n');
}

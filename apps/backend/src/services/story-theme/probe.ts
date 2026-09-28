import { isDarkSurface } from '@nao/shared/story-theme-contrast';
import type { HTTPRequest, Page } from 'puppeteer-core';

import { getBrowser } from '../../utils/headless-browser';
import { startSafeEgressProxy } from '../../utils/safe-egress-proxy';
import { assertSafeHost } from '../../utils/safe-fetch';
import { detectGround } from './pixels';
import { normalizeColor, type RoleEvidence, type RoleStyle } from './signals';

export interface ProbeResult {
	title: string | null;
	customProperties: Record<string, string>;
	roles: RoleEvidence;
	surfaces: { color: string; area: number }[];
	colors: { color: string; area: number; properties: string[] }[];
	radii: { px: number; count: number }[];
	fonts: { family: string; loadable: boolean }[];
	fontLinks: string[];
	prefersDarkGround: boolean;
	writtenColors: string[];
	documentInShell: boolean;
	screenshot: { data: Uint8Array; mediaType: 'image/jpeg' } | null;
}

type ProbedPage = Omit<ProbeResult, 'screenshot' | 'documentInShell'>;

interface RawProbe extends Omit<ProbedPage, 'prefersDarkGround'> {
	pageBackground: string;
}

const NAV_TIMEOUT_MS = 20_000;
const FIGMA_NAV_TIMEOUT_MS = 35_000;
const VIEWPORT = { width: 1440, height: 900 };
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 nao-story-theme-bot/1.0 (+https://getnao.io)';

export class ProbeRefusedError extends Error {}

export async function probeWithBrowser(url: string, allowedFontHosts: string[]): Promise<ProbeResult> {
	const browser = await getBrowser();
	const proxy = await startSafeEgressProxy();
	const context = await browser.createBrowserContext({ proxyServer: proxy.url });
	try {
		const page = await context.newPage();
		await page.setViewport(VIEWPORT);
		await page.setUserAgent(USER_AGENT);
		await blockPrivateRequests(page);
		const figma = isFigmaHost(new URL(url).hostname);
		const response = await page.goto(url, {
			waitUntil: 'networkidle2',
			timeout: figma ? FIGMA_NAV_TIMEOUT_MS : NAV_TIMEOUT_MS,
		});
		if (response && response.status() >= 400) {
			const status = response.status();
			if (status === 403 || status === 401 || status === 429) {
				throw new ProbeRefusedError(
					`The site refused an automated request (HTTP ${status}). Its bot protection blocks nao; try a screenshot instead.`,
				);
			}
			throw new Error(`The site returned HTTP ${status}.`);
		}
		await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
		if (figma) {
			await page.waitForSelector('canvas', { timeout: 12_000 }).catch(() => undefined);
			await new Promise((resolve) => setTimeout(resolve, 2500));
		}
		await page.evaluate('globalThis.__name = globalThis.__name || function (f) { return f; }');
		const raw = (await page.evaluate(pageProbe, allowedFontHosts)) as RawProbe;
		const screenshot = await captureScreenshot(page);
		return applyDocumentGround(normalizeProbe(raw), screenshot);
	} finally {
		await context.close().catch(() => undefined);
		await proxy.close();
	}
}

async function blockPrivateRequests(page: Page): Promise<void> {
	const verdicts = new Map<string, Promise<boolean>>();
	const isAllowed = (hostname: string): Promise<boolean> => {
		const cached = verdicts.get(hostname);
		if (cached) {
			return cached;
		}
		const verdict = assertSafeHost(hostname).then(
			() => true,
			() => false,
		);
		verdicts.set(hostname, verdict);
		return verdict;
	};

	await page.setRequestInterception(true);
	page.on('request', async (request: HTTPRequest) => {
		const target = parseRequestUrl(request.url());
		if (!target) {
			await request.abort('blockedbyclient').catch(() => undefined);
			return;
		}
		if (target.protocol === 'data:' || target.protocol === 'blob:') {
			await request.continue().catch(() => undefined);
			return;
		}
		const allowed =
			(target.protocol === 'http:' || target.protocol === 'https:') && (await isAllowed(target.hostname));
		await (allowed ? request.continue() : request.abort('blockedbyclient')).catch(() => undefined);
	});
}

function parseRequestUrl(raw: string): URL | null {
	try {
		return new URL(raw);
	} catch {
		return null;
	}
}

function isFigmaHost(hostname: string): boolean {
	return hostname === 'figma.com' || hostname.endsWith('.figma.com');
}

async function captureScreenshot(page: Page): Promise<{ data: Uint8Array; mediaType: 'image/jpeg' } | null> {
	try {
		const data = await page.screenshot({ type: 'jpeg', quality: 62, encoding: 'binary' });
		return { data: new Uint8Array(data), mediaType: 'image/jpeg' };
	} catch {
		return null;
	}
}

function normalizeProbe(raw: RawProbe): ProbedPage {
	const roles = Object.fromEntries(
		Object.entries(raw.roles).map(([role, style]) => [role, normalizeRoleStyle(style)]),
	) as unknown as RoleEvidence;
	const pageBackground = normalizeColor(raw.pageBackground) ?? '#ffffff';
	return {
		...raw,
		roles,
		surfaces: mergeByHex(raw.surfaces, (a, b) => ({ ...a, area: a.area + b.area })),
		colors: mergeByHex(raw.colors, (a, b) => ({
			...a,
			area: a.area + b.area,
			properties: [...new Set([...a.properties, ...b.properties])],
		})),
		prefersDarkGround: isDarkSurface(pageBackground),
	};
}

function normalizeRoleStyle(style: RoleStyle | null): RoleStyle | null {
	if (!style) {
		return null;
	}
	return {
		...style,
		background: style.background ? normalizeColor(style.background) : null,
		color: style.color ? normalizeColor(style.color) : null,
		borderColor: style.borderColor ? normalizeColor(style.borderColor) : null,
	};
}

/** Two browser strings can name one colour, so tallies are re-joined after conversion. */
function mergeByHex<T extends { color: string; area: number }>(items: T[], merge: (a: T, b: T) => T): T[] {
	const byHex = new Map<string, T>();
	for (const item of items) {
		const hex = normalizeColor(item.color);
		if (!hex) {
			continue;
		}
		const existing = byHex.get(hex);
		byHex.set(hex, existing ? merge(existing, { ...item, color: hex }) : { ...item, color: hex });
	}
	return [...byHex.values()].sort((a, b) => b.area - a.area);
}

async function applyDocumentGround(
	probed: ProbedPage,
	screenshot: { data: Uint8Array; mediaType: 'image/jpeg' } | null,
): Promise<ProbeResult> {
	if (!screenshot) {
		return { ...probed, screenshot: null, documentInShell: false };
	}
	try {
		const ground = await detectGround(screenshot);
		if (!ground?.shellDetected) {
			return { ...probed, screenshot, documentInShell: false };
		}
		const body = probed.roles.body
			? { ...probed.roles.body, background: ground.center }
			: {
					background: ground.center,
					color: null,
					fontFamily: null,
					fontSize: null,
					fontWeight: null,
					letterSpacing: null,
					borderRadius: null,
					borderColor: null,
					hasBorder: false,
					hasShadow: false,
					sample: null,
				};
		return {
			...probed,
			screenshot,
			documentInShell: true,
			prefersDarkGround: isDarkSurface(ground.center),
			roles: { ...probed.roles, body },
			surfaces: [
				{ color: ground.center, area: Number.MAX_SAFE_INTEGER },
				...probed.surfaces.filter((surface) => surface.color !== ground.center),
			],
		};
	} catch {
		return { ...probed, screenshot, documentInShell: false };
	}
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function pageProbe(allowedFontHosts: string[]): RawProbe {
	const px = (v: string | null | undefined): number | null => {
		if (!v) {
			return null;
		}
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : null;
	};

	/** Keeps the browser's own colour string; near-transparent paint is treated as no paint. */
	const opaque = (raw: string | null | undefined): string | null => {
		const m = /^rgba?\(([^)]+)\)$/.exec((raw ?? '').trim());
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
		return parts.length > 3 && parts[3] < 0.35 ? null : m[0];
	};

	const visible = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) {
			return false;
		}
		const cs = getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.1;
	};

	const describe = (el: Element | null): RoleStyle | null => {
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
			letterSpacing: ls !== null && size ? Number((ls / size).toFixed(4)) : 0,
			borderRadius: px(cs.borderTopLeftRadius),
			borderColor: cs.borderTopWidth !== '0px' ? opaque(cs.borderTopColor) : null,
			hasBorder: cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none',
			hasShadow: cs.boxShadow !== 'none' && cs.boxShadow.length > 0,
			sample: (el.textContent || '').trim().slice(0, 40) || null,
		};
	};

	const customProperties: Record<string, string> = {};
	const rootStyle = getComputedStyle(document.documentElement);
	const names = new Set<string>();
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

	const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(visible).slice(0, 4000);
	const bodyStyle = getComputedStyle(document.body);
	const pageBg = opaque(bodyStyle.backgroundColor) ?? 'rgb(255, 255, 255)';

	const area = (el: Element) => {
		const r = el.getBoundingClientRect();
		return Math.max(0, r.width) * Math.max(0, r.height);
	};

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

	const clickable = all.filter((el) => {
		if (
			el.tagName === 'BUTTON' ||
			el.tagName === 'A' ||
			el.getAttribute('role') === 'button' ||
			/(^|\s)(btn|button|cta)(\s|$|-)/i.test(el.className || '')
		) {
			return true;
		}
		return getComputedStyle(el).cursor === 'pointer';
	});
	let primaryButton: HTMLElement | null = null;
	let secondaryButton: HTMLElement | null = null;
	for (const el of clickable) {
		const cs = getComputedStyle(el);
		const bg = opaque(cs.backgroundColor);
		const a = area(el);
		if (a < 400 || a > 140_000) {
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
		const radius = px(cs.borderTopLeftRadius) ?? 0;
		const detached = radius > 0 || cs.boxShadow !== 'none' || cs.borderTopWidth !== '0px';
		if (!detached) {
			continue;
		}
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

	for (const el of Array.from(document.querySelectorAll('svg path, svg circle, svg rect')).slice(0, 400)) {
		const cs = getComputedStyle(el);
		bump(opaque(cs.fill), 'fill', 3000);
		bump(opaque(cs.stroke), 'stroke', 1500);
	}

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
			for (const u of src.match(/url\(([^)]+)\)/g) ?? []) {
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

	const writtenColors: string[] = [];
	const text = document.body.innerText || '';
	for (const match of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
		const hex = `#${match[1].toLowerCase()}`;
		if (!writtenColors.includes(hex)) {
			writtenColors.push(hex);
		}
		if (writtenColors.length >= 24) {
			break;
		}
	}

	return {
		title: document.title || null,
		customProperties,
		pageBackground: pageBg,
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
		writtenColors,
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

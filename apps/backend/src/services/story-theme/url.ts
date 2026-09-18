import { FONT_STYLESHEET_HOSTS } from '@nao/shared/story-theme';
import * as cheerio from 'cheerio';

import { assertSafeHost, safeFetch } from '../../utils/safe-fetch';
import { ProbeRefusedError, type ProbeResult, probeWithBrowser } from './probe';
import { type DesignSignals, DesignSourceError, emptySignals, rankBrandCandidates, signalsFromCss } from './signals';

const MAX_HTML_BYTES = 2_000_000;
const MAX_CSS_BYTES = 1_500_000;
const MAX_STYLESHEETS = 6;
const FETCH_HEADERS = {
	'user-agent': 'nao-story-theme-bot/1.0 (+https://getnao.io)',
	accept: 'text/html,text/css,*/*',
};

const SUBSET_FONT_ID = /^[A-Z0-9]{4,10}$/;

export interface UrlSignals {
	signals: DesignSignals;
	screenshot: { data: Uint8Array; mediaType: 'image/jpeg' } | null;
}

/** Renders the page when Chromium is available, otherwise reads its stylesheets as text. */
export async function extractSignalsFromUrl(rawUrl: string): Promise<UrlSignals> {
	const url = await assertPublicHttpUrl(rawUrl);

	let renderFailure: string;
	try {
		const probe = await probeWithBrowser(url.toString(), [...FONT_STYLESHEET_HOSTS]);
		return { signals: signalsFromProbe(probe, url.toString()), screenshot: probe.screenshot };
	} catch (error) {
		if (error instanceof ProbeRefusedError) {
			throw new DesignSourceError(error.message);
		}
		renderFailure = error instanceof Error ? error.message : String(error);
	}

	try {
		const fallback = await staticSignals(url);
		fallback.warnings.unshift(
			`The page could not be rendered (${renderFailure}), so only its stylesheets were read. Design systems defined at runtime are missed.`,
		);
		return { signals: fallback, screenshot: null };
	} catch (staticError) {
		const staticReason = staticError instanceof Error ? staticError.message : String(staticError);
		throw new DesignSourceError(`Could not read ${url.hostname}: ${renderFailure} (${staticReason}).`);
	}
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new DesignSourceError('That does not look like a valid URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new DesignSourceError('Only http and https URLs are supported.');
	}
	if (url.username || url.password) {
		throw new DesignSourceError('URLs with credentials are not supported.');
	}
	try {
		await assertSafeHost(url.hostname);
	} catch (error) {
		throw new DesignSourceError(error instanceof Error ? error.message : String(error));
	}
	return url;
}

export function signalsFromProbe(probe: ProbeResult, url: string): DesignSignals {
	const warnings: string[] = [];
	const fonts = probe.fonts.filter((font) => !SUBSET_FONT_ID.test(font.family));
	const unloadable = fonts.filter((f) => !f.loadable).map((f) => f.family);
	if (unloadable.length) {
		warnings.push(
			`${unloadable.slice(0, 4).join(', ')} ${unloadable.length === 1 ? 'is' : 'are'} served from the brand's own domain, so nao cannot load ${unloadable.length === 1 ? 'it' : 'them'}. A close substitute is used instead.`,
		);
	}
	if (probe.documentInShell) {
		warnings.push(
			'This looks like a document inside editor chrome. The theme follows the canvas, not the surrounding UI.',
		);
	}
	if (!probe.roles.primaryButton) {
		warnings.push('No filled button was found, so the accent is inferred from other elements.');
	}
	if (probe.colors.length < 4 && probe.writtenColors.length < 3) {
		warnings.push('The page paints very few distinct colours; the palette is largely nao defaults.');
	}

	const written = probe.writtenColors.map((hex) => ({
		hex,
		count: 80_000,
		properties: ['written-hex'],
	}));
	const colors = [
		...written,
		...probe.colors.map((c) => ({ hex: c.color, count: c.area, properties: c.properties })),
	].slice(0, 40);

	return {
		...emptySignals('url', 'rendered', url),
		title: probe.title,
		customProperties: probe.customProperties,
		colors,
		brandCandidates: rankBrandCandidates(colors, probe.customProperties),
		surfaces: probe.surfaces.map((s) => s.color),
		roles: probe.roles,
		fontFamilies: fonts.map((f) => ({ stack: f.family, count: f.loadable ? 2 : 1 })),
		fontLinks: probe.fontLinks,
		radii: probe.radii,
		prefersDarkGround: probe.prefersDarkGround,
		writtenColors: probe.writtenColors,
		warnings,
	};
}

async function staticSignals(url: URL): Promise<DesignSignals> {
	const $ = cheerio.load(await fetchText(url.toString(), MAX_HTML_BYTES));
	const title = $('title').first().text().trim().slice(0, 200) || null;
	const inline = $('style')
		.map((_, element) => $(element).text())
		.get()
		.join('\n');
	const sheetUrls = resolveStylesheetUrls($, url).slice(0, MAX_STYLESHEETS);

	const warnings: string[] = [];
	const sheets: string[] = [];
	const results = await Promise.allSettled(sheetUrls.map((href) => fetchText(href, MAX_CSS_BYTES)));
	results.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			sheets.push(result.value);
		} else {
			warnings.push(`Could not read stylesheet ${sheetUrls[index]}.`);
		}
	});
	if (sheetUrls.length === 0 && !inline) {
		warnings.push('No stylesheets were found on the page.');
	}

	const signals = signalsFromCss([inline, ...sheets].join('\n'), {
		...emptySignals('url', 'static', url.toString()),
		title,
		fontLinks: sheetUrls.filter((href) => FONT_STYLESHEET_HOSTS.some((host) => new URL(href).hostname === host)),
	});
	if (signals.colors.length < 4) {
		warnings.push('Few colours could be read. This site likely styles itself at runtime rather than in CSS.');
	}
	if (signals.fontFamilies.length === 0) {
		warnings.push('No font families are declared in CSS; typography keeps the nao defaults.');
	}
	return { ...signals, warnings };
}

function fetchText(href: string, maxBytes: number): Promise<string> {
	return safeFetch(href, { allowHttp: true, maxBytes, headers: FETCH_HEADERS });
}

function resolveStylesheetUrls($: cheerio.CheerioAPI, base: URL): string[] {
	const out: string[] = [];
	for (const href of $('link[rel~="stylesheet"][href]')
		.map((_, element) => $(element).attr('href'))
		.get()) {
		try {
			const resolved = new URL(href, base);
			const isFontHost = FONT_STYLESHEET_HOSTS.some((host) => resolved.hostname === host);
			if (resolved.hostname === base.hostname || isFontHost) {
				out.push(resolved.toString());
			}
		} catch {
			/* skip malformed href */
		}
	}
	return [...new Set(out)];
}

import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { contrastRatio, validateSeries } from '@nao/shared/story-theme-contrast';
import { describe, expect, it } from 'vitest';

import { assertPublicHttpUrl, normalizeColor } from '../src/services/story-theme-extract';
import { applyGuards } from '../src/services/story-theme-guard';

/**
 * The model is not in these tests on purpose. `applyGuards` is everything that
 * happens to a model's proposal before it can reach a story, which is where the
 * real risk sits: a plausible-looking palette that is unreadable.
 */

function proposal(overrides: Record<string, unknown> = {}) {
	return {
		surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#f4f4f6' },
		ink: { primary: '#111111', secondary: '#444444', muted: '#777777' },
		typography: {
			headingFont: 'Inter, sans-serif',
			bodyFont: 'Inter, sans-serif',
			headingTracking: -0.02,
			scale: 1,
		},
		shape: { radius: 8, border: '#e5e5e5', elevation: 'bordered' as const, controlShape: 'rounded' as const },
		charts: {
			series: ['#522bff', '#288abb', '#c44310'],
			sequentialAnchor: '#522bff',
			positive: '#22b573',
			negative: '#f5a623',
			grid: '#eeeef7',
		},
		accent: '#522bff',
		rationale: 'test',
		...overrides,
	};
}

describe('applyGuards', () => {
	it('passes a sane proposal through untouched', () => {
		const { theme, notes } = applyGuards(proposal());
		expect(theme.charts.series).toEqual(['#522bff', '#288abb', '#c44310']);
		expect(theme.accent).toBe('#522bff');
		expect(theme.surfaces.card).toBe('#ffffff');
		expect(notes).toEqual([]);
	});

	it('steps a gridline that would be invisible on the card', () => {
		// #fdfdfd on white is drawn but not seen.
		const { theme, notes } = applyGuards(proposal({ charts: { ...proposal().charts, grid: '#fdfdfd' } }));
		expect(contrastRatio(theme.charts.grid, theme.surfaces.card)).toBeGreaterThanOrEqual(1.12);
		expect(notes.join(' ')).toMatch(/charts.grid was invisible/);
	});

	it('always emits a chart palette that passes the guard', () => {
		const nasty = [
			['#712dd0', '#8f40ff', '#c2a3ee'], // three tints of one hue
			['#fafafa', '#fbfbfb', '#fcfcfc'], // invisible on white
			['#808080', '#888888', '#909090'], // greys
		];
		for (const series of nasty) {
			const { theme } = applyGuards(proposal({ charts: { ...proposal().charts, series } }));
			expect(validateSeries(theme.charts.series, theme.surfaces.card).issues).toEqual([]);
		}
	});

	it('reports what it repaired so the admin sees it', () => {
		const { notes } = applyGuards(
			proposal({ charts: { ...proposal().charts, series: ['#712dd0', '#8f40ff', '#c2a3ee'] } }),
		);
		expect(notes.length).toBeGreaterThan(0);
		expect(notes.join(' ')).toMatch(/chart colour/i);
	});

	it('replaces ink that cannot be read on its own card', () => {
		const { theme, notes } = applyGuards(
			proposal({
				surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#f4f4f6' },
				ink: { primary: '#f2f2f2', secondary: '#eeeeee', muted: '#fafafa' },
			}),
		);
		expect(theme.ink.primary).toBe(DEFAULT_STORY_THEME.ink.primary);
		expect(notes.join(' ')).toMatch(/fell below/);
	});

	it('picks light ink for a dark card rather than the light-mode fallback', () => {
		const { theme } = applyGuards(
			proposal({
				surfaces: { page: '#140309', card: '#140309', sunken: '#1d1f24' },
				ink: { primary: '#150409', secondary: '#160509', muted: '#170609' },
			}),
		);
		expect(theme.ink.primary).toBe('#f5f5f7');
	});

	it('derives accent ink instead of trusting the model', () => {
		// A pale accent needs a dark page to be legitimate in the first place.
		const pale = applyGuards(
			proposal({ accent: '#64ffa2', surfaces: { page: '#140309', card: '#1d1f24', sunken: '#26282f' } }),
		);
		expect(pale.theme.accent).toBe('#64ffa2');
		expect(pale.theme.accentInk).toBe('#111111');
		expect(applyGuards(proposal({ accent: '#522bff' })).theme.accentInk).toBe('#ffffff');
	});

	it('rejects an accent that cannot be seen against the page', () => {
		const { theme, notes } = applyGuards(proposal({ accent: '#64ffa2' }));
		expect(theme.accent).toBe(DEFAULT_STORY_THEME.accent);
		expect(notes.join(' ')).toMatch(/too close to the page colour/);
	});

	it('rejects junk values and falls back rather than emitting broken CSS', () => {
		const { theme } = applyGuards(
			proposal({
				accent: 'not-a-colour',
				shape: { radius: 999, border: 'rgb(0,0,0)', elevation: 'flat' as const, controlShape: 'pill' as const },
				typography: {
					headingFont: 'Evil}; body { display:none } .x{',
					bodyFont: 'Helvetica',
					headingTracking: 99,
					scale: 99,
				},
			}),
		);
		expect(theme.accent).toBe(DEFAULT_STORY_THEME.accent);
		expect(theme.shape.radius).toBe(28);
		expect(theme.shape.border).toBe(DEFAULT_STORY_THEME.shape.border);
		expect(theme.typography.headingFont).not.toMatch(/[{};]/);
		expect(theme.typography.headingTracking).toBeLessThanOrEqual(0.06);
		expect(theme.typography.scale).toBeLessThanOrEqual(1.25);
	});

	it('keeps the nao series when too few colours survive sanitising', () => {
		const { theme, notes } = applyGuards(
			proposal({ charts: { ...proposal().charts, series: ['nope', 'also-nope', 'still-nope'] } }),
		);
		// The nao series is the fallback, then the guard repairs it like any other:
		// the shipped palette does not pass its own checks.
		expect(theme.charts.series).toHaveLength(DEFAULT_STORY_THEME.charts.series.length);
		expect(validateSeries(theme.charts.series, theme.surfaces.card).issues).toEqual([]);
		expect(notes.join(' ')).toMatch(/Fewer than three/);
	});
});

describe('assertPublicHttpUrl', () => {
	it('accepts public http and https URLs', () => {
		expect(assertPublicHttpUrl('https://www.sezane.com/eu-fr').hostname).toBe('www.sezane.com');
		expect(assertPublicHttpUrl('http://example.com').protocol).toBe('http:');
	});

	it('refuses anything that could reach the cluster from the inside', () => {
		const blocked = [
			'http://localhost:3000',
			'http://127.0.0.1',
			'http://10.0.0.5',
			'http://192.168.1.1',
			'http://169.254.169.254/latest/meta-data/',
			'http://172.16.0.1',
			'http://db.internal',
			'file:///etc/passwd',
			'gopher://example.com',
		];
		for (const url of blocked) {
			expect(() => assertPublicHttpUrl(url), url).toThrow();
		}
	});

	it('refuses malformed input', () => {
		expect(() => assertPublicHttpUrl('not a url')).toThrow();
	});
});

describe('normalizeColor', () => {
	it('normalises the notations a stylesheet actually uses', () => {
		expect(normalizeColor('#FFF')).toBe('#ffffff');
		expect(normalizeColor('#522BFF')).toBe('#522bff');
		expect(normalizeColor('rgb(82, 43, 255)')).toBe('#522bff');
		expect(normalizeColor('rgba(82, 43, 255, 0.9)')).toBe('#522bff');
		expect(normalizeColor('hsl(0, 0%, 100%)')).toBe('#ffffff');
	});

	it('drops transparent colours, which carry no design intent', () => {
		expect(normalizeColor('rgba(0, 0, 0, 0)')).toBeNull();
		expect(normalizeColor('#00000000')).toBeNull();
	});

	it('returns null for keywords and functions it cannot resolve', () => {
		expect(normalizeColor('currentColor')).toBeNull();
		expect(normalizeColor('var(--brand)')).toBeNull();
		expect(normalizeColor('transparent')).toBeNull();
	});
});

describe('font links reaching the theme', () => {
	it('takes links from the probe, never from the model', () => {
		const { theme } = applyGuards(proposal(), undefined, [
			'https://fonts.googleapis.com/css2?family=DM+Sans',
			'https://brand.example.com/fonts/Display.css',
			'https://fonts.googleapis.com/css2?family=DM+Sans',
		]);
		expect(theme.typography.fontLinks).toEqual(['https://fonts.googleapis.com/css2?family=DM+Sans']);
	});

	it('defaults to no links when the probe found none', () => {
		expect(applyGuards(proposal()).theme.typography.fontLinks).toEqual([]);
	});
});

describe('accent sanity', () => {
	it('refuses an accent identical to the card surface', () => {
		const { theme } = applyGuards(
			proposal({ accent: '#ffffff', surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#f4f4f6' } }),
		);
		expect(theme.accent).not.toBe('#ffffff');
	});
});

describe('readability across every surface', () => {
	/**
	 * Reproduces the theme that shipped an unreadable preview: a bone page with
	 * an ink card, light ink chosen because it was only ever checked against the
	 * card, and a pale sunken surface. Headings vanished on the page and the
	 * filter chips were pale-on-pale.
	 */
	const mixedPolarity = proposal({
		surfaces: { page: '#fffdf7', card: '#140309', sunken: '#a6f5c4' },
		ink: { primary: '#fffdf7', secondary: '#e8e4dc', muted: '#c9c4bb' },
		accent: '#8f40ff',
		charts: {
			series: ['#8f40ff', '#00ab5d', '#a077da'],
			sequentialAnchor: '#8f40ff',
			positive: '#00ab5d',
			negative: '#8f40ff',
			grid: '#1a0a12',
		},
	});

	it('forces every surface onto one polarity', () => {
		const { theme, notes } = applyGuards(mixedPolarity);
		const lum = (hex: string) => {
			const ch = (i: number) => {
				const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
				return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
			};
			return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
		};
		const dark = [theme.surfaces.page, theme.surfaces.card, theme.surfaces.sunken].map((s) => lum(s) < 0.2);
		expect(new Set(dark).size, 'surfaces must share a polarity').toBe(1);
		expect(notes.join(' ')).toMatch(/opposite polarity/);
	});

	it('gives ink that is readable on page, card and sunken alike', () => {
		const { theme } = applyGuards(mixedPolarity);
		for (const surface of [theme.surfaces.page, theme.surfaces.card, theme.surfaces.sunken]) {
			expect(contrastRatio(theme.ink.primary, surface), `primary on ${surface}`).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(theme.ink.secondary, surface), `secondary on ${surface}`).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(theme.ink.muted, surface), `muted on ${surface}`).toBeGreaterThanOrEqual(3);
		}
	});

	it('keeps hairlines and gridlines visible on the card', () => {
		const { theme } = applyGuards(mixedPolarity);
		expect(contrastRatio(theme.shape.border, theme.surfaces.card)).toBeGreaterThanOrEqual(1.12);
		expect(contrastRatio(theme.charts.grid, theme.surfaces.card)).toBeGreaterThanOrEqual(1.12);
	});

	it('leaves a bordered card sharing the page colour, as nao does', () => {
		const { theme } = applyGuards(proposal({ surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#ffffff' } }));
		expect(theme.surfaces.card).toBe('#ffffff');
		// The sunken surface is a bare fill, so it must always be visible.
		expect(contrastRatio(theme.surfaces.sunken, theme.surfaces.page)).toBeGreaterThanOrEqual(1.1);
	});

	it('gives a flat card its own ground, since nothing else separates it', () => {
		const { theme } = applyGuards(
			proposal({
				surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#ffffff' },
				shape: { radius: 8, border: '#e5e5e5', elevation: 'flat' as const, controlShape: 'rounded' as const },
			}),
		);
		expect(theme.surfaces.card).not.toBe('#ffffff');
	});
});

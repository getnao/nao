import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { validateSeries } from '@nao/shared/story-theme-contrast';
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
		expect(notes).toEqual([]);
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
		expect(notes.join(' ')).toMatch(/unreadable/);
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
		expect(applyGuards(proposal({ accent: '#64ffa2' })).theme.accentInk).toBe('#111111');
		expect(applyGuards(proposal({ accent: '#522bff' })).theme.accentInk).toBe('#ffffff');
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
		expect(theme.charts.series).toEqual(DEFAULT_STORY_THEME.charts.series);
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
			'https://fr.ibanfirst.com/fonts/AtypDisplay.css',
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
		const { theme, notes } = applyGuards(
			proposal({ accent: '#ffffff', surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#f4f4f6' } }),
		);
		expect(theme.accent).not.toBe('#ffffff');
		expect(notes.join(' ')).toMatch(/identical to the card surface/);
	});
});

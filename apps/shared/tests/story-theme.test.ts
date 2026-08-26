import { describe, expect, it } from 'vitest';

import {
	DEFAULT_STORY_THEME,
	isAllowedFontLink,
	mergeStoryTheme,
	storyThemeSchema,
	storyThemeToCssVars,
} from '../src/story-theme';
import {
	contrastRatio,
	deltaE,
	hexToOklch,
	isDarkSurface,
	oklchToHex,
	readableInkFor,
	simulateCvd,
	snapSeries,
	validateSeries,
} from '../src/story-theme-contrast';

describe('colour conversion', () => {
	it('round-trips hex through OKLCH', () => {
		for (const hex of ['#522bff', '#0e8fa8', '#ffffff', '#140309', '#64ffa2']) {
			expect(oklchToHex(hexToOklch(hex))).toBe(hex);
		}
	});

	it('classifies surfaces by polarity', () => {
		expect(isDarkSurface('#140309')).toBe(true);
		expect(isDarkSurface('#18181c')).toBe(true);
		expect(isDarkSurface('#fffdf7')).toBe(false);
		expect(isDarkSurface('#f9f4ef')).toBe(false);
	});

	it('computes contrast symmetrically', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
	});
});

describe('CVD simulation', () => {
	it('collapses red and green for a deuteranope but not for normal vision', () => {
		const red = '#c0392b';
		const green = '#27ae60';
		expect(deltaE(red, green)).toBeGreaterThan(20);
		expect(deltaE(simulateCvd(red, 'deutan'), simulateCvd(green, 'deutan'))).toBeLessThan(deltaE(red, green));
	});

	it('leaves an achromatic pair essentially unchanged', () => {
		const before = deltaE('#222222', '#dddddd');
		const after = deltaE(simulateCvd('#222222', 'deutan'), simulateCvd('#dddddd', 'deutan'));
		expect(Math.abs(before - after)).toBeLessThan(6);
	});
});

describe('validateSeries', () => {
	it('accepts the default nao series on a white card', () => {
		const report = validateSeries(DEFAULT_STORY_THEME.charts.series, DEFAULT_STORY_THEME.surfaces.card);
		expect(report.ok).toBe(true);
		expect(report.issues).toEqual([]);
	});

	it('rejects two tints of the same hue as indistinguishable', () => {
		const report = validateSeries(['#712dd0', '#8f40ff', '#0e8fa8'], '#ffffff');
		expect(report.ok).toBe(false);
		expect(report.issues.some((i) => i.kind === 'normal-separation')).toBe(true);
	});

	it('rejects a mark that disappears into its surface', () => {
		const report = validateSeries(['#fbfbfb', '#0e8fa8', '#c2410c'], '#ffffff');
		expect(report.issues.some((i) => i.kind === 'contrast')).toBe(true);
	});

	it('rejects a grey masquerading as a categorical hue', () => {
		const report = validateSeries(['#7a7a7a', '#0e8fa8', '#c2410c'], '#ffffff');
		expect(report.issues.some((i) => i.kind === 'chroma')).toBe(true);
	});

	it('flags a brand colour that glares on a dark card', () => {
		// iBanFirst's accent green: fine as text, too light as a large fill on ink.
		const report = validateSeries(['#8f40ff', '#64ffa2', '#c2a3ee'], '#140309');
		expect(report.issues.some((i) => i.kind === 'lightness')).toBe(true);
	});
});

describe('snapSeries', () => {
	const cases: Array<{ name: string; series: string[]; surface: string }> = [
		{ name: 'same-hue tints on white', series: ['#712dd0', '#8f40ff', '#c2a3ee'], surface: '#ffffff' },
		{ name: 'brand greens on ink', series: ['#8f40ff', '#64ffa2', '#c2a3ee'], surface: '#140309' },
		{ name: 'low-contrast pastels on bone', series: ['#f4e7d3', '#f7f0e2', '#efe3d0'], surface: '#fffdf7' },
		{ name: 'near-greys', series: ['#808080', '#888888', '#909090'], surface: '#ffffff' },
		{ name: 'sezane tokens', series: ['#395999', '#d44d44', '#121212'], surface: '#f9f4ef' },
	];

	for (const { name, series, surface } of cases) {
		it(`produces a passing series from ${name}`, () => {
			const snapped = snapSeries(series, surface);
			expect(snapped).toHaveLength(series.length);
			const report = validateSeries(snapped, surface);
			expect(report.issues, JSON.stringify(report.issues, null, 2)).toEqual([]);
		});
	}

	it('leaves an already-valid series untouched', () => {
		const series = DEFAULT_STORY_THEME.charts.series;
		expect(snapSeries(series, '#ffffff')).toEqual(series);
	});

	it('holds hue where it can, so the palette still reads as the brand', () => {
		// #64ffa2 only needs to come down in lightness; its hue should survive.
		const [, snappedGreen] = snapSeries(['#8f40ff', '#64ffa2', '#c2a3ee'], '#140309');
		const before = hexToOklch('#64ffa2').h;
		const after = hexToOklch(snappedGreen).h;
		expect(Math.abs(before - after)).toBeLessThan(15);
	});
});

describe('readableInkFor', () => {
	it('picks white on a saturated accent and near-black on a pale one', () => {
		expect(readableInkFor('#522bff')).toBe('#ffffff');
		expect(readableInkFor('#64ffa2')).toBe('#111111');
	});
});

describe('theme contract', () => {
	it('validates the shipped default', () => {
		expect(() => storyThemeSchema.parse(DEFAULT_STORY_THEME)).not.toThrow();
	});

	it('fills unspecified slots from the default rather than guessing', () => {
		const merged = mergeStoryTheme({ accent: '#8f40ff', shape: { radius: 0 } });
		expect(merged.accent).toBe('#8f40ff');
		expect(merged.shape.radius).toBe(0);
		expect(merged.shape.elevation).toBe(DEFAULT_STORY_THEME.shape.elevation);
		expect(merged.ink).toEqual(DEFAULT_STORY_THEME.ink);
		expect(() => storyThemeSchema.parse(merged)).not.toThrow();
	});

	it('emits the CSS variables the story components already read', () => {
		const vars = storyThemeToCssVars(DEFAULT_STORY_THEME);
		expect(vars['--background']).toBe('#ffffff');
		expect(vars['--primary']).toBe('#522bff');
		expect(vars['--radius']).toBe('10px');
		expect(vars['--chart-1']).toBe('#522bff');
		expect(vars['--chart-7']).toBeDefined();
	});

	it('maps control shape to a radius', () => {
		const pill = storyThemeToCssVars(mergeStoryTheme({ shape: { controlShape: 'pill' } }));
		expect(pill['--story-control-radius']).toBe('9999px');
		const square = storyThemeToCssVars(mergeStoryTheme({ shape: { controlShape: 'square' } }));
		expect(square['--story-control-radius']).toBe('0px');
	});

	it('cycles a short series across all seven chart slots', () => {
		const vars = storyThemeToCssVars(mergeStoryTheme({ charts: { series: ['#522bff', '#0e8fa8', '#c2410c'] } }));
		expect(vars['--chart-4']).toBe('#522bff');
		expect(vars['--chart-1']).toBe('#522bff');
	});
});

describe('font links', () => {
	it('accepts public font CDNs only', () => {
		expect(isAllowedFontLink('https://fonts.googleapis.com/css2?family=Geist')).toBe(true);
		expect(isAllowedFontLink('https://use.typekit.net/abc.css')).toBe(true);
		// A brand's own origin serves faces they licensed, not faces we may hotlink.
		expect(isAllowedFontLink('https://fr.ibanfirst.com/fonts/AtypDisplay.woff2')).toBe(false);
		expect(isAllowedFontLink('http://fonts.googleapis.com/css2')).toBe(false);
		expect(isAllowedFontLink('https://evil.test/fonts.css')).toBe(false);
		expect(isAllowedFontLink('not a url')).toBe(false);
	});

	it('drops disallowed links when merging a theme', () => {
		const merged = mergeStoryTheme({
			typography: {
				fontLinks: ['https://fonts.googleapis.com/css2?family=Geist', 'https://fr.ibanfirst.com/f.css'],
			},
		});
		expect(merged.typography.fontLinks).toEqual(['https://fonts.googleapis.com/css2?family=Geist']);
	});

	it('rejects a disallowed link at the schema boundary', () => {
		const bad = {
			...DEFAULT_STORY_THEME,
			typography: { ...DEFAULT_STORY_THEME.typography, fontLinks: ['https://evil.test/f.css'] },
		};
		expect(() => storyThemeSchema.parse(bad)).toThrow();
	});
});

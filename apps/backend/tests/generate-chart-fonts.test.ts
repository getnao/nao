import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { renderChartToSvg } from '../src/components/generate-chart';
import { resolveCssVariables } from '../src/utils/generate-chart';

const CHART_INPUT = {
	config: {
		query_id: 'q1',
		chart_type: 'bar' as const,
		x_axis_key: 'week',
		x_axis_type: 'category' as const,
		series: [{ data_key: 'amount', label: 'Facturation estimée TTC' }],
		title: 'Projection hebdomadaire',
		y_axis_label: 'Montant TTC (€)',
		show_data_labels: true,
	},
	data: [
		{ week: '14/09/2026', amount: 43000 },
		{ week: '28/09/2026', amount: 16000 },
		{ week: '12/10/2026', amount: 15000 },
	],
};

function textNodes(svg: string) {
	const $ = cheerio.load(svg, { xmlMode: true });
	return $('text').toArray().map((node) => $(node));
}

describe('chart SVG fonts', () => {
	it('gives every text node a font family resvg can resolve', () => {
		const nodes = textNodes(renderChartToSvg(CHART_INPUT));

		expect(nodes.length).toBeGreaterThan(0);
		for (const node of nodes) {
			const family = node.attr('font-family') ?? '';
			expect(family).not.toBe('');
			expect(family).toContain('DejaVu Sans');
		}
	});

	it('never falls back to system-ui alone, which resvg cannot match', () => {
		const svg = renderChartToSvg(CHART_INPUT);

		expect(svg).not.toContain('"system-ui, sans-serif"');
		expect(svg).not.toContain("'system-ui, sans-serif'");
	});

	it('renders the title, the axis label and the category labels', () => {
		const svg = renderChartToSvg(CHART_INPUT);

		expect(svg).toContain('Projection hebdomadaire');
		expect(svg).toContain('Montant TTC (€)');
		expect(svg).toContain('14/09/2026');
	});
});

describe('resolveCssVariables', () => {
	it('substitutes the fallback so resvg does not drop the declared colour', () => {
		expect(resolveCssVariables('<text fill="var(--foreground, #111827)">x</text>')).toBe(
			'<text fill="#111827">x</text>',
		);
	});

	it('leaves a chart SVG free of custom properties', () => {
		expect(resolveCssVariables(renderChartToSvg(CHART_INPUT))).not.toContain('var(--');
	});

	it('keeps markup without custom properties untouched', () => {
		expect(resolveCssVariables('<text fill="#6b7280">x</text>')).toBe('<text fill="#6b7280">x</text>');
	});
});

import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type ChartConfig, ChartConfigProvider, ChartTooltipContent } from '../src/chart-tooltip';

type TooltipPayload = NonNullable<ComponentProps<typeof ChartTooltipContent>['payload']>;

const SEPARATOR_COLOR = 'var(--background, #ffffff)';

describe('ChartTooltipContent', () => {
	it.each([
		{ case: 'the configured series color', config: { older: { color: '#ddd6fe' } }, expected: '#ddd6fe' },
		{ case: 'the item color without a configured one', config: { older: {} }, expected: SEPARATOR_COLOR },
	])('paints the indicator with $case', ({ config, expected }) => {
		const markup = renderTooltip(config, [
			{ dataKey: 'older', name: 'older', value: 6, color: SEPARATOR_COLOR, payload: { name: 'A', older: 6 } },
		]);

		expect(indicatorColors(markup)).toEqual([expected]);
	});
});

function renderTooltip(config: ChartConfig, payload: TooltipPayload): string {
	return renderToStaticMarkup(
		<ChartConfigProvider config={config}>
			<ChartTooltipContent active payload={payload} label='A' />
		</ChartConfigProvider>,
	);
}

function indicatorColors(markup: string): string[] {
	return [...markup.matchAll(/--color-bg:([^;"]+)/g)].map((match) => match[1].trim());
}

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryElementPicker } from './story-element-picker';
import { chartBlockReference, mapBlockReference, StoryBlock } from './story-block';
import type { ParsedChartBlock, ParsedMapBlock } from '@nao/shared/story-segments';

describe('StoryElementPicker', () => {
	const onPick = vi.fn();
	const onStoryClick = vi.fn();

	afterEach(() => {
		cleanup();
		onPick.mockReset();
		onStoryClick.mockReset();
	});

	it('quotes a whole block on click instead of letting the story handle it', () => {
		renderStory(true);

		fireEvent.click(screen.getByRole('button', { name: 'Legend' }));

		expect(onPick).toHaveBeenCalledWith({
			block: { kind: 'stacked-bar-chart', title: 'Revenue', queryId: 'q1' },
			text: 'Revenue',
		});
		expect(onStoryClick).not.toHaveBeenCalled();
	});

	it('quotes a text block with its text', () => {
		renderStory(true);

		fireEvent.click(screen.getByText('March'));

		expect(onPick).toHaveBeenCalledWith({ block: { kind: 'text' }, text: 'Sales dropped in March.' });
	});

	it('leaves clicks to the story outside selection mode', () => {
		renderStory(false);

		fireEvent.click(screen.getByRole('button', { name: 'Legend' }));

		expect(onPick).not.toHaveBeenCalled();
		expect(onStoryClick).toHaveBeenCalled();
	});

	it('names blocks the way the story kit does', () => {
		expect(chartBlockReference({ chartType: 'kpi_card', title: '', queryId: 'q2' } as ParsedChartBlock)).toEqual({
			kind: 'kpi',
			title: undefined,
			queryId: 'q2',
		});
		expect(mapBlockReference({ mapType: 'points', title: 'Stores', queryId: 'q3' } as ParsedMapBlock)).toEqual({
			kind: 'point-map',
			title: 'Stores',
			queryId: 'q3',
		});
	});

	function renderStory(isPicking: boolean) {
		const chart = { chartType: 'stacked_bar', title: 'Revenue', queryId: 'q1' } as ParsedChartBlock;
		render(
			<StoryElementPicker isPicking={isPicking} onPick={onPick}>
				<StoryBlock block={chartBlockReference(chart)}>
					<h3>Revenue</h3>
					<button type='button' onClick={onStoryClick}>
						Legend
					</button>
				</StoryBlock>
				<p>
					Sales dropped in <b>March</b>.
				</p>
			</StoryElementPicker>,
		);
	}
});

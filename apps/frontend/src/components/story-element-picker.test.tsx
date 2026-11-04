// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryElementPicker } from './story-element-picker';
import { chartBlockReference, StoryBlock } from './story-block';
import { MarkdownTable } from './chat-messages/markdown-table';
import type { ParsedChartBlock } from '@nao/shared/story-segments';

vi.mock('@/main', () => ({ trpc: { analyticsEvent: { logChatDownload: { mutationOptions: () => ({}) } } } }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn() }) }));
vi.mock('@/components/export-data-menu', () => ({ ExportDataMenu: () => null }));
vi.mock('@/hooks/use-date-format', () => ({ useDateFormat: () => ({}) }));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'chat-1' }));

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

describe('MarkdownTable', () => {
	it('is a block identified by its column headers', () => {
		const { container } = render(<MarkdownTable node={markdownTable(['Month', 'Orders'], [['January', '29']])} />);

		const block = container.querySelector<HTMLElement>('[data-nao-block-kind]');

		expect(block?.dataset).toMatchObject({ naoBlockKind: 'markdown-table', naoBlockTitle: 'Month, Orders' });
	});

	it('keeps its cells selectable as parts of that block', () => {
		const { container } = render(<MarkdownTable node={markdownTable(['Month', 'Orders'], [['January', '29']])} />);

		const cell = container.querySelector<HTMLElement>('[data-nao-block-kind] td[data-nao-part="cell"]');

		expect(cell?.dataset).toMatchObject({ naoPartCategory: 'January' });
	});
});

function markdownTable(columns: string[], rows: string[][]) {
	const row = (tagName: string, cells: string[]) => ({
		tagName: 'tr',
		children: cells.map((value) => ({ tagName, children: [{ type: 'text', value }] })),
	});
	return { tagName: 'table', children: [row('th', columns), ...rows.map((cells) => row('td', cells))] };
}

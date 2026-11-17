// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { PromptHandle } from 'prompt-mentions';
import type { StoryBlockPart } from '@nao/shared/story-parts';
import {
	describeCitationSource,
	isSameCitation,
	numberCitationTokens,
	removeCitationPills,
	removeCitationTokens,
	toCitationMentionOption,
	toCopiedText,
	writeCitedText,
} from '@/lib/citation-mention';
import { readBlockAsk, readStoryElementAsk } from '@/lib/story-element-ask';

describe('citation mentions', () => {
	it('names where a citation comes from', () => {
		expect(
			[
				{ start: 12, end: 33, text: 'Revenue dipped' },
				{ start: 0, end: 0, text: 'Revenue dipped' },
				{ start: 0, end: 0, text: 'Orders', block: { kind: 'kpi', title: 'Orders' } },
				{
					start: 0,
					end: 0,
					text: 'x',
					block: { kind: 'code', title: 'src/app.tsx', lines: { start: 3, end: 8 } },
				},
			].map(describeCitationSource),
		).toEqual(['@chars 12–33', '@text', '@kpi block · Orders', '@code · src/app.tsx · L3–8']);
	});

	it('numbers pills by their place in the sent citations, leaving out a token that cites nothing', () => {
		expect(numberCitationTokens('❝[b] vs ❝[gone] ❝[a] @[story:x]', ['b', 'a'])).toBe('❝[1] vs ❝[2] @[story:x]');
	});

	it('keeps the spacing the user typed, such as indented code', () => {
		const code = 'run:\n    select *\n        from orders';

		expect(numberCitationTokens(`${code} ❝[a]`, ['a'])).toBe(`${code} ❝[1]`);
		expect(removeCitationTokens(`❝[a] ${code}`)).toBe(code);
	});

	it('reads each pill as its quote when the prompt is copied', () => {
		const fragment = document
			.createRange()
			.createContextualFragment(
				'why <span data-mention-trigger="❝" data-mention-id="c1" data-mention="“Sales…”"><span>icon</span>“Sales…”</span>' +
					' with <span data-mention-trigger="@" data-mention-id="story:s1" data-mention="Orders">Orders</span>?',
			);

		const text = toCopiedText(fragment, (id) =>
			id === 'c1' ? { start: 0, end: 0, text: 'Sales dropped\nin March' } : undefined,
		);

		expect(text).toBe('why “Sales dropped in March” with @[story:s1]?');
	});

	it('drops pills from a restored text or prompt, keeping what the user wrote around them', () => {
		const container = document.createElement('div');
		container.innerHTML =
			'<div class="prompt-input">why <span data-mention="Orders" data-mention-trigger="❝">Orders</span> so low</div>';

		removeCitationPills(container);

		expect(container.querySelector('.prompt-input')!.textContent).toBe('why so low');
		expect(removeCitationTokens('why ❝[1] is lower than ❝[2] here')).toBe('why is lower than here');
	});

	it('labels a block by its title and a passage by a short quote', () => {
		const chart = toCitationMentionOption(
			{ start: 0, end: 0, text: 'Revenue', block: { kind: 'bar-chart', title: 'Revenue' } },
			'c1',
		);
		const passage = toCitationMentionOption(
			{
				start: 0,
				end: 0,
				text: 'Sales dropped sharply after the price change in March',
				block: { kind: 'text' },
			},
			'c2',
		);
		const untitled = toCitationMentionOption({ start: 0, end: 0, text: '', block: { kind: 'data-table' } }, 'c3');

		expect([chart.label, passage.label, untitled.label]).toEqual([
			'Revenue',
			'Sales dropped sharply after the…',
			'data table',
		]);
	});

	it('names the cited part of a block after the block', () => {
		const tick = {
			start: 0,
			end: 0,
			text: 'Feb 2018',
			block: {
				kind: 'bar-chart',
				title: 'Monthly Revenue',
				part: { kind: 'axis-tick' as const, label: 'Feb 2018' },
			},
		};
		const axis = {
			start: 0,
			end: 0,
			text: '',
			block: { kind: 'bar-chart', title: 'Monthly Revenue', part: { kind: 'x-axis' as const } },
		};

		expect(toCitationMentionOption(tick, 'c1').label).toBe('Monthly Revenue · Feb 2018');
		expect(toCitationMentionOption(axis, 'c2').label).toBe('Monthly Revenue · x axis');
		expect(describeCitationSource(tick)).toBe('@bar-chart block · Monthly Revenue · Feb 2018');
	});

	it('names KPI values and table cells by what they show', () => {
		const citeOf = (part: StoryBlockPart) => {
			return { start: 0, end: 0, text: '', block: { kind: 'kpi', title: 'Orders', part } };
		};

		expect(
			toCitationMentionOption(citeOf({ kind: 'kpi-value', label: 'Total orders', value: '1,103' }), 'c1').label,
		).toBe('Orders · 1,103');
		expect(
			toCitationMentionOption(
				citeOf({ kind: 'cell', label: 'Amount', series: 'amount', category: 'Alice', value: '20' }),
				'c2',
			).label,
		).toBe('Orders · Amount · Alice');
	});

	it('names a selectable element of the story by its name and detail alone', () => {
		const part = { kind: 'element' as const, label: 'Card', value: '7 of hearts' };
		const card = { start: 0, end: 0, text: 'Card · 7 of hearts', block: { kind: 'element', part } };
		const inBlock = { ...card, block: { kind: 'kpi', title: 'Orders', part } };

		expect(toCitationMentionOption(card, 'c1').label).toBe('Card · 7 of hearts');
		expect(describeCitationSource(card)).toBe('@element · Card · 7 of hearts');
		expect(toCitationMentionOption(inBlock, 'c2').label).toBe('Orders · Card · 7 of hearts');
	});

	it('shortens a long part name in the pill like a quote', () => {
		const label = 'Revenue from enterprise customers in the north region';
		const tick = {
			start: 0,
			end: 0,
			text: '',
			block: { kind: 'bar-chart', title: 'Revenue', part: { kind: 'axis-tick' as const, label } },
		};

		expect(toCitationMentionOption(tick, 'c1').label).toBe('Revenue · Revenue from enterprise customer…');
	});

	it('tells citations of different parts of the same block apart', () => {
		const citeOf = (part?: { kind: 'cell'; value: string }) => {
			return { start: 0, end: 0, text: 'Total', block: { kind: 'data-table', title: 'Orders', part } };
		};

		expect(isSameCitation(citeOf({ kind: 'cell', value: 'a' }), citeOf({ kind: 'cell', value: 'b' }))).toBe(false);
		expect(isSameCitation(citeOf({ kind: 'cell', value: 'a' }), citeOf())).toBe(false);
		expect(isSameCitation(citeOf({ kind: 'cell', value: 'a' }), citeOf({ kind: 'cell', value: 'a' }))).toBe(true);
		expect(isSameCitation(citeOf(), citeOf())).toBe(true);
	});

	it('puts each pill of a restored message back where it was written', () => {
		const written: string[] = [];
		const prompt = {
			insertText: (text: string) => written.push(text),
			appendMention: ({ id }: { id: string }) => written.push(`[${id}]`),
		} as unknown as PromptHandle;

		writeCitedText(prompt, 'compare ❝[1] with ❝[2] please', [
			{ id: 'a', start: 0, end: 0, text: 'Revenue' },
			{ id: 'b', start: 0, end: 0, text: 'Orders' },
		]);

		expect(written).toEqual(['compare ', '[a]', 'with ', '[b]', 'please']);
	});

	it('puts the context a restored message mentions back as pills', () => {
		const written: string[] = [];
		const prompt = {
			insertText: (text: string) => written.push(text),
			appendMention: ({ label }: { label: string }, trigger: string) => written.push(`<${trigger}${label}>`),
		} as unknown as PromptHandle;

		writeCitedText(
			prompt,
			'/[weekly report] on @[schema:main.orders] and @[unknown], like ❝[1]',
			[{ id: 'a', start: 0, end: 0, text: 'Revenue' }],
			[
				{ id: 'weekly report', label: 'weekly report', trigger: '/' },
				{ id: 'schema:main.orders', label: 'orders', trigger: '@' },
			],
		);

		expect(written).toEqual(['</weekly report>', 'on ', '<@orders>', 'and @[unknown], like ', '<❝Revenue>']);
	});
});

describe('readStoryElementAsk', () => {
	it('keeps a valid part', () => {
		const ask = {
			block: { kind: 'kpi', title: 'Total', part: { kind: 'kpi-value' as const, value: '1,103' } },
			text: '1,103',
		};

		expect(readStoryElementAsk(ask)).toEqual(ask);
	});

	it('drops an invalid part', () => {
		const unknownKind = { block: { kind: 'kpi', part: { kind: 'bogus' } }, text: 'x' };
		const nonStringValue = { block: { kind: 'data-table', part: { kind: 'cell', value: 3 } }, text: 'x' };

		expect(readStoryElementAsk(unknownKind as never)?.block?.part).toBeUndefined();
		expect(readStoryElementAsk(nonStringValue as never)?.block?.part).toBeUndefined();
	});

	it('drops a part with a field longer than 200 characters and ignores unknown keys', () => {
		const tooLong = { block: { kind: 'kpi', part: { kind: 'cell', label: 'a'.repeat(201) } }, text: 'x' };
		const extra = { block: { kind: 'kpi', part: { kind: 'cell', label: 'a', evil: 'b' } }, text: 'x' };

		expect(readStoryElementAsk(tooLong as never)?.block?.part).toBeUndefined();
		expect(readStoryElementAsk(extra as never)?.block?.part).toEqual({ kind: 'cell', label: 'a' });
	});

	it('rejects code blocks and non-string text', () => {
		expect(readStoryElementAsk({ block: { kind: 'code' }, text: 'x' })).toBeNull();
		expect(readStoryElementAsk({ block: { kind: 'kpi' }, text: 3 } as never)).toBeNull();
	});
});

describe('readBlockAsk', () => {
	it('asks about the whole block, dropping any part the frame posted with it', () => {
		const forged = { kind: 'kpi', title: 'Total', queryId: 'q1', part: { kind: 'kpi-value' as const, value: '3' } };

		expect(readBlockAsk(forged)).toEqual({ block: { kind: 'kpi', title: 'Total', queryId: 'q1' }, text: 'Total' });
	});

	it('rejects a missing or malformed block', () => {
		expect(readBlockAsk(undefined)).toBeNull();
		expect(readBlockAsk({ kind: 'kpi', title: 3 } as never)).toBeNull();
		expect(readBlockAsk({ kind: 'code' })).toBeNull();
	});
});

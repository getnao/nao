// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
	describeCitationSource,
	numberCitationTokens,
	removeCitationPills,
	removeCitationTokens,
	toCitationMentionOption,
	toCopiedText,
	writeCitedText,
} from './citation-mention';
import type { PromptHandle } from 'prompt-mentions';

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
});

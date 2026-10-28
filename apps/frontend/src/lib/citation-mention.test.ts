import { describe, expect, it } from 'vitest';

import {
	describeCitationSource,
	extractCitationIds,
	numberCitationTokens,
	quoteCitations,
	removeCitationTokens,
	toCitationMentionOption,
} from './citation-mention';

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

	it('labels code by its file name and lines, or the story source when it has no file', () => {
		const fileCode = toCitationMentionOption(
			{ start: 0, end: 0, text: 'x', block: { kind: 'code', title: 'src/app.tsx', lines: { start: 3, end: 8 } } },
			'c1',
		);
		const sourceCode = toCitationMentionOption(
			{ start: 0, end: 0, text: 'x', block: { kind: 'code', lines: { start: 5, end: 5 } } },
			'c2',
		);

		expect([fileCode.label, sourceCode.label]).toEqual(['app.tsx · L3–8', 'Source · L5']);
	});

	it('lists each pill once, in reading order', () => {
		expect(extractCitationIds('❝[b] vs ❝[a] and ❝[b] again')).toEqual(['b', 'a']);
	});

	it('numbers pills by their place in the sent citations and leaves other text alone', () => {
		expect(numberCitationTokens('❝[b] vs ❝[a] @[story:x]', ['b', 'a'])).toBe('❝[1] vs ❝[2] @[story:x]');
	});

	it('leaves out a token that cites nothing', () => {
		expect(numberCitationTokens('why ❝[gone] is ❝[a] low', ['a'])).toBe('why is ❝[1] low');
	});

	it('quotes each citation when a sent message is copied', () => {
		expect(quoteCitations('❝[1] vs ❝[2]?', [{ start: 0, end: 0, text: 'Revenue\nin May' }])).toBe(
			'“Revenue in May” vs ❝[2]?',
		);
	});

	it('drops pills from a restored text without leaving double spaces', () => {
		expect(removeCitationTokens('why ❝[1] is lower than ❝[2] here')).toBe('why is lower than here');
	});

	it('keeps a quote spanning several lines on one line', () => {
		const pill = toCitationMentionOption({ start: 0, end: 0, text: 'Sudoku\nPublished · v4\n\nYou' }, 'c1');

		expect(pill.label).toBe('Sudoku Published · v4 You');
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
});

import { describe, expect, it } from 'vitest';

import { areGroupedMessagePartsEqual } from './ai';
import type { GroupedMessagePart } from '@/types/ai';

const createToolPart = (overrides: Record<string, unknown> = {}): GroupedMessagePart =>
	({
		type: 'dynamic-tool',
		toolName: 'display_chart',
		toolCallId: 'call-1',
		state: 'output-available',
		input: {},
		output: {},
		...overrides,
	}) as unknown as GroupedMessagePart;

describe('areGroupedMessagePartsEqual', () => {
	it('treats deeply equal settled tool inputs with different identities as equal', () => {
		const left = createToolPart({ input: { chart: { title: 'Revenue' }, series: ['sales'] } });
		const right = createToolPart({ input: { chart: { title: 'Revenue' }, series: ['sales'] } });

		expect(areGroupedMessagePartsEqual(left, right)).toBe(true);
	});

	it('treats a nested settled tool input change as different', () => {
		const left = createToolPart({ input: { chart: { title: 'Revenue' } } });
		const right = createToolPart({ input: { chart: { title: 'Profit' } } });

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('treats a changed tool state as different', () => {
		const part = createToolPart();
		const changed = { ...part, state: 'output-error' } as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(part, changed)).toBe(false);
	});

	it('treats settled execute_sql parts with different output revisions as different', () => {
		const input = { sql_query: 'select revenue' };
		const left = createToolPart({ type: 'tool-execute_sql', input, output: { revision: 1 } });
		const right = createToolPart({ type: 'tool-execute_sql', input, output: { revision: 2 } });

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('ignores changed output references for settled tools without revisions', () => {
		const left = createToolPart({ output: { result: 'first' } });
		const right = createToolPart({ output: { result: 'second' } });

		expect(areGroupedMessagePartsEqual(left, right)).toBe(true);
	});

	it('treats a transition to a settled state as different', () => {
		const left = createToolPart({ state: 'input-available' });
		const right = createToolPart({ state: 'output-available' });

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('treats changed output references for non-settled tools as different', () => {
		const left = createToolPart({ state: 'input-available', output: {} });
		const right = createToolPart({ state: 'input-available', output: {} });

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('treats changed text as different', () => {
		const left = { type: 'text', text: 'Before' } as GroupedMessagePart;
		const right = { type: 'text', text: 'After' } as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('treats text with different states as different', () => {
		const left = { type: 'text', text: 'Answer', state: 'streaming' } as GroupedMessagePart;
		const right = { type: 'text', text: 'Answer', state: 'done' } as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('treats equal text and state with different object identities as equal', () => {
		const left = { type: 'text', text: 'Answer', state: 'done' } as GroupedMessagePart;
		const right = { type: 'text', text: 'Answer', state: 'done' } as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(left, right)).toBe(true);
	});

	it('treats reasoning with different states as different', () => {
		const left = { type: 'reasoning', text: 'Working', state: 'streaming' } as GroupedMessagePart;
		const right = { type: 'reasoning', text: 'Working', state: 'done' } as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});

	it('treats equal reasoning and state with different object identities as equal', () => {
		const left = { type: 'reasoning', text: 'Working', state: 'done' } as GroupedMessagePart;
		const right = { type: 'reasoning', text: 'Working', state: 'done' } as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(left, right)).toBe(true);
	});

	it('compares text parts without state safely', () => {
		const left = { type: 'text', text: 'Answer' } as GroupedMessagePart;
		const right = { type: 'text', text: 'Answer' } as GroupedMessagePart;

		expect(() => areGroupedMessagePartsEqual(left, right)).not.toThrow();
		expect(areGroupedMessagePartsEqual(left, right)).toBe(true);
	});

	it('defaults unknown part types to different', () => {
		const unknown = { type: 'unknown' } as unknown as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(unknown, unknown)).toBe(false);
	});

	it('treats a tool group with a changed child as different', () => {
		const input = {};
		const output = {};
		const left = {
			type: 'tool-group',
			parts: [createToolPart({ input, output })],
		} as GroupedMessagePart;
		const right = {
			type: 'tool-group',
			parts: [createToolPart({ input, output, state: 'output-error' })],
		} as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(left, right)).toBe(false);
	});
});

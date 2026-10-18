import { describe, expect, it } from 'vitest';

import { areGroupedMessagePartsEqual, checkAssistantMessageHasContent, groupToolCalls } from './ai';
import type { UIMessage, UIMessagePart } from '@nao/backend/chat';
import type { GroupedMessagePart } from '@/types/ai';

const PROGRESS_UPDATE = {
	type: 'reasoning',
	text: 'Found 99 orders, charting them next.',
	state: 'done',
	providerMetadata: { anthropic: { signature: 'sig', progressUpdate: true } },
} as UIMessagePart;
const HIDDEN_REASONING = {
	type: 'reasoning',
	text: '',
	state: 'done',
	providerMetadata: { anthropic: { signature: 'sig' } },
} as UIMessagePart;
const FOLLOW_UPS = {
	type: 'tool-suggest_follow_ups',
	toolCallId: 'call-2',
	state: 'output-available',
} as UIMessagePart;

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

const createStoryPart = (
	toolCallId: string,
	overrides: { input?: Record<string, unknown>; output?: Record<string, unknown>; state?: string } = {},
): UIMessagePart =>
	({
		type: 'tool-story',
		toolCallId,
		state: overrides.state ?? 'output-available',
		input: 'input' in overrides ? overrides.input : { action: 'create', id: 'revenue' },
		output: 'output' in overrides ? overrides.output : { success: true, id: 'revenue', version: 1 },
	}) as unknown as UIMessagePart;

const createQueryPart = (toolCallId: string): UIMessagePart =>
	({
		type: 'tool-execute_sql',
		toolCallId,
		state: 'output-available',
		input: { name: toolCallId, sql_query: 'select 1' },
		output: { row_count: 1 },
	}) as unknown as UIMessagePart;

describe('story actions', () => {
	it('keeps the card on the latest action and turns earlier ones on the same story into status lines', () => {
		const created = createStoryPart('call-1');
		const updated = createStoryPart('call-2', {
			input: { action: 'update', id: 'revenue' },
			output: { success: true, id: 'revenue', version: 2 },
		});
		const text = { type: 'text', text: 'Done.', state: 'done' } as UIMessagePart;

		expect(groupToolCalls([created, text, updated])).toEqual([
			{ type: 'story-status', part: created },
			text,
			updated,
		]);
	});

	it('keeps one card per story', () => {
		const revenue = createStoryPart('call-1');
		const churn = createStoryPart('call-2', {
			input: { action: 'create', id: 'churn' },
			output: { success: true, id: 'churn', version: 1 },
		});

		expect(groupToolCalls([revenue, churn])).toEqual([revenue, churn]);
	});

	it('demotes a failed attempt once a later action on the story exists', () => {
		const failed = createStoryPart('call-1', {
			input: { action: 'update', id: 'revenue' },
			output: { success: false, id: 'revenue', error: 'Search string not found' },
		});
		const retried = createStoryPart('call-2', { input: { action: 'replace', id: 'revenue' } });

		expect(groupToolCalls([failed, retried])).toEqual([{ type: 'story-status', part: failed }, retried]);
	});

	it('follows the story id from a streaming input before any output exists', () => {
		const created = createStoryPart('call-1');
		const streaming = createStoryPart('call-2', {
			state: 'input-streaming',
			input: { action: 'update', id: 'revenue' },
			output: undefined,
		});

		expect(groupToolCalls([created, streaming])).toEqual([{ type: 'story-status', part: created }, streaming]);
	});

	it('leaves a story action whose id is not known yet as a card', () => {
		const created = createStoryPart('call-1');
		const unknown = createStoryPart('call-2', { state: 'input-streaming', input: {}, output: undefined });

		expect(groupToolCalls([created, unknown])).toEqual([created, unknown]);
	});

	it('groups a superseded story action with queries that immediately follow it', () => {
		const created = createStoryPart('call-1');
		const firstQuery = createQueryPart('query-1');
		const secondQuery = createQueryPart('query-2');
		const updated = createStoryPart('call-2', {
			input: { action: 'update', id: 'revenue' },
			output: { success: true, id: 'revenue', version: 2 },
		});

		expect(groupToolCalls([created, firstQuery, secondQuery, updated])).toEqual([
			{ type: 'story-query-group', parts: [{ type: 'story-status', part: created }, firstQuery, secondQuery] },
			updated,
		]);
	});

	it('groups a superseded story action with queries that immediately precede it', () => {
		const firstQuery = createQueryPart('query-1');
		const secondQuery = createQueryPart('query-2');
		const created = createStoryPart('call-1');
		const updated = createStoryPart('call-2', {
			input: { action: 'update', id: 'revenue' },
			output: { success: true, id: 'revenue', version: 2 },
		});

		expect(groupToolCalls([firstQuery, secondQuery, created, updated])).toEqual([
			{ type: 'story-query-group', parts: [firstQuery, secondQuery, { type: 'story-status', part: created }] },
			updated,
		]);
	});

	it('groups multiple superseded story actions and their adjacent queries into one foldable', () => {
		const created = createStoryPart('call-1');
		const firstQuery = createQueryPart('query-1');
		const refined = createStoryPart('call-2', {
			input: { action: 'replace', id: 'revenue' },
			output: { success: true, id: 'revenue', version: 2 },
		});
		const secondQuery = createQueryPart('query-2');
		const updated = createStoryPart('call-3', {
			input: { action: 'update', id: 'revenue' },
			output: { success: true, id: 'revenue', version: 3 },
		});

		expect(groupToolCalls([created, firstQuery, refined, secondQuery, updated])).toEqual([
			{
				type: 'story-query-group',
				parts: [
					{ type: 'story-status', part: created },
					firstQuery,
					{ type: 'story-status', part: refined },
					secondQuery,
				],
			},
			updated,
		]);
	});

	it('compares status lines by their underlying tool call', () => {
		const created = createStoryPart('call-1');
		const asStatus = { type: 'story-status', part: created } as GroupedMessagePart;
		const changed = {
			type: 'story-status',
			part: { ...created, state: 'output-error' },
		} as GroupedMessagePart;

		expect(areGroupedMessagePartsEqual(asStatus, { ...asStatus } as GroupedMessagePart)).toBe(true);
		expect(areGroupedMessagePartsEqual(asStatus, changed)).toBe(false);
		expect(areGroupedMessagePartsEqual(asStatus, created as GroupedMessagePart)).toBe(false);
	});
});

describe('query runs', () => {
	it('keeps queries in one group when several notes sit between them', () => {
		const firstQuery = createQueryPart('query-1');
		const firstNote = { type: 'reasoning', text: 'Checking totals', state: 'done' } as UIMessagePart;
		const secondNote = { type: 'reasoning', text: 'Now by region', state: 'done' } as UIMessagePart;
		const secondQuery = createQueryPart('query-2');

		expect(groupToolCalls([firstQuery, firstNote, secondNote, secondQuery])).toEqual([
			{ type: 'query-group', parts: [firstQuery, firstNote, secondNote, secondQuery] },
		]);
	});
});

describe('progress updates', () => {
	it('collapses a progress update into the tool group like any reasoning', () => {
		const readPart = createToolPart({ type: 'tool-read', toolName: 'read' }) as UIMessagePart;
		const grouped = groupToolCalls([HIDDEN_REASONING, PROGRESS_UPDATE, readPart, readPart]);

		expect(grouped).toHaveLength(1);
		expect(grouped[0]).toMatchObject({
			type: 'tool-group',
			parts: [PROGRESS_UPDATE, readPart, readPart],
		});
	});

	it('hides a progress update the backend promoted to the visible answer', () => {
		const answer = { type: 'text', text: 'Found 99 orders, charting them next.', state: 'done' } as UIMessagePart;
		const grouped = groupToolCalls([HIDDEN_REASONING, PROGRESS_UPDATE, answer, FOLLOW_UPS]);

		expect(grouped).toEqual([answer, FOLLOW_UPS]);
	});

	it('keeps a progress update whose text differs from the answer that follows', () => {
		const answer = { type: 'text', text: 'A different answer.', state: 'done' } as UIMessagePart;
		const grouped = groupToolCalls([PROGRESS_UPDATE, answer]);

		expect(grouped).toEqual([PROGRESS_UPDATE, answer]);
	});

	it('counts a progress update as content, unlike hidden reasoning', () => {
		const withUpdate = { role: 'assistant', parts: [HIDDEN_REASONING, PROGRESS_UPDATE, FOLLOW_UPS] } as UIMessage;
		const withoutUpdate = { role: 'assistant', parts: [HIDDEN_REASONING, FOLLOW_UPS] } as UIMessage;

		expect(checkAssistantMessageHasContent(withUpdate)).toBe(true);
		expect(checkAssistantMessageHasContent(withoutUpdate)).toBe(false);
	});
});

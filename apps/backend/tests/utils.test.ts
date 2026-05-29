import { describe, expect, it } from 'vitest';

import type { UIMessage, UIMessagePart } from '../src/types/chat';
import { settleInterruptedToolParts } from '../src/utils/ai';
import { truncateMiddle } from '../src/utils/utils';

describe('truncateMiddle', () => {
	it('returns the string unchanged when shorter than maxLength', () => {
		expect(truncateMiddle('hello', 10)).toBe('hello');
	});

	it('truncates the middle of a long string', () => {
		expect(truncateMiddle('abcdefghij', 7)).toBe('ab...ij');
	});

	it('slices without ellipsis when maxLength <= ellipsis length', () => {
		expect(truncateMiddle('abcdef', 3)).toBe('abc');
	});

	it('uses a custom ellipsis string', () => {
		expect(truncateMiddle('abcdefghij', 8, '--')).toBe('abc--hij');
	});
});

describe('settleInterruptedToolParts', () => {
	const textPart = (text: string): UIMessagePart => ({ type: 'text', text });

	const toolPart = (state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error', id = 'c1') =>
		({
			type: 'tool-execute_sql',
			toolCallId: id,
			state,
			input: { query: 'select 1' },
			...(state === 'output-available' ? { output: { rows: [] } } : {}),
			...(state === 'output-error' ? { errorText: 'boom' } : {}),
		}) as unknown as UIMessagePart;

	const message = (role: UIMessage['role'], parts: UIMessagePart[], id = 'm1'): UIMessage =>
		({ id, role, parts }) as UIMessage;

	const asTool = (part: UIMessagePart) => part as unknown as { state: string; input: unknown; errorText?: string };

	it('transitions input-streaming tool parts into output-error with an interrupted message', () => {
		const messages = [message('assistant', [textPart('hi'), toolPart('input-streaming')])];
		const result = settleInterruptedToolParts(messages);
		expect(result).toHaveLength(1);
		expect(result[0].parts[0]).toEqual(textPart('hi'));
		const tool = asTool(result[0].parts[1]);
		expect(tool.state).toBe('output-error');
		expect(tool.errorText).toMatch(/interrupted/i);
		expect(tool.input).toEqual({ query: 'select 1' });
	});

	it('transitions input-available tool parts into output-error', () => {
		const messages = [message('assistant', [toolPart('input-available')])];
		const result = settleInterruptedToolParts(messages);
		const tool = asTool(result[0].parts[0]);
		expect(tool.state).toBe('output-error');
		expect(tool.errorText).toMatch(/interrupted/i);
	});

	it('falls back to an empty input object when the tool part has no input yet', () => {
		const noInputTool = {
			type: 'tool-execute_sql',
			toolCallId: 'c1',
			state: 'input-streaming',
		} as unknown as UIMessagePart;
		const result = settleInterruptedToolParts([message('assistant', [noInputTool])]);
		const tool = asTool(result[0].parts[0]);
		expect(tool.state).toBe('output-error');
		expect(tool.input).toEqual({});
	});

	it('leaves settled tool parts (output-available, output-error, output-denied) untouched', () => {
		const settled: UIMessagePart[] = [
			toolPart('output-available', 'a'),
			toolPart('output-error', 'b'),
			{
				type: 'tool-execute_sql',
				toolCallId: 'c',
				state: 'output-denied',
				input: {},
			} as unknown as UIMessagePart,
		];
		const result = settleInterruptedToolParts([message('assistant', settled)]);
		expect(result[0].parts).toEqual(settled);
	});

	it('keeps the assistant message in place even if it only contained unsettled tools', () => {
		const messages = [
			message('user', [textPart('hello')], 'u1'),
			message('assistant', [toolPart('input-streaming')], 'a1'),
			message('user', [textPart('still there?')], 'u2'),
		];
		const result = settleInterruptedToolParts(messages);
		expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
		expect(asTool(result[1].parts[0]).state).toBe('output-error');
	});

	it('leaves user messages and non-tool parts untouched', () => {
		const reasoning = { type: 'reasoning', text: 'thinking' } as UIMessagePart;
		const messages = [
			message('user', [textPart('hello'), toolPart('input-streaming')], 'u1'),
			message('assistant', [textPart('hi'), reasoning], 'a1'),
		];
		const result = settleInterruptedToolParts(messages);
		expect(result[0].parts).toEqual([textPart('hello'), toolPart('input-streaming')]);
		expect(result[1].parts).toEqual([textPart('hi'), reasoning]);
	});

	it('returns the same message reference when nothing changes', () => {
		const original = message('assistant', [textPart('hi'), toolPart('output-available')]);
		const result = settleInterruptedToolParts([original]);
		expect(result[0]).toBe(original);
	});
});

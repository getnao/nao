import type { LanguageModelV3, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import { withProgressUpdates } from '../../src/agents/anthropic-progress-updates';

const SIGNATURE = { anthropic: { signature: 'sig' } };

const CHUNKS: LanguageModelV3StreamPart[] = [
	{ type: 'reasoning-start', id: '0' },
	{ type: 'reasoning-delta', id: '0', delta: '' },
	{ type: 'reasoning-delta', id: '0', delta: '', providerMetadata: SIGNATURE },
	{ type: 'reasoning-end', id: '0' },
	{ type: 'reasoning-start', id: '1' },
	{ type: 'reasoning-delta', id: '1', delta: 'Found 99 orders, ' },
	{ type: 'reasoning-delta', id: '1', delta: 'charting them next.' },
	{ type: 'reasoning-delta', id: '1', delta: '', providerMetadata: SIGNATURE },
	{ type: 'reasoning-end', id: '1' },
	{ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: {} as never },
];

describe('withProgressUpdates', () => {
	it('tags reasoning blocks that carry text and keeps their signature under display updates', async () => {
		const parts = await streamThrough(CHUNKS, { thinking: { type: 'adaptive', display: 'updates' } });

		const reasoning = parts.filter((part) => part.type === 'reasoning-delta' || part.type === 'reasoning-end');
		const hidden = reasoning.filter((part) => part.id === '0');
		const update = reasoning.filter((part) => part.id === '1');

		expect(hidden.map((part) => part.providerMetadata)).toEqual([undefined, SIGNATURE, undefined]);
		expect(update[0].providerMetadata).toEqual({ anthropic: { progressUpdate: true } });
		expect(update.at(-1)?.providerMetadata).toEqual({ anthropic: { signature: 'sig', progressUpdate: true } });
	});

	it('leaves reasoning untouched under other displays, where text may be actual reasoning', async () => {
		const summarized = await streamThrough(CHUNKS, { thinking: { type: 'adaptive', display: 'summarized' } });
		const unset = await streamThrough(CHUNKS, { thinking: { type: 'adaptive' } });

		expect(summarized).toEqual(CHUNKS);
		expect(unset).toEqual(CHUNKS);
	});

	describe('answer promotion', () => {
		const ANSWER = note('1', ['There are 99 orders, ', 'up 12% on last month.']);
		const FOLLOW_UPS = toolCall('call-1', 'suggest_follow_ups');

		it('promotes the note written before a lone suggest_follow_ups call to a text block', async () => {
			const parts = await streamThrough([...ANSWER, ...FOLLOW_UPS, FINISH], UPDATES);

			expect(parts.map((part) => part.type)).toEqual([
				'reasoning-start',
				'reasoning-delta',
				'reasoning-delta',
				'reasoning-end',
				'text-start',
				'text-delta',
				'text-end',
				'tool-input-start',
				'tool-input-end',
				'tool-call',
				'finish',
			]);
			expect(parts.find((part) => part.type === 'text-delta')).toEqual({
				type: 'text-delta',
				id: 'call-1-answer',
				delta: 'There are 99 orders, up 12% on last month.',
			});
		});

		it('promotes only the last note when Claude left several', async () => {
			const earlier = note('0', ['Checking the orders table first.']);
			const parts = await streamThrough([...earlier, ...ANSWER, ...FOLLOW_UPS, FINISH], UPDATES);

			expect(parts.filter((part) => part.type === 'text-delta').map((part) => part.delta)).toEqual([
				'There are 99 orders, up 12% on last month.',
			]);
		});

		it('does not promote when another tool call follows suggest_follow_ups in the same response', async () => {
			const chunks = [...ANSWER, ...FOLLOW_UPS, ...toolCall('call-2', 'execute_sql'), FINISH];
			const parts = await streamThrough(chunks, UPDATES);

			expect(parts.map((part) => part.type)).toEqual(chunks.map((chunk) => chunk.type));
		});

		it('releases the held call when the stream ends without finishing', async () => {
			const parts = await streamThrough([...ANSWER, ...FOLLOW_UPS], UPDATES);

			expect(parts.some((part) => part.type === 'text-start')).toBe(false);
			expect(parts.filter((part) => part.type === 'tool-call')).toHaveLength(1);
		});

		it('does not promote when Claude already wrote visible text', async () => {
			const text: LanguageModelV3StreamPart[] = [
				{ type: 'text-start', id: 't' },
				{ type: 'text-delta', id: 't', delta: 'Here is the answer.' },
				{ type: 'text-end', id: 't' },
			];
			const parts = await streamThrough([...ANSWER, ...text, ...FOLLOW_UPS, FINISH], UPDATES);

			expect(parts.filter((part) => part.type === 'text-delta')).toHaveLength(1);
		});

		it('does not promote when suggest_follow_ups follows another tool call in the same response', async () => {
			const parts = await streamThrough(
				[...ANSWER, ...toolCall('call-0', 'execute_sql'), ...FOLLOW_UPS, FINISH],
				UPDATES,
			);

			expect(parts.some((part) => part.type === 'text-start')).toBe(false);
		});

		it('does not promote for other tools', async () => {
			const parts = await streamThrough([...ANSWER, ...toolCall('call-0', 'execute_sql'), FINISH], UPDATES);

			expect(parts.some((part) => part.type === 'text-start')).toBe(false);
		});

		it('does not promote under other displays', async () => {
			const chunks = [...ANSWER, ...FOLLOW_UPS, FINISH];
			const parts = await streamThrough(chunks, { thinking: { type: 'adaptive', display: 'summarized' } });

			expect(parts).toEqual(chunks);
		});
	});
});

const UPDATES = { thinking: { type: 'adaptive', display: 'updates' } };

const FINISH: LanguageModelV3StreamPart = {
	type: 'finish',
	finishReason: { unified: 'tool-calls', raw: undefined },
	usage: {} as never,
};

function note(id: string, deltas: string[]): LanguageModelV3StreamPart[] {
	return [
		{ type: 'reasoning-start', id },
		...deltas.map((delta): LanguageModelV3StreamPart => ({ type: 'reasoning-delta', id, delta })),
		{ type: 'reasoning-end', id, providerMetadata: SIGNATURE },
	];
}

function toolCall(id: string, toolName: string): LanguageModelV3StreamPart[] {
	return [
		{ type: 'tool-input-start', id, toolName },
		{ type: 'tool-input-end', id },
		{ type: 'tool-call', toolCallId: id, toolName, input: '{}' },
	];
}

async function streamThrough(
	chunks: LanguageModelV3StreamPart[],
	anthropicOptions: SharedV3ProviderMetadata[string],
): Promise<LanguageModelV3StreamPart[]> {
	const model = withProgressUpdates(fakeModel(chunks));
	const { stream } = await model.doStream({ prompt: [], providerOptions: { anthropic: anthropicOptions } });
	const collected: LanguageModelV3StreamPart[] = [];
	for await (const chunk of stream) {
		collected.push(chunk);
	}
	return collected;
}

function fakeModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
	return {
		specificationVersion: 'v3',
		provider: 'anthropic',
		modelId: 'claude-opus-5-5',
		supportedUrls: {},
		doGenerate: async () => {
			throw new Error('not used');
		},
		doStream: async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					chunks.forEach((chunk) => controller.enqueue(chunk));
					controller.close();
				},
			}),
		}),
	};
}

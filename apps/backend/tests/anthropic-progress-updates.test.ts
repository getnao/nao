import type { LanguageModelV3, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import { withProgressUpdates } from '../src/agents/anthropic-progress-updates';

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
});

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

import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3StreamPart,
	SharedV3ProviderMetadata,
} from '@ai-sdk/provider';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

/**
 * Under `thinking.display: "updates"` Claude returns reasoning blocks empty and the notes it
 * writes before a tool call with text, so any reasoning block that carries text is a progress
 * update. Tags those blocks for the UI; the signature stays untouched because the block must be
 * sent back to the model unchanged.
 */
export function withProgressUpdates(model: LanguageModelV3): LanguageModelV3 {
	return wrapLanguageModel({ model, middleware: progressUpdatesMiddleware });
}

const progressUpdatesMiddleware: LanguageModelMiddleware = {
	specificationVersion: 'v3',
	wrapStream: async ({ doStream, params }) => {
		const result = await doStream();
		if (!requestsProgressUpdates(params)) {
			return result;
		}
		const { stream, ...rest } = result;
		const tagger = new ProgressUpdateTagger();
		return {
			stream: stream.pipeThrough(
				new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
					transform(chunk, controller) {
						controller.enqueue(tagger.tag(chunk));
					},
				}),
			),
			...rest,
		};
	},
};

function requestsProgressUpdates(params: LanguageModelV3CallOptions): boolean {
	const thinking = params.providerOptions?.anthropic?.thinking;
	return typeof thinking === 'object' && thinking !== null && 'display' in thinking && thinking.display === 'updates';
}

/** The SDK keeps the last provider metadata seen on a block, so every tagged chunk re-sends the full metadata. */
class ProgressUpdateTagger {
	private readonly _metadata = new Map<string, SharedV3ProviderMetadata | undefined>();
	private readonly _progressUpdates = new Set<string>();

	tag(chunk: LanguageModelV3StreamPart): LanguageModelV3StreamPart {
		if (chunk.type !== 'reasoning-delta' && chunk.type !== 'reasoning-end') {
			return chunk;
		}
		if (chunk.providerMetadata) {
			this._metadata.set(chunk.id, chunk.providerMetadata);
		}
		if (chunk.type === 'reasoning-delta' && chunk.delta.trim() !== '') {
			this._progressUpdates.add(chunk.id);
		}
		if (!this._progressUpdates.has(chunk.id)) {
			return chunk;
		}
		return { ...chunk, providerMetadata: markProgressUpdate(this._metadata.get(chunk.id)) };
	}
}

function markProgressUpdate(metadata: SharedV3ProviderMetadata | undefined): SharedV3ProviderMetadata {
	return { ...metadata, anthropic: { ...metadata?.anthropic, progressUpdate: true } };
}

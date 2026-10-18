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
 *
 * When the only tool of the response is `suggest_follow_ups` and Claude wrote no text, the note
 * it left right before the call is its answer: it is promoted to a text block so the user reads it.
 */
export function withProgressUpdates(model: LanguageModelV3): LanguageModelV3 {
	return wrapLanguageModel({ model, middleware: progressUpdatesMiddleware });
}

const ANSWER_ONLY_TOOL = 'suggest_follow_ups';

type PendingToolCall = { toolCallId: string; chunks: LanguageModelV3StreamPart[] };

const progressUpdatesMiddleware: LanguageModelMiddleware = {
	specificationVersion: 'v3',
	wrapStream: async ({ doStream, params }) => {
		const result = await doStream();
		if (!requestsProgressUpdates(params)) {
			return result;
		}
		const { stream, ...rest } = result;
		const tagger = new ProgressUpdateTagger();
		const promoter = new AnswerPromoter();
		return {
			stream: stream.pipeThrough(
				new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
					transform(chunk, controller) {
						for (const part of promoter.promote(tagger.tag(chunk))) {
							controller.enqueue(part);
						}
					},
					flush(controller) {
						for (const part of promoter.release()) {
							controller.enqueue(part);
						}
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

/**
 * Turns the last progress update into the visible answer when `suggest_follow_ups` turns out to be
 * the only tool of the response. From that call on, chunks are held until the response finishes
 * (promote) or another tool call starts (release as-is).
 */
class AnswerPromoter {
	private _lastNoteId: string | undefined;
	private _lastNoteText = '';
	private _hasVisibleText = false;
	private _toolCallCount = 0;
	private _pending: PendingToolCall | undefined;

	promote(chunk: LanguageModelV3StreamPart): LanguageModelV3StreamPart[] {
		if (chunk.type === 'tool-input-start') {
			return this._onToolInputStart(chunk);
		}
		if (this._pending) {
			return this._hold(this._pending, chunk);
		}
		this._trackText(chunk);
		return [chunk];
	}

	release(): LanguageModelV3StreamPart[] {
		const chunks = this._pending?.chunks ?? [];
		this._pending = undefined;
		return chunks;
	}

	private _onToolInputStart(
		chunk: Extract<LanguageModelV3StreamPart, { type: 'tool-input-start' }>,
	): LanguageModelV3StreamPart[] {
		this._toolCallCount += 1;
		if (this._pending) {
			return [...this.release(), chunk];
		}
		if (!this._canPromoteBefore(chunk.toolName)) {
			return [chunk];
		}
		this._pending = { toolCallId: chunk.id, chunks: [chunk] };
		return [];
	}

	private _hold(pending: PendingToolCall, chunk: LanguageModelV3StreamPart): LanguageModelV3StreamPart[] {
		if (chunk.type !== 'finish') {
			pending.chunks.push(chunk);
			return [];
		}
		const answer = textBlock(`${pending.toolCallId}-answer`, this._lastNoteText.trim());
		return [...answer, ...this.release(), chunk];
	}

	private _trackText(chunk: LanguageModelV3StreamPart): void {
		if (chunk.type === 'text-delta' && chunk.delta.trim() !== '') {
			this._hasVisibleText = true;
		}
		if (!isProgressUpdateDelta(chunk)) {
			return;
		}
		if (chunk.id !== this._lastNoteId) {
			this._lastNoteId = chunk.id;
			this._lastNoteText = '';
		}
		this._lastNoteText += chunk.delta;
	}

	private _canPromoteBefore(toolName: string): boolean {
		return (
			toolName === ANSWER_ONLY_TOOL &&
			this._toolCallCount === 1 &&
			!this._hasVisibleText &&
			this._lastNoteText.trim() !== ''
		);
	}
}

function isProgressUpdateDelta(
	chunk: LanguageModelV3StreamPart,
): chunk is Extract<LanguageModelV3StreamPart, { type: 'reasoning-delta' }> {
	return chunk.type === 'reasoning-delta' && chunk.providerMetadata?.anthropic?.progressUpdate === true;
}

function textBlock(id: string, text: string): LanguageModelV3StreamPart[] {
	return [
		{ type: 'text-start', id },
		{ type: 'text-delta', id, delta: text },
		{ type: 'text-end', id },
	];
}

function markProgressUpdate(metadata: SharedV3ProviderMetadata | undefined): SharedV3ProviderMetadata {
	return { ...metadata, anthropic: { ...metadata?.anthropic, progressUpdate: true } };
}

import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LocalAgentUsage } from '@nao/shared/local-agent';
import { LOCAL_AGENT_OUTPUT_META_KEY, LOCAL_AGENT_TOOL_PREFIX } from '@nao/shared/local-agent';
import type { UIMessageChunk } from 'ai';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type ContentBlock = Extract<StreamEvent, { type: 'content_block_start' }>['content_block'];
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

interface OpenBlock {
	kind: 'text' | 'reasoning' | 'tool';
	id: string;
}

export interface TurnOutcome {
	modelId: string;
	errorMessage?: string;
	usage?: LocalAgentUsage;
	/** Claude Code's estimate of the API price of the turn; a subscription is not billed by it. */
	estimatedCostUsd: number;
	durationMs: number;
}

/**
 * Turns the messages of a Claude Code session into the AI SDK UI message chunks the nao chat
 * renders. Text and thinking stream from the partial messages; a tool call is complete once its
 * assistant message arrives, and its result comes back in the next user message. A step closes
 * when the next model call starts, so tool results stay inside the step that called the tools.
 */
export class UIMessageTranslator {
	private _modelId = '';
	private _messageId = '';
	private _isStepOpen = false;
	private readonly _openBlocks = new Map<number, OpenBlock>();
	private readonly _startedToolCalls = new Set<string>();
	private readonly _streamedMessageIds = new Set<string>();
	private _outcome: TurnOutcome | undefined;

	translate(message: SDKMessage): UIMessageChunk[] {
		if ('parent_tool_use_id' in message && message.parent_tool_use_id) {
			return [];
		}
		switch (message.type) {
			case 'system':
				return this._readInit(message);
			case 'stream_event':
				return this._translateStreamEvent(message.event);
			case 'assistant':
				return this._translateAssistantMessage(message.message);
			case 'user':
				return this._translateToolResults(message);
			case 'result':
				return this._translateResult(message);
			default:
				return [];
		}
	}

	/** Set once the session's result arrived. */
	get outcome(): TurnOutcome | undefined {
		return this._outcome;
	}

	get modelId(): string {
		return this._modelId;
	}

	/** Closes what an interrupted stream left open, so the message can be saved as it stands. */
	close(): UIMessageChunk[] {
		const chunks = [...this._openBlocks.values()].flatMap(endBlock);
		this._openBlocks.clear();
		return [...chunks, ...this._finishStep()];
	}

	private _readInit(message: Extract<SDKMessage, { type: 'system' }>): UIMessageChunk[] {
		if (message.subtype === 'init' && 'model' in message && typeof message.model === 'string') {
			this._modelId = message.model;
		}
		return [];
	}

	private _translateStreamEvent(event: StreamEvent): UIMessageChunk[] {
		switch (event.type) {
			case 'message_start':
				this._messageId = event.message.id;
				this._streamedMessageIds.add(event.message.id);
				return [...this._finishStep(), ...this._startStep()];
			case 'content_block_start':
				return this._startBlock(event.index, event.content_block);
			case 'content_block_delta':
				return this._translateDelta(event.index, event.delta);
			case 'content_block_stop':
				return this._stopBlock(event.index);
			default:
				return [];
		}
	}

	private _startBlock(index: number, block: ContentBlock): UIMessageChunk[] {
		const id = `${this._messageId}-${index}`;
		if (block.type === 'text') {
			this._openBlocks.set(index, { kind: 'text', id });
			return [{ type: 'text-start', id }];
		}
		if (block.type === 'thinking') {
			this._openBlocks.set(index, { kind: 'reasoning', id });
			return [{ type: 'reasoning-start', id }];
		}
		if (block.type === 'tool_use') {
			this._openBlocks.set(index, { kind: 'tool', id: block.id });
			this._startedToolCalls.add(block.id);
			return [{ type: 'tool-input-start', toolCallId: block.id, ...toolIdentity(block.name) }];
		}
		return [];
	}

	private _translateDelta(index: number, delta: Extract<StreamEvent, { type: 'content_block_delta' }>['delta']) {
		const block = this._openBlocks.get(index);
		if (!block) {
			return [];
		}
		if (delta.type === 'text_delta' && block.kind === 'text') {
			return [{ type: 'text-delta', id: block.id, delta: delta.text } satisfies UIMessageChunk];
		}
		if (delta.type === 'thinking_delta' && block.kind === 'reasoning') {
			return [{ type: 'reasoning-delta', id: block.id, delta: delta.thinking } satisfies UIMessageChunk];
		}
		if (delta.type === 'input_json_delta' && block.kind === 'tool') {
			return [
				{
					type: 'tool-input-delta',
					toolCallId: block.id,
					inputTextDelta: delta.partial_json,
				} satisfies UIMessageChunk,
			];
		}
		return [];
	}

	private _stopBlock(index: number): UIMessageChunk[] {
		const block = this._openBlocks.get(index);
		this._openBlocks.delete(index);
		return block ? endBlock(block) : [];
	}

	private _translateAssistantMessage(message: Extract<SDKMessage, { type: 'assistant' }>['message']) {
		const wasStreamed = this._streamedMessageIds.has(message.id);
		const chunks: UIMessageChunk[] = wasStreamed ? [] : this._startStep();
		for (const [index, block] of message.content.entries()) {
			if (block.type === 'tool_use') {
				chunks.push(...this._completeToolCall(block));
			} else if (block.type === 'text' && !wasStreamed) {
				const id = `${message.id}-${index}`;
				chunks.push(
					{ type: 'text-start', id },
					{ type: 'text-delta', id, delta: block.text },
					{ type: 'text-end', id },
				);
			}
		}
		return wasStreamed ? chunks : [...chunks, ...this._finishStep()];
	}

	private _completeToolCall(block: { id: string; name: string; input: unknown }): UIMessageChunk[] {
		const identity = toolIdentity(block.name);
		const start: UIMessageChunk[] = this._startedToolCalls.has(block.id)
			? []
			: [{ type: 'tool-input-start', toolCallId: block.id, ...identity }];
		this._startedToolCalls.add(block.id);
		return [...start, { type: 'tool-input-available', toolCallId: block.id, input: block.input, ...identity }];
	}

	private _translateToolResults(message: SDKUserMessage): UIMessageChunk[] {
		const content = message.message.content;
		if (typeof content === 'string') {
			return [];
		}
		const toolResults = content.filter((block) => block.type === 'tool_result');
		const naoOutput = toolResults.length === 1 ? readNaoOutput(message.tool_use_result) : undefined;
		return toolResults.map((block): UIMessageChunk => {
			const text = toolResultText(block.content);
			if (block.is_error) {
				return { type: 'tool-output-error', toolCallId: block.tool_use_id, errorText: text };
			}
			return {
				type: 'tool-output-available',
				toolCallId: block.tool_use_id,
				output: naoOutput ?? parseOutput(text),
			};
		});
	}

	private _translateResult(message: ResultMessage): UIMessageChunk[] {
		const errorMessage = resultErrorMessage(message);
		this._outcome = {
			modelId: this._modelId,
			usage: {
				inputTokens: message.usage.input_tokens,
				cacheReadInputTokens: message.usage.cache_read_input_tokens,
				cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
				outputTokens: message.usage.output_tokens,
			},
			estimatedCostUsd: message.total_cost_usd ?? 0,
			durationMs: message.duration_ms ?? 0,
			...(errorMessage && { errorMessage }),
		};
		const chunks = this.close();
		return errorMessage ? [...chunks, { type: 'error', errorText: errorMessage }] : chunks;
	}

	private _startStep(): UIMessageChunk[] {
		if (this._isStepOpen) {
			return [];
		}
		this._isStepOpen = true;
		return [{ type: 'start-step' }];
	}

	private _finishStep(): UIMessageChunk[] {
		if (!this._isStepOpen) {
			return [];
		}
		this._isStepOpen = false;
		return [{ type: 'finish-step' }];
	}
}

/** nao tools keep the names the chat renders; anything else Claude calls shows as a generic tool. */
function toolIdentity(claudeToolName: string): { toolName: string; dynamic?: true } {
	if (claudeToolName.startsWith(LOCAL_AGENT_TOOL_PREFIX)) {
		return { toolName: claudeToolName.slice(LOCAL_AGENT_TOOL_PREFIX.length) };
	}
	return { toolName: claudeToolName, dynamic: true };
}

function endBlock(block: OpenBlock): UIMessageChunk[] {
	if (block.kind === 'text') {
		return [{ type: 'text-end', id: block.id }];
	}
	if (block.kind === 'reasoning') {
		return [{ type: 'reasoning-end', id: block.id }];
	}
	return [];
}

function readNaoOutput(toolUseResult: unknown): unknown {
	if (typeof toolUseResult !== 'object' || toolUseResult === null || !('_meta' in toolUseResult)) {
		return undefined;
	}
	const meta = toolUseResult._meta;
	return typeof meta === 'object' && meta !== null
		? (meta as Record<string, unknown>)[LOCAL_AGENT_OUTPUT_META_KEY]
		: undefined;
}

function toolResultText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	return content
		.filter(
			(block): block is { type: 'text'; text: string } =>
				block?.type === 'text' && typeof block.text === 'string',
		)
		.map((block) => block.text)
		.join('\n');
}

function parseOutput(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function resultErrorMessage(message: ResultMessage): string | undefined {
	if (message.subtype === 'success') {
		return message.is_error ? message.result || 'Claude could not answer.' : undefined;
	}
	if (message.subtype === 'error_max_turns') {
		return 'Claude stopped after reaching the maximum number of steps.';
	}
	return message.errors.join('\n') || 'Claude stopped because of an error.';
}

import type { callSubagent } from '@nao/shared/tools';
import { type ModelMessage, stepCountIs, streamText } from 'ai';

import type { TokenUsage } from '../../types/chat';
import type { ToolContext } from '../../types/tools';
import { convertToTokenUsage } from '../../utils/ai';
import { cachedSystemInstructions } from '../../utils/prompt-cache';
import { scheduleSaveLlmInferenceRecord } from '../../utils/schedule-task';
import { truncateMiddle } from '../../utils/utils';
import { fitThinkingBudget } from '../providers';
import { llmTelemetry } from '../telemetry';
import type { SubagentModel } from './model';
import type { SubagentDefinition } from './types';

const SUBAGENT_MAX_OUTPUT_TOKENS = 8_000;
const STEP_SUMMARY_MAX_CHARS = 120;

export interface SubagentRunOptions {
	prompt: string;
	context: ToolContext;
	model: SubagentModel;
	abortSignal?: AbortSignal;
}

/**
 * Runs a subagent to completion, yielding a progress snapshot after every tool event.
 * The last value yielded is the final output carrying the subagent's report.
 */
export async function* runSubagent(
	definition: SubagentDefinition,
	{ prompt, context, model, abortSignal }: SubagentRunOptions,
): AsyncGenerator<callSubagent.Output> {
	const progress = new SubagentProgress(model.selection.modelId);
	const callSettings = model.config.callSettings ?? {};
	const maxOutputTokens = callSettings.maxOutputTokens ?? SUBAGENT_MAX_OUTPUT_TOKENS;

	const result = streamText({
		model: model.config.model,
		providerOptions: fitThinkingBudget(model.config.providerOptions, maxOutputTokens),
		messages: buildMessages(definition.systemPrompt(context), prompt, model),
		tools: definition.tools(context),
		stopWhen: stepCountIs(definition.maxSteps),
		maxOutputTokens,
		temperature: callSettings.temperature,
		topP: callSettings.topP,
		topK: callSettings.topK,
		abortSignal,
		experimental_context: context,
		experimental_telemetry: llmTelemetry(`nao-subagent-${definition.name}`, {
			sessionId: context.chatId,
			userId: context.userId,
			projectId: context.projectId,
			tags: [model.selection.provider],
			model: model.selection.modelId,
		}),
	});

	yield progress.snapshot();

	for await (const chunk of result.fullStream) {
		switch (chunk.type) {
			case 'tool-call':
				progress.startStep(chunk.toolCallId, chunk.toolName, chunk.input);
				yield progress.snapshot();
				break;
			case 'tool-result':
				progress.finishStep(chunk.toolCallId, 'done');
				yield progress.snapshot();
				break;
			case 'tool-error':
				progress.finishStep(chunk.toolCallId, 'error');
				yield progress.snapshot();
				break;
			case 'error':
				throw chunk.error;
		}
	}

	trackInference(context, model, convertToTokenUsage(await result.totalUsage));

	yield progress.complete((await result.text).trim() || noReportFallback(definition));
}

class SubagentProgress {
	private readonly _steps = new Map<string, callSubagent.Step>();
	private readonly _startedAt = Date.now();

	constructor(private readonly _modelId: string) {}

	startStep(toolCallId: string, tool: string, input: unknown): void {
		this._steps.set(toolCallId, { tool, summary: summarizeToolInput(input), status: 'running' });
	}

	finishStep(toolCallId: string, status: 'done' | 'error'): void {
		const step = this._steps.get(toolCallId);
		if (step) {
			step.status = status;
		}
	}

	snapshot(): callSubagent.Output {
		return this._output('running', '');
	}

	complete(report: string): callSubagent.Output {
		return { ...this._output('completed', report), durationMs: Date.now() - this._startedAt };
	}

	private _output(status: callSubagent.Output['status'], report: string): callSubagent.Output {
		return {
			_version: '1',
			status,
			model: this._modelId,
			startedAt: this._startedAt,
			steps: [...this._steps.values()].map((step) => ({ ...step })),
			report,
		};
	}
}

function buildMessages(systemPrompt: string, prompt: string, model: SubagentModel): ModelMessage[] {
	const instructions = cachedSystemInstructions(systemPrompt, model.selection);
	const systemMessage: ModelMessage =
		typeof instructions === 'string' ? { role: 'system', content: instructions } : instructions;
	return [systemMessage, { role: 'user', content: prompt }];
}

/** The string arguments of a tool call, which is what a reader needs to know what it did. */
function summarizeToolInput(input: unknown): string {
	if (!input || typeof input !== 'object') {
		return '';
	}
	const values = Object.values(input).filter((value): value is string => typeof value === 'string' && value !== '');
	return truncateMiddle(values.join(' · '), STEP_SUMMARY_MAX_CHARS);
}

function noReportFallback(definition: SubagentDefinition): string {
	return `The ${definition.name} subagent stopped after ${definition.maxSteps} steps without writing a report. Narrow the task and try again.`;
}

function trackInference(context: ToolContext, model: SubagentModel, usage: TokenUsage): void {
	scheduleSaveLlmInferenceRecord({
		type: 'subagent',
		projectId: context.projectId,
		userId: context.userId,
		chatId: context.chatId,
		llmProvider: model.selection.provider,
		llmModelId: model.selection.modelId,
		...usage,
	});
}

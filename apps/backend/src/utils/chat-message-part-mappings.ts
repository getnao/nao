/* eslint-disable @typescript-eslint/no-explicit-any */
import { getToolName, isToolUIPart } from 'ai';

import { DBMessagePart, NewMessagePart } from '../db/abstractSchema';
import { UIMessagePart, UIToolPart } from '../types/chat';
import { LlmProvider } from '../types/llm';

/**
 * Converts a list of UI message parts to a list of database message parts.
 */
export const mapUIPartsToDBParts = (parts: UIMessagePart[], messageId: string): NewMessagePart[] => {
	return parts
		.map((part, index) => convertUIPartToDBPart(part, messageId, index))
		.filter((part) => part !== undefined);
};

export const convertUIPartToDBPart = (
	part: UIMessagePart,
	messageId: string,
	order: number,
): NewMessagePart | undefined => {
	if (isToolUIPart(part)) {
		return {
			messageId,
			order,
			toolName: getToolName(part),
			type: part.type,
			toolCallId: part.toolCallId,
			toolState: part.state,
			toolInput: part.input,
			toolRawInput: (part as any).rawInput,
			toolOutput: part.output,
			toolErrorText: part.errorText,
			toolApprovalApproved: part.approval?.approved,
			toolApprovalReason: part.approval?.reason,
			toolApprovalId: part.approval?.id,
			toolProviderMetadata: part.callProviderMetadata,
		};
	}

	switch (part.type) {
		case 'text':
			return {
				messageId,
				order,
				type: 'text',
				text: part.text,
				providerMetadata: part.providerMetadata,
			};
		case 'reasoning':
			return {
				messageId,
				order,
				type: 'reasoning',
				reasoningText: part.text,
				providerMetadata: part.providerMetadata,
			};
		default:
	}
};

/**
 * Converts a list of database message parts to a list of UI message parts.
 */
export const mapDBPartsToUIParts = (parts: DBMessagePart[], provider?: LlmProvider): UIMessagePart[] => {
	return parts.map((part) => convertDBPartToUIPart(part, provider)).filter((part) => part !== undefined);
};

export const convertDBPartToUIPart = (part: DBMessagePart, provider?: LlmProvider): UIMessagePart | undefined => {
	if (isToolDBPart(part)) {
		return {
			type: part.type,
			toolName: part.toolName!,
			toolCallId: part.toolCallId!,
			state: part.toolState as any,
			input: part.toolInput as any,
			rawInput: part.toolRawInput as any,
			output: part.toolOutput as any,
			errorText: part.toolErrorText as any,
			providerExecuted: provider === 'anthropic',
			approval: part.toolApprovalId
				? {
						id: part.toolApprovalId!,
						approved: part.toolApprovalApproved!,
						reason: part.toolApprovalReason!,
					}
				: undefined,
			callProviderMetadata: part.toolProviderMetadata ?? undefined,
		};
	}

	switch (part.type) {
		case 'text':
			return {
				type: 'text',
				text: part.text!,
				providerMetadata: part.providerMetadata ?? undefined,
			};
		case 'reasoning':
			return {
				type: 'reasoning',
				text: part.reasoningText!,
				providerMetadata: part.providerMetadata ?? undefined,
			};
		default:
	}
};

const isToolDBPart = (part: DBMessagePart): part is DBMessagePart & { type: UIToolPart['type'] } => {
	return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
};

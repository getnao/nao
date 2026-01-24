/* eslint-disable @typescript-eslint/no-explicit-any */
import { getToolName, isToolUIPart } from 'ai';

import { DBMessagePart, NewMessagePart } from '../db/abstractSchema';
import { LlmProvider, TokenUsage, UIMessagePart, UIToolPart } from '../types/chat';

/**
 * Converts a list of UI message parts to a list of database message parts.
 */
export const mapUIPartsToDBParts = (
	parts: UIMessagePart[],
	messageId: string,
	tokenUsage?: TokenUsage,
): NewMessagePart[] => {
	return parts
		.map((part, index) => convertUIPartToDBPart(part, messageId, index, tokenUsage))
		.filter((part) => part !== undefined);
};

export const convertUIPartToDBPart = (
	part: UIMessagePart,
	messageId: string,
	order: number,
	tokenUsage?: TokenUsage,
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
			toolOutput: part.output,
			toolErrorText: part.errorText,
			toolApprovalApproved: part.approval?.approved,
			toolApprovalReason: part.approval?.reason,
			toolApprovalId: part.approval?.id,
		};
	}

	switch (part.type) {
		case 'text':
			return {
				messageId,
				order,
				type: 'text',
				text: part.text,
				...tokenUsage,
			};
		case 'reasoning':
			return {
				messageId,
				order,
				type: 'reasoning',
				reasoningText: part.text,
				...tokenUsage,
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
		};
	}

	switch (part.type) {
		case 'text':
			return {
				type: 'text',
				text: part.text!,
			};
		case 'reasoning':
			return {
				type: 'reasoning',
				text: part.reasoningText!,
			};
		default:
	}
};

const isToolDBPart = (part: DBMessagePart): part is DBMessagePart & { type: UIToolPart['type'] } => {
	return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
};

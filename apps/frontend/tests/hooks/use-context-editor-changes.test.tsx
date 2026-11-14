// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';

import { useContextEditorChanges } from '@/hooks/use-context-editor-changes';

const mocks = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock('@/contexts/agent.provider', () => ({ useAgentMessages: () => mocks.messages }));

describe('useContextEditorChanges', () => {
	afterEach(cleanup);

	it('reports each file the agent changed once, when its tool call settles', () => {
		const onChange = vi.fn();
		mocks.messages = [assistantMessage([toolPart('call-1', 'edit_context_file', 'input-available')])];
		const { rerender } = renderHook(() => useContextEditorChanges(onChange));

		expect(onChange).not.toHaveBeenCalled();

		mocks.messages = [
			assistantMessage([
				toolPart('call-1', 'edit_context_file', 'output-available', '/docs/orders.md'),
				toolPart('call-2', 'read_context_file', 'output-available', '/docs/orders.md'),
			]),
		];
		rerender();
		expect(onChange).toHaveBeenLastCalledWith({ paths: ['/docs/orders.md'], hasChangedRecommendations: false });

		mocks.messages = [
			...mocks.messages,
			assistantMessage([toolPart('call-3', 'create_context_file', 'output-available', '/agent/skills/churn.md')]),
		];
		rerender();
		expect(onChange).toHaveBeenLastCalledWith({
			paths: ['/agent/skills/churn.md'],
			hasChangedRecommendations: false,
		});
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			toolName: 'apply_recommendation',
			output: { changedPaths: ['/RULES.md', '/docs/refunds.md'], unchangedPaths: [], conflicts: [] },
			paths: ['/RULES.md', '/docs/refunds.md'],
		},
		{
			toolName: 'set_recommendation_status',
			output: { recommendationId: 'rec-1', status: 'dismissed' },
			paths: [],
		},
	])('reports the recommendations $toolName changed', ({ toolName, output, paths }) => {
		const onChange = vi.fn();
		mocks.messages = [
			assistantMessage([{ type: `tool-${toolName}`, toolCallId: 'call-1', state: 'output-available', output }]),
		];

		renderHook(() => useContextEditorChanges(onChange));

		expect(onChange).toHaveBeenCalledWith({ paths, hasChangedRecommendations: true });
	});
});

function assistantMessage(parts: unknown[]): UIMessage {
	return { id: `message-${parts.length}`, role: 'assistant', parts } as UIMessage;
}

function toolPart(toolCallId: string, toolName: string, state: string, path?: string) {
	return { type: `tool-${toolName}`, toolCallId, state, input: {}, output: path ? { path } : undefined };
}

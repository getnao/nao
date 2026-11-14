// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';

import { useContextEditorFileChanges } from '@/hooks/use-context-editor-file-changes';

const mocks = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock('@/contexts/agent.provider', () => ({ useAgentMessages: () => mocks.messages }));

describe('useContextEditorFileChanges', () => {
	afterEach(cleanup);

	it('reports each file the agent changed once, when its tool call settles', () => {
		const onChange = vi.fn();
		mocks.messages = [assistantMessage([toolPart('call-1', 'edit_context_file', 'input-available')])];
		const { rerender } = renderHook(() => useContextEditorFileChanges(onChange));

		expect(onChange).not.toHaveBeenCalled();

		mocks.messages = [
			assistantMessage([
				toolPart('call-1', 'edit_context_file', 'output-available', '/docs/orders.md'),
				toolPart('call-2', 'read_context_file', 'output-available', '/docs/orders.md'),
			]),
		];
		rerender();
		expect(onChange).toHaveBeenLastCalledWith(['/docs/orders.md']);

		mocks.messages = [
			...mocks.messages,
			assistantMessage([toolPart('call-3', 'create_context_file', 'output-available', '/agent/skills/churn.md')]),
		];
		rerender();
		expect(onChange).toHaveBeenLastCalledWith(['/agent/skills/churn.md']);
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});

function assistantMessage(parts: unknown[]): UIMessage {
	return { id: `message-${parts.length}`, role: 'assistant', parts } as UIMessage;
}

function toolPart(toolCallId: string, toolName: string, state: string, path?: string) {
	return { type: `tool-${toolName}`, toolCallId, state, input: {}, output: path ? { path } : undefined };
}

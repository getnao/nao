// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpandOnToolCallReveal } from '@/hooks/use-tool-call-reveal';
import { revealToolCall } from '@/lib/tool-call-reveal';

function CollapsedGroup({ toolCallIds }: { toolCallIds: string[] }) {
	const [isExpanded, setIsExpanded] = useState(false);
	useExpandOnToolCallReveal(toolCallIds, setIsExpanded);

	if (!isExpanded) {
		return null;
	}
	return (
		<>
			{toolCallIds.map((toolCallId) => (
				<div key={toolCallId} data-replay-target-id={toolCallId} />
			))}
		</>
	);
}

function findToolCall(container: HTMLElement, toolCallId: string): HTMLElement | null {
	return container.querySelector<HTMLElement>(`[data-replay-target-id="${toolCallId}"]`);
}

describe('revealToolCall', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('CSS', { escape: (value: string) => value });
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('expands the collapsed group holding the tool call, then scrolls to and outlines it', async () => {
		const { container } = render(
			<>
				<CollapsedGroup toolCallIds={['call_other']} />
				<CollapsedGroup toolCallIds={['call_query']} />
			</>,
		);

		act(() => revealToolCall('call_query'));
		await act(() => vi.runAllTimersAsync());

		const toolCall = findToolCall(container, 'call_query');
		expect(toolCall?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
		expect(toolCall?.classList.contains('chat-artifact-reveal-highlight')).toBe(true);
		expect(findToolCall(container, 'call_other')).toBeNull();
	});

	it('does not expand a group mounted after the reveal is done', async () => {
		const { container, rerender } = render(<CollapsedGroup toolCallIds={['call_query']} />);

		act(() => revealToolCall('call_query'));
		await act(() => vi.runAllTimersAsync());
		rerender(
			<>
				<CollapsedGroup toolCallIds={['call_query']} />
				<CollapsedGroup key='late' toolCallIds={['call_late', 'call_query']} />
			</>,
		);

		expect(findToolCall(container, 'call_late')).toBeNull();
	});
});

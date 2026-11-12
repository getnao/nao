import { useSyncExternalStore } from 'react';
import { ValueStore } from './value-store';

export interface ToolCallRevealRequest {
	id: number;
	toolCallId: string;
}

const toolCallRevealStore = new ValueStore<ToolCallRevealRequest | null>(null);
let nextRequestId = 0;

/** Asks the tool groups holding the tool call, and the tool call itself, to expand so it can be shown. */
export function requestToolCallReveal(toolCallId: string): number {
	nextRequestId += 1;
	toolCallRevealStore.set({ id: nextRequestId, toolCallId });
	return nextRequestId;
}

/** A shown request is done, so a group mounted later does not expand again. */
export function completeToolCallReveal(id: number): void {
	if (toolCallRevealStore.getSnapshot()?.id === id) {
		toolCallRevealStore.set(null);
	}
}

export const useToolCallRevealRequest = () =>
	useSyncExternalStore(toolCallRevealStore.subscribe, toolCallRevealStore.getSnapshot);

import { useMemo, useRef } from 'react';
import { filterSupersededExecuteSqlParts } from '@nao/shared/execute-sql-parts';
import type { UIMessage } from '@nao/backend/chat';
import { areArraysShallowEqual } from '@/lib/utils';

/**
 * Messages shown in the conversation: forked messages and superseded SQL parts are hidden.
 * Filtering clones the affected messages on every pass, so the previous object is reused when
 * nothing changed to keep memoized message blocks from re-rendering on every streamed chunk.
 */
export const useVisibleMessages = (messages: UIMessage[]): UIMessage[] => {
	const previousMessagesByIdRef = useRef(new Map<string, UIMessage>());

	return useMemo(() => {
		const previousMessagesById = previousMessagesByIdRef.current;
		const visibleMessages = filterSupersededExecuteSqlParts(messages.filter((m) => !m.isForked)).map((message) => {
			const previous = previousMessagesById.get(message.id);
			return previous && areMessagesShallowEqual(previous, message) ? previous : message;
		});
		previousMessagesByIdRef.current = new Map(visibleMessages.map((message) => [message.id, message]));
		return visibleMessages;
	}, [messages]);
};

function areMessagesShallowEqual(previous: UIMessage, next: UIMessage): boolean {
	if (previous === next) {
		return true;
	}
	const previousKeys = Object.keys(previous) as (keyof UIMessage)[];
	if (previousKeys.length !== Object.keys(next).length) {
		return false;
	}
	return previousKeys.every((key) =>
		key === 'parts' ? areArraysShallowEqual(previous.parts, next.parts) : previous[key] === next[key],
	);
}

import { useMemo, useRef } from 'react';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage } from '@nao/backend/chat';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';

const EMPTY_MESSAGES: UIMessage[] = [];

export type SourceQuery = { input?: executeSql.Input; output: executeSql.Output };

/**
 * Finds the `execute_sql` tool call a visualization references. The hit is cached in a ref —
 * tool outputs are immutable once emitted — so streaming re-renders skip the message scan
 * and keep a stable object identity.
 */
export function useSourceQuery(queryId: string | undefined): {
	sourceQuery: SourceQuery | null;
	sourceData: executeSql.Output | null;
} {
	const agent = useOptionalAgentContext();
	const messages = agent?.messages ?? EMPTY_MESSAGES;
	const foundRef = useRef<{ queryId: string; result: SourceQuery } | null>(null);

	const sourceQuery = useMemo<SourceQuery | null>(() => {
		if (!queryId) {
			return null;
		}
		if (foundRef.current?.queryId === queryId) {
			return foundRef.current.result;
		}
		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output && part.output.id === queryId) {
					const result = { input: part.input, output: part.output };
					foundRef.current = { queryId, result };
					return result;
				}
			}
		}
		if (!queryId) {
			return null;
		}
		return findLatestExecuteSqlInMessages(messages, queryId);
	}, [messages, queryId]);

	return { sourceQuery, sourceData: sourceQuery?.output ?? null };
}

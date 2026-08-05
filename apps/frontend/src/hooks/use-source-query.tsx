import { useMemo, useRef } from 'react';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage } from '@nao/backend/chat';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';

const EMPTY_MESSAGES: UIMessage[] = [];

export type SourceQuery = { input?: executeSql.Input; output: executeSql.Output };

/**
 * Finds the `execute_sql` tool call a visualization references. The previous hit is reused for as
 * long as the part behind it is untouched, so streaming re-renders keep a stable object identity,
 * while a query re-run in place under the same id still replaces it.
 */
export function useSourceQuery(queryId: string | undefined): {
	sourceQuery: SourceQuery | null;
	sourceData: executeSql.Output | null;
} {
	const agent = useOptionalAgentContext();
	const messages = agent?.messages ?? EMPTY_MESSAGES;
	const foundRef = useRef<SourceQuery | null>(null);

	const sourceQuery = useMemo<SourceQuery | null>(() => {
		if (!queryId) {
			return null;
		}
		const found = findLatestExecuteSqlInMessages(messages, queryId);
		if (!found) {
			return null;
		}
		const cached = foundRef.current;
		if (cached && cached.input === found.input && cached.output === found.output) {
			return cached;
		}
		foundRef.current = found;
		return found;
	}, [messages, queryId]);

	return { sourceQuery, sourceData: sourceQuery?.output ?? null };
}

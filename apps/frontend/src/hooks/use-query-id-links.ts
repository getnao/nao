import { useEffect } from 'react';
import type { MountedCodeEditor } from '@/components/code-selection-ask';
import type { EditorLink } from '@/lib/editor-links';
import { useAgentMessagesGetter } from '@/contexts/agent.provider';
import { findQueryToolCallId } from '@/lib/chat-artifacts';
import { bindEditorLinks, rangeAtColumn } from '@/lib/editor-links';
import { revealToolCall } from '@/lib/tool-call-reveal';

const QUERY_ID_PATTERN = /query_[\w-]+/g;

/** Makes the query ids of an editor Cmd/Ctrl+clickable, revealing the query that produced them in the conversation. */
export function useQueryIdLinks(codeEditor: MountedCodeEditor | null) {
	const getMessages = useAgentMessagesGetter();

	useEffect(() => {
		if (!codeEditor) {
			return;
		}
		const findToolCallId = (queryId: string) => findQueryToolCallId(getMessages(), queryId);
		return bindEditorLinks(codeEditor, (line, lineNumber, column) =>
			findQueryLinkAt(line, lineNumber, column, findToolCallId),
		);
	}, [codeEditor, getMessages]);
}

function findQueryLinkAt(
	line: string,
	lineNumber: number,
	column: number,
	findToolCallId: (queryId: string) => string | undefined,
): EditorLink | null {
	for (const match of line.matchAll(QUERY_ID_PATTERN)) {
		const range = rangeAtColumn(lineNumber, match.index + 1, match[0].length, column);
		if (!range) {
			continue;
		}
		const toolCallId = findToolCallId(match[0]);
		return toolCallId ? { range, follow: () => revealToolCall(toolCallId) } : null;
	}
	return null;
}

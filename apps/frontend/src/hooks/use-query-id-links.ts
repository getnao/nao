import { useEffect } from 'react';
import type { editor, IRange } from 'monaco-editor';
import type { MountedCodeEditor } from '@/components/code-selection-ask';
import { useAgentMessagesGetter } from '@/contexts/agent.provider';
import { findQueryToolCallId } from '@/lib/chat-artifacts';
import { revealToolCall } from '@/lib/tool-call-reveal';

const QUERY_ID_PATTERN = /query_[\w-]+/g;
const LINK_CLASS_NAME = 'code-query-link';

interface QueryLink {
	range: IRange;
	toolCallId: string;
}

/** Makes the query ids of an editor Cmd/Ctrl+clickable, revealing the query that produced them in the conversation. */
export function useQueryIdLinks(codeEditor: MountedCodeEditor | null) {
	const getMessages = useAgentMessagesGetter();

	useEffect(() => {
		if (!codeEditor) {
			return;
		}
		const findToolCallId = (queryId: string) => findQueryToolCallId(getMessages(), queryId);
		return bindQueryIdLinks(codeEditor, findToolCallId);
	}, [codeEditor, getMessages]);
}

function bindQueryIdLinks(
	{ editor: instance, monaco }: MountedCodeEditor,
	findToolCallId: (queryId: string) => string | undefined,
): () => void {
	const linkDecoration = instance.createDecorationsCollection();
	const findLink = (event: editor.IEditorMouseEvent): QueryLink | null => {
		const isFollowGesture = event.event.metaKey || event.event.ctrlKey;
		const isOverText = event.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT;
		return isFollowGesture && isOverText ? findQueryLinkAt(instance, event.target.position, findToolCallId) : null;
	};
	const clearLink = () => {
		linkDecoration.clear();
	};

	const subscriptions = [
		instance.onMouseMove((event) => {
			const link = findLink(event);
			linkDecoration.set(link ? [{ range: link.range, options: { inlineClassName: LINK_CLASS_NAME } }] : []);
		}),
		instance.onMouseDown((event) => {
			const link = findLink(event);
			if (link) {
				event.event.preventDefault();
				revealToolCall(link.toolCallId);
			}
		}),
		instance.onMouseLeave(clearLink),
		instance.onKeyUp(clearLink),
	];

	return () => {
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		clearLink();
	};
}

function findQueryLinkAt(
	instance: editor.IStandaloneCodeEditor,
	position: { lineNumber: number; column: number } | null,
	findToolCallId: (queryId: string) => string | undefined,
): QueryLink | null {
	const model = instance.getModel();
	if (!model || !position) {
		return null;
	}
	for (const match of model.getLineContent(position.lineNumber).matchAll(QUERY_ID_PATTERN)) {
		const startColumn = match.index + 1;
		const endColumn = startColumn + match[0].length;
		if (position.column < startColumn || position.column > endColumn) {
			continue;
		}
		const toolCallId = findToolCallId(match[0]);
		if (!toolCallId) {
			return null;
		}
		const { lineNumber } = position;
		return {
			range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn, endColumn },
			toolCallId,
		};
	}
	return null;
}

import { useCallback } from 'react';
import { LibraryChatPreview } from './library-chat-preview';
import { LibraryFilePreview } from './library-file-preview';
import { LibraryStoryPreview } from './library-story-preview';
import type { UIMessage } from '@nao/backend/chat';
import type { executeSql } from '@nao/shared/tools';
import type { LibraryItem, MockQuery } from '@/lib/library';
import { AttachmentViewer } from '@/components/side-panel/attachment-viewer';
import { SqlQueryEditor } from '@/components/side-panel/sql-editor';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';

export function LibraryItemViewer({ chatId, item }: { chatId: string; item: LibraryItem }) {
	const { content } = item;
	switch (content.kind) {
		case 'chat-story':
			return <StoryViewer chatId={chatId} storySlug={content.storySlug} />;
		case 'chat-query':
			return <ChatQueryViewer toolCallId={content.toolCallId} />;
		case 'chat-file':
			return <AttachmentViewer path={content.path} fileName={content.filename} />;
		case 'mock-story':
			return <LibraryStoryPreview item={item} story={content.story} />;
		case 'mock-query':
			return <MockQueryViewer name={item.name} query={content.query} />;
		case 'mock-file':
			return <LibraryFilePreview item={item} preview={content.preview} />;
		case 'mock-chat':
			return <LibraryChatPreview item={item} messages={content.messages} />;
	}
}

function ChatQueryViewer({ toolCallId }: { toolCallId: string }) {
	const selectQuery = useCallback((messages: UIMessage[]) => findExecuteSqlCall(messages, toolCallId), [toolCallId]);
	const query = useAgentMessagesSelector(selectQuery);

	if (!query) {
		return (
			<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
				This query is no longer available.
			</div>
		);
	}
	return <SqlQueryEditor input={query.input} output={query.output} toolCallId={toolCallId} editable />;
}

function MockQueryViewer({ name, query }: { name: string; query: MockQuery }) {
	return (
		<SqlQueryEditor
			input={{ sql_query: query.sql, name }}
			output={{
				id: query.id,
				dialect: query.dialect,
				columns: query.columns,
				data: query.rows,
				row_count: query.rows.length,
			}}
			editable
		/>
	);
}

function findExecuteSqlCall(
	messages: UIMessage[],
	toolCallId: string,
): { input: executeSql.Input; output: executeSql.Output } | undefined {
	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type === 'tool-execute_sql' && part.toolCallId === toolCallId && part.input && part.output) {
				return { input: part.input, output: part.output };
			}
		}
	}
	return undefined;
}

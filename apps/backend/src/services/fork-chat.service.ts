import { MAX_OUTPUT_TOKENS } from '../agents/compaction';
import * as chatQueries from '../queries/chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import type { ForkMetadata, UIMessage, UIMessagePart } from '../types/chat';
import { compactionService } from './compaction';
import { tokenCounter } from './token-counter';

export async function forkChat(opts: {
	chatId: string;
	projectId: string;
	userId: string;
	forkMetadata?: ForkMetadata;
}): Promise<{ chatId: string }> {
	const rawMessages = await chatQueries.loadChatMessages(opts.chatId);
	const messages = compactionService.useLastCompaction(rawMessages);
	const seededMessages = await buildForkContext(messages, opts.projectId);

	const savedChat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.forkMetadata?.title,
			forkMetadata: opts.forkMetadata,
		},
		seededMessages,
	);

	return { chatId: savedChat.id };
}

export async function forkStory(opts: {
	sourceChatId: string;
	projectId: string;
	userId: string;
	storyId: string;
	title: string;
	code: string;
	authorName: string;
}): Promise<{ chatId: string }> {
	const queryData = await sharedStoryQueries.collectQueryData(opts.sourceChatId, opts.code);
	const seededMessages = buildQueryDataMessages(queryData);

	const chat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.title,
			forkMetadata: { type: 'story', id: opts.storyId, title: opts.title, authorName: opts.authorName },
		},
		seededMessages,
	);

	const version = await storyQueries.createVersion({
		chatId: chat.id,
		storyId: opts.storyId,
		title: opts.title,
		code: opts.code,
		action: 'create',
		source: 'assistant',
	});

	await chatQueries.upsertMessage({
		chatId: chat.id,
		role: 'assistant',
		parts: [
			{
				type: 'tool-story',
				toolCallId: crypto.randomUUID(),
				toolName: 'story',
				state: 'output-available',
				input: { action: 'create', id: opts.storyId, title: opts.title, code: opts.code },
				output: {
					_version: '1',
					success: true,
					id: opts.storyId,
					version: version.version,
					code: opts.code,
					title: opts.title,
				},
				errorText: undefined,
				providerExecuted: false,
			} as UIMessagePart,
		],
	});

	return { chatId: chat.id };
}

function buildQueryDataMessages(
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null,
): Array<Omit<UIMessage, 'id'>> {
	if (!queryData || Object.keys(queryData).length === 0) {
		return [];
	}

	const parts: UIMessagePart[] = Object.entries(queryData).map(
		([queryId, { data, columns }]) =>
			({
				type: 'tool-execute_sql',
				toolName: 'execute_sql',
				toolCallId: crypto.randomUUID(),
				state: 'output-available',
				input: { sql_query: '' },
				output: { id: queryId as `query_${string}`, data, columns, row_count: data.length },
				providerExecuted: false,
				errorText: undefined,
			}) as unknown as UIMessagePart,
	);

	return [{ role: 'assistant', synthetic: true, parts }];
}

async function buildForkContext(
	messages: Array<Omit<UIMessage, 'id'>>,
	projectId: string,
): Promise<Array<Omit<UIMessage, 'id'>>> {
	const totalTokens = tokenCounter.estimate(JSON.stringify(messages));
	if (totalTokens <= MAX_OUTPUT_TOKENS) {
		return messages;
	}

	return compressToFitBudget(messages, projectId);
}

async function compressToFitBudget(
	messages: Array<Omit<UIMessage, 'id'>>,
	projectId: string,
): Promise<Array<Omit<UIMessage, 'id'>>> {
	const [recentMessages, olderMessages] = partitionByTokenBudget(messages, MAX_OUTPUT_TOKENS / 2);

	const summary = await compactionService.summarize(olderMessages, projectId);
	if (!summary) {
		return recentMessages;
	}

	const summaryMessage: Omit<UIMessage, 'id'> = {
		role: 'assistant',
		parts: [{ type: 'text', text: summary }],
	};
	return [summaryMessage, ...recentMessages];
}

function partitionByTokenBudget(
	messages: Array<Omit<UIMessage, 'id'>>,
	recentBudget: number,
): [recent: Array<Omit<UIMessage, 'id'>>, older: Array<Omit<UIMessage, 'id'>>] {
	const recent: Array<Omit<UIMessage, 'id'>> = [];
	let tokenCount = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msgTokens = tokenCounter.estimate(JSON.stringify(messages[i]));
		if (tokenCount + msgTokens > recentBudget) {
			break;
		}
		recent.unshift(messages[i]);
		tokenCount += msgTokens;
	}

	const olderCount = messages.length - recent.length;
	return [recent, messages.slice(0, olderCount)];
}

import { sanitizeConditionalFormats } from '@nao/shared/conditional-formatting';
import { buildStoryTableBlock } from '@nao/shared';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus, Pencil } from 'lucide-react';
import { DataTableCard } from '../data-table-card';
import { Button } from '../ui/button';
import { ToolCallWrapper } from './tool-call-wrapper';
import { TableFormatEditDialog } from './display-table-edit-dialog';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { displayChart, executeSql } from '@nao/shared/tools';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useChatId } from '@/hooks/use-chat-id';
import { useSidePanel } from '@/contexts/side-panel';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { findStoryIds } from '@/lib/story.utils';
import { trpc } from '@/main';

const EMPTY_MESSAGES: UIMessage[] = [];

interface DisplayChartTableProps {
	config?: displayChart.TableInput;
	outputError?: string;
	toolCallId: string;
}

export function DisplayChartTable({ config, outputError, toolCallId }: DisplayChartTableProps) {
	const agent = useOptionalAgentContext();
	const messages = agent?.messages ?? EMPTY_MESSAGES;
	const chatId = useChatId();
	const queryClient = useQueryClient();
	const { open: openSidePanel, currentStorySlug, isVisible } = useSidePanel();
	const [isEditOpen, setIsEditOpen] = useState(false);

	const storyIds = useMemo(() => findStoryIds(messages), [messages]);
	const isEditable = Boolean(agent && !agent.isReadonly && !agent.isRunning);
	const isPersistingRef = useRef(false);

	const sourceData = useMemo<executeSql.Output | null>(() => {
		if (!config?.query_id) {
			return null;
		}
		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output && part.output.id === config.query_id) {
					return part.output;
				}
			}
		}
		return null;
	}, [messages, config?.query_id]);

	const updateMutation = useMutation(
		trpc.chart.updateConfig.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: [['chat', 'get']] }),
		}),
	);

	const addToStoryMutation = useMutation(
		trpc.story.createVersion.mutationOptions({
			onSuccess: (_data, variables) => {
				queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({
						chatId: variables.chatId,
						storySlug: variables.storySlug,
					}),
				});
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const persistFormats = async (nextFormats: ColumnConditionalFormats) => {
		if (!config || isPersistingRef.current) {
			return;
		}
		isPersistingRef.current = true;
		const previousMessages = messages;
		const nextConfig: displayChart.TableInput = { ...config, conditional_formats: nextFormats };
		agent?.setMessages(applyTableConfigToMessages(previousMessages, toolCallId, nextConfig));
		try {
			await updateMutation.mutateAsync({ toolCallId, config: nextConfig });
		} catch (err) {
			agent?.setMessages(previousMessages);
			throw err;
		} finally {
			isPersistingRef.current = false;
		}
	};

	if (outputError) {
		return (
			<ToolCallWrapper defaultExpanded title='Could not display the table'>
				<div className='p-4 text-red-400 text-sm'>{outputError}</div>
			</ToolCallWrapper>
		);
	}

	if (!config) {
		return <div className='my-2 text-foreground/50 text-sm'>Loading table...</div>;
	}

	if (!sourceData?.data || sourceData.data.length === 0) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the table because the data is missing.
			</div>
		);
	}

	const columns = sourceData.columns ?? [];
	const rows = sourceData.data as Record<string, unknown>[];
	const conditionalFormats = sanitizeConditionalFormats(config.conditional_formats) ?? {};

	const handleAddToStory = async () => {
		const latestStoryId = storyIds[storyIds.length - 1];
		const targetId =
			isVisible && currentStorySlug && storyIds.includes(currentStorySlug) ? currentStorySlug : latestStoryId;
		if (!targetId || !chatId) {
			return;
		}

		const data = await queryClient.fetchQuery({
			...trpc.story.listVersions.queryOptions({ chatId, storySlug: targetId }),
			staleTime: 0,
		});
		const latest = data.versions.at(-1);
		if (!latest) {
			return;
		}

		const tableBlock = buildStoryTableBlock(config);
		const newCode = latest.code.trimEnd() + '\n\n' + tableBlock;

		await addToStoryMutation.mutateAsync({
			chatId,
			storySlug: targetId,
			title: data.title,
			code: newCode,
			action: 'update',
		});

		if (!isVisible) {
			openSidePanel(<StoryViewer chatId={chatId} storySlug={targetId} />, targetId);
		}
	};

	const headerActions = isEditable ? (
		<>
			{storyIds.length > 0 && (
				<Button
					variant='ghost-muted'
					size='icon-xs'
					className='hover:rounded-full hover:bg-accent/70'
					onClick={handleAddToStory}
					disabled={addToStoryMutation.isPending}
					title='Add to story'
				>
					<FilePlus className='size-3 text-muted-foreground/70' />
				</Button>
			)}
			<Button
				variant='ghost-muted'
				size='icon-xs'
				className='hover:rounded-full hover:bg-accent/70'
				onClick={() => setIsEditOpen(true)}
				title='Edit formatting'
			>
				<Pencil className='size-3 text-muted-foreground/70' />
			</Button>
		</>
	) : null;

	return (
		<div className='my-2'>
			<DataTableCard
				data={sourceData.data as Record<string, unknown>[]}
				columns={columns}
				title={config.title}
				chatId={chatId ?? undefined}
				conditionalFormats={conditionalFormats}
				headerActions={headerActions}
				className='-mx-3'
			/>

			{isEditable && (
				<TableFormatEditDialog
					open={isEditOpen}
					onOpenChange={setIsEditOpen}
					columns={columns}
					data={rows}
					formats={conditionalFormats}
					onSave={persistFormats}
					isSaving={updateMutation.isPending}
					description='Apply conditional formatting to columns. Changes are saved to the chat.'
				/>
			)}
		</div>
	);
}

function applyTableConfigToMessages(
	messages: UIMessage[],
	toolCallId: string,
	config: displayChart.TableInput,
): UIMessage[] {
	return messages.map((message) => {
		let changed = false;
		const parts = message.parts.map((part) => {
			if (part.type !== 'tool-display_chart') {
				return part;
			}
			const toolPart = part as UIToolPart<'display_chart'>;
			if (toolPart.toolCallId !== toolCallId) {
				return part;
			}
			changed = true;
			return { ...toolPart, input: config } as typeof part;
		});
		return changed ? { ...message, parts } : message;
	});
}

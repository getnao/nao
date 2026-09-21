import { sanitizeConditionalFormats } from '@nao/shared/conditional-formatting';
import { buildStoryTableBlock } from '@nao/shared';
import { appendBlockToStoryCode } from '@nao/shared/story-tabs';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus, Pencil } from 'lucide-react';
import { DataTableCard } from '../data-table-card';
import { Button } from '../ui/button';
import { ToolCallWrapper } from './tool-call-wrapper';
import { TableFormatEditDialog } from './display-table-edit-dialog';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { displayChart } from '@nao/shared/tools';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { useAgentMessagesGetter, useOptionalAgentContext } from '@/contexts/agent.provider';
import { useChatId } from '@/hooks/use-chat-id';
import { useSidePanel } from '@/contexts/side-panel';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useStoryIds } from '@/hooks/use-story-ids';
import { useSourceQuery } from '@/hooks/use-source-query';
import { trpc } from '@/main';

const EMPTY_COLUMNS: string[] = [];
const EMPTY_ROWS: Record<string, unknown>[] = [];

interface DisplayChartTableProps {
	config?: displayChart.TableInput;
	outputError?: string;
	toolCallId: string;
}

export function DisplayChartTable({ config, outputError, toolCallId }: DisplayChartTableProps) {
	const agent = useOptionalAgentContext();
	const getMessages = useAgentMessagesGetter();
	const chatId = useChatId();
	const queryClient = useQueryClient();
	const { open: openSidePanel, currentStorySlug, currentStoryTabIndex, isVisible } = useSidePanel();
	const [isEditOpen, setIsEditOpen] = useState(false);

	const storyIds = useStoryIds();
	const isEditable = Boolean(agent && !agent.isReadonly && !agent.isRunning);
	const isPersistingRef = useRef(false);
	const { sourceData } = useSourceQuery(config?.query_id);

	const { mutateAsync: updateChart, isPending: isUpdatingChart } = useMutation(
		trpc.chart.updateConfig.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: [['chat', 'get']] }),
		}),
	);

	const { mutateAsync: addToStory, isPending: isAddingToStory } = useMutation(
		trpc.story.createVersion.mutationOptions({
			onSuccess: (_data, variables) => {
				queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({
						chatId: variables.chatId,
						storySlug: variables.storySlug,
					}),
				});
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({
						chatId: variables.chatId,
						storySlug: variables.storySlug,
					}),
				});
			},
		}),
	);
	const columns = sourceData?.columns ?? EMPTY_COLUMNS;
	const rows = (sourceData?.data as Record<string, unknown>[] | undefined) ?? EMPTY_ROWS;
	const conditionalFormats = useMemo(
		() => sanitizeConditionalFormats(config?.conditional_formats) ?? {},
		[config?.conditional_formats],
	);

	const handleAddToStory = useCallback(async () => {
		const latestStoryId = storyIds[storyIds.length - 1];
		const usingVisibleStory = Boolean(isVisible && currentStorySlug && storyIds.includes(currentStorySlug));
		const targetId = usingVisibleStory ? currentStorySlug! : latestStoryId;
		if (!targetId || !chatId || !config) {
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
		const { code: newCode, tabIndex: openTabIndex } = appendBlockToStoryCode(latest.code, tableBlock, {
			usingVisibleStory,
			activeTabIndex: currentStoryTabIndex,
		});

		await addToStory({
			chatId,
			storySlug: targetId,
			title: data.title,
			code: newCode,
			action: 'update',
		});

		if (!usingVisibleStory) {
			openSidePanel(
				<StoryViewer chatId={chatId} storySlug={targetId} initialTabIndex={openTabIndex} />,
				targetId,
			);
		}
	}, [
		storyIds,
		isVisible,
		currentStorySlug,
		chatId,
		config,
		queryClient,
		currentStoryTabIndex,
		addToStory,
		openSidePanel,
	]);
	const headerActions = useMemo(
		() =>
			isEditable ? (
				<>
					{storyIds.length > 0 && (
						<Button
							variant='ghost-muted'
							size='icon-xs'
							className='hover:rounded-full hover:bg-accent/70'
							onClick={handleAddToStory}
							disabled={isAddingToStory}
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
			) : null,
		[isEditable, storyIds.length, handleAddToStory, isAddingToStory],
	);

	const persistFormats = async (nextFormats: ColumnConditionalFormats) => {
		if (!config || isPersistingRef.current) {
			return;
		}
		isPersistingRef.current = true;
		const previousMessages = getMessages();
		const nextConfig: displayChart.TableInput = { ...config, conditional_formats: nextFormats };
		agent?.setMessages(applyTableConfigToMessages(previousMessages, toolCallId, nextConfig));
		try {
			await updateChart({ toolCallId, config: nextConfig });
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

	return (
		<div className='my-2'>
			<DataTableCard
				data={rows}
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
					isSaving={isUpdatingChart}
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

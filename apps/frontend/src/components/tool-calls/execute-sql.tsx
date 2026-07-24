import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Code, Copy, Download, Palette, Pencil, Table as TableIcon } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import { TableFormatEditDialog } from './display-table-edit-dialog';
import { SqlQueryDisplay } from './sql-query-display';
import { SqlResultDisplay } from './sql-result-display';
import type { ActionButton } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { DataExportFormat } from '@/components/export-data-menu';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { useToolCallContext } from '@/contexts/tool-call';
import { SidePanelContent } from '@/components/side-panel/sql-editor';
import { trpc } from '@/main';

type ViewMode = 'results' | 'query';

export const ExecuteSqlToolCall = ({
	toolPart: { output, input, state, toolCallId },
}: ToolCallComponentProps<'execute_sql'>) => {
	const [viewMode, setViewMode] = useState<ViewMode>('results');
	const [conditionalFormats, setConditionalFormats] = useState<ColumnConditionalFormats>({});
	const [isFormatOpen, setIsFormatOpen] = useState(false);
	const { isSettled } = useToolCallContext();
	const { open: openSidePanel } = useSidePanel();
	const agent = useOptionalAgentContext();
	const chatId = agent?.chatId;
	const isEditable = Boolean(agent && !agent.isReadonly && !agent.isRunning && output?.id && input?.sql_query);
	const logDownload = useMutation(trpc.analyticsEvent.logChatDownload.mutationOptions());

	const openEditor = (editable: boolean) => {
		if (state === 'input-streaming' || !output || !input) {
			return;
		}
		openSidePanel(<SidePanelContent input={input} output={output} editable={editable} />);
	};

	const handleExport = (format: DataExportFormat) => {
		if (chatId) {
			logDownload.mutate({ chatId, format, queryId: toolCallId, title: input?.name });
		}
	};

	const actions: ActionButton[] = [
		{
			id: 'results',
			label: <TableIcon className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			expandOnClick: true,
			isActive: viewMode === 'results',
			onClick: () => setViewMode('results'),
			title: 'View results',
		},
		{
			id: 'query',
			label: <Code className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			expandOnClick: true,
			isActive: viewMode === 'query',
			onClick: () => setViewMode('query'),
			title: 'View query',
		},
		{
			id: 'format',
			label: <Palette className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			onClick: () => {
				if (!output) {
					return;
				}
				setViewMode('results');
				setIsFormatOpen(true);
			},
			title: 'Conditional formatting',
		},
		{
			id: 'copy',
			label: <Copy className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			onClick: () => {
				navigator.clipboard.writeText(input?.sql_query ?? '');
			},
			title: 'Copy query',
		},
		...(output
			? [
					{
						id: 'download',
						label: <Download className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
						title: 'Export results',
						export: {
							columns: output.columns,
							data: output.data as Record<string, unknown>[],
							filename: input?.name || 'query',
							onExport: handleExport,
						},
					},
				]
			: []),
		{
			id: 'edit',
			label: <Pencil className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			onClick: () => openEditor(isEditable),
			title: isEditable ? 'Edit in side panel' : 'Open in side panel',
		},
	];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'query'}
			title={
				<span className='flex items-baseline gap-2.5'>
					<span className='text-foreground'>SQL</span>
					<span className='text-xs text-muted-foreground truncate'>{input?.name ?? input?.sql_query}</span>
				</span>
			}
			badge={output?.row_count && `${output.row_count} rows`}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'query' && input?.sql_query ? (
				<SqlQueryDisplay query={input.sql_query} />
			) : output ? (
				<>
					<SqlResultDisplay output={output} conditionalFormats={conditionalFormats} />
					<TableFormatEditDialog
						open={isFormatOpen}
						onOpenChange={setIsFormatOpen}
						columns={output.columns}
						data={output.data as Record<string, unknown>[]}
						formats={conditionalFormats}
						onSave={async (next) => setConditionalFormats(next)}
						description='Apply conditional formatting to columns of this result.'
					/>
				</>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Executing query...</div>
			)}
		</ToolCallWrapper>
	);
};

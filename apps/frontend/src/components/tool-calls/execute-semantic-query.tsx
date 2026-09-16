import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Code, Copy, Download, Layers, Palette, PanelRight, Table as TableIcon } from 'lucide-react';
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
import { semanticQueryAsSql } from '@/lib/execute-sql-messages';
import { trpc } from '@/main';

type ViewMode = 'results' | 'definition' | 'sql';

export const ExecuteSemanticQueryToolCall = ({
	toolPart: { output, input, state, toolCallId },
}: ToolCallComponentProps<'execute_semantic_query'>) => {
	const [viewMode, setViewMode] = useState<ViewMode>('results');
	const [conditionalFormats, setConditionalFormats] = useState<ColumnConditionalFormats>({});
	const [isFormatOpen, setIsFormatOpen] = useState(false);
	const { isSettled } = useToolCallContext();
	const { open: openSidePanel } = useSidePanel();
	const agent = useOptionalAgentContext();
	const chatId = agent?.chatId;
	const logDownload = useMutation(trpc.analyticsEvent.logChatDownload.mutationOptions());

	const openViewer = () => {
		if (state === 'input-streaming' || !output) {
			return;
		}
		const asSql = semanticQueryAsSql(input, output);
		openSidePanel(<SidePanelContent input={asSql.input!} output={output} editable={false} />);
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
			id: 'definition',
			label: <Layers className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			expandOnClick: true,
			isActive: viewMode === 'definition',
			onClick: () => setViewMode('definition'),
			title: 'View semantic query',
		},
		{
			id: 'sql',
			label: <Code className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			expandOnClick: true,
			isActive: viewMode === 'sql',
			onClick: () => setViewMode('sql'),
			title: 'View compiled SQL',
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
				navigator.clipboard.writeText(output?.compiled_sql ?? '');
			},
			title: 'Copy compiled SQL',
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
							filename: input?.name || 'semantic-query',
							onExport: handleExport,
						},
					},
				]
			: []),
		{
			id: 'open',
			label: <PanelRight className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			onClick: openViewer,
			title: 'Open in side panel',
		},
	];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode !== 'results'}
			title={
				<span className='flex items-baseline gap-2.5'>
					<span className='text-foreground'>Semantic query</span>
					<span className='text-xs text-muted-foreground truncate'>
						{input?.name ?? (input ? summarizeSemanticQuery(input) : undefined)}
					</span>
				</span>
			}
			badge={output?.row_count && `${output.row_count} rows`}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'definition' && input ? (
				<SemanticQueryDefinition query={input} />
			) : viewMode === 'sql' && output ? (
				<SqlQueryDisplay query={output.compiled_sql} />
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
				<div className='p-4 text-center text-foreground/50 text-sm'>Compiling and executing query...</div>
			)}
		</ToolCallWrapper>
	);
};

/** The input as the UI sees it, possibly still streaming: every field and array item may be missing. */
type PartialSemanticQuery = NonNullable<ToolCallComponentProps<'execute_semantic_query'>['toolPart']['input']>;

function SemanticQueryDefinition({ query }: { query: PartialSemanticQuery }) {
	const rows: { label: string; values: string[] }[] = [
		{ label: 'Metrics', values: definedValues(query.metrics) },
		{ label: 'Group by', values: definedValues(query.group_by) },
		{ label: 'Where', values: definedValues(query.where) },
		{ label: 'Order by', values: definedValues(query.order_by) },
		{ label: 'Limit', values: query.limit !== undefined ? [String(query.limit)] : [] },
		{ label: 'From', values: query.start_time ? [query.start_time] : [] },
		{ label: 'To', values: query.end_time ? [query.end_time] : [] },
	];

	return (
		<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-xs'>
			{rows
				.filter((row) => row.values.length > 0)
				.map((row) => (
					<div key={row.label} className='contents'>
						<dt className='text-muted-foreground'>{row.label}</dt>
						<dd className='flex flex-wrap gap-1'>
							{row.values.map((value) => (
								<code key={value} className='rounded bg-muted px-1.5 py-0.5 font-mono'>
									{value}
								</code>
							))}
						</dd>
					</div>
				))}
		</dl>
	);
}

function summarizeSemanticQuery(query: PartialSemanticQuery): string {
	const metrics = definedValues(query.metrics);
	const groupBy = definedValues(query.group_by);
	return groupBy.length > 0 ? `${metrics.join(', ')} by ${groupBy.join(', ')}` : metrics.join(', ');
}

function definedValues(values: (string | undefined)[] | undefined): string[] {
	return values?.filter((value): value is string => value !== undefined) ?? [];
}

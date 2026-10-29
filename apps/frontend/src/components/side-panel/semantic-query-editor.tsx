import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Play, Plus, Save, Trash2 } from 'lucide-react';
import { ResizableSeparator, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import type { executeSemanticQuery, executeSql } from '@nao/shared/tools';
import type { SemanticSourceQuery } from '@/lib/execute-sql-messages';
import type { SavedSemanticQuery, SemanticQueryFreshness } from '@/hooks/use-semantic-query-freshness';
import type { SemanticQueryDraft } from '@/lib/semantic-query-draft';

import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { usePublishSavedQuery } from '@/hooks/use-publish-saved-query';
import { useQueryRowsSource, useServerPaginatedRows } from '@/hooks/use-query-rows';
import { describeSemanticQueryFreshness, useSemanticQueryFreshness } from '@/hooks/use-semantic-query-freshness';
import { getMutationErrorMessage } from '@/components/side-panel/sql-editor';
import { SidePanelHeader } from '@/components/side-panel/side-panel-header';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { SqlQueryDisplay } from '@/components/tool-calls/sql-query-display';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { areStructurallyEqual } from '@/lib/ai';
import { applySemanticQueryResultToMessages } from '@/lib/execute-sql-messages';
import {
	fromSemanticQueryDraft,
	hasInvalidLimit,
	nonEmptyValues,
	normalizeSemanticQuery,
	toSemanticQueryDraft,
} from '@/lib/semantic-query-draft';
import { trpc } from '@/main';

const RESULTS_MIN_HEIGHT = 240;
const DEFINITION_MIN_HEIGHT = 120;
const RESULTS_PAGE_SIZE = 100;
const PANEL_SCROLL_Y = { overflowY: 'auto' } as const;
const PANEL_OVERFLOW_HIDDEN = { overflow: 'hidden' } as const;

type ResultsTab = 'results' | 'sql';

const RESULTS_TABS: { id: ResultsTab; label: string }[] = [
	{ id: 'results', label: 'Results' },
	{ id: 'sql', label: 'Compiled SQL' },
];

interface SemanticQueryEditorProps {
	sourceQuery: SemanticSourceQuery;
	editable?: boolean;
	onOutputChange?: (output: executeSql.Output) => void;
}

export function SemanticQuerySidePanelContent({ sourceQuery, editable = false }: SemanticQueryEditorProps) {
	return (
		<div className='flex h-full min-h-0 flex-col bg-background'>
			<SidePanelHeader
				title={sourceQuery.input.name ?? sourceQuery.semanticQuery.metrics.join(', ')}
				label={sourceQuery.output.id}
			/>
			<SemanticQueryEditor sourceQuery={sourceQuery} editable={editable} />
		</div>
	);
}

/**
 * Edits the metric query behind a result. Running it compiles the definition again with the
 * semantic layer, so a run also picks up any change made to the metrics since the query was saved.
 */
export function SemanticQueryEditor({ sourceQuery, editable = false, onOutputChange }: SemanticQueryEditorProps) {
	const agent = useOptionalAgentContext();
	const publishSavedQuery = usePublishSavedQuery();
	const queryId = sourceQuery.output.id;
	const tabsId = useId();
	const [saved, setSaved] = useState<SavedSemanticQuery>(() => toSavedQuery(sourceQuery));
	const [draft, setDraft] = useState<SemanticQueryDraft>(() => toSemanticQueryDraft(sourceQuery.semanticQuery));
	const [previewOutput, setPreviewOutput] = useState<executeSql.Output>(sourceQuery.output);
	const [previewSql, setPreviewSql] = useState(sourceQuery.input.sql_query);
	const [resultsTab, setResultsTab] = useState<ResultsTab>('results');
	const [error, setError] = useState<string | null>(null);
	const rowsSource = useQueryRowsSource(sourceQuery.toolCallId, previewOutput);
	const resultRows = useServerPaginatedRows(
		rowsSource,
		previewOutput.data as Record<string, unknown>[],
		RESULTS_PAGE_SIZE,
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const onOutputChangeRef = useRef(onOutputChange);
	onOutputChangeRef.current = onOutputChange;

	useEffect(() => {
		setSaved(toSavedQuery(sourceQuery));
		setDraft(toSemanticQueryDraft(sourceQuery.semanticQuery));
		setPreviewOutput(sourceQuery.output);
		setPreviewSql(sourceQuery.input.sql_query);
		setError(null);
	}, [queryId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when switching queries

	const canEdit = Boolean(editable && queryId && !agent?.isReadonly);
	const draftQuery = useMemo(() => fromSemanticQueryDraft(draft), [draft]);
	const isDirty = !areStructurallyEqual(draftQuery, saved.semanticQuery);
	const freshness = useSemanticQueryFreshness(canEdit ? saved : null);

	const previewMutation = useMutation(trpc.sql.previewSemanticQuery.mutationOptions());
	const saveMutation = useMutation(trpc.sql.updateSemanticQuery.mutationOptions());
	const isBusy = previewMutation.isPending || saveMutation.isPending;
	const canRun = canEdit && draftQuery !== null && !isBusy;

	const showOutput = useCallback((output: executeSemanticQuery.Output) => {
		setPreviewOutput(output);
		setPreviewSql(output.compiled_sql);
		setError(null);
		onOutputChangeRef.current?.(output);
	}, []);

	const handleRun = useCallback(() => {
		if (!canRun || !draftQuery) {
			return;
		}
		setError(null);
		previewMutation.mutate(
			{ queryId, query: draftQuery },
			{ onSuccess: showOutput, onError: (err) => setError(getMutationErrorMessage(err)) },
		);
	}, [canRun, draftQuery, previewMutation, queryId, showOutput]);

	const handleSaveAndRun = useCallback(() => {
		if (!canRun || !draftQuery) {
			return;
		}
		setError(null);
		saveMutation.mutate(
			{ queryId, query: draftQuery },
			{
				onSuccess: (result) => {
					const { name: _name, ...semanticQuery } = result.input;
					setSaved({
						queryId,
						semanticQuery: normalizeSemanticQuery(semanticQuery),
						compiledSql: result.output.compiled_sql,
					});
					setDraft(toSemanticQueryDraft(semanticQuery));
					showOutput(result.output);
					publishSavedQuery((messages) =>
						applySemanticQueryResultToMessages(messages, result.output.id, result.input, result.output),
					);
				},
				onError: (err) => setError(getMutationErrorMessage(err)),
			},
		);
	}, [canRun, draftQuery, publishSavedQuery, queryId, saveMutation, showOutput]);

	useEffect(() => {
		if (!canEdit) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
				return;
			}
			const withModifier = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
			if (withModifier && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				handleSaveAndRun();
				return;
			}
			if (withModifier && event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				handleRun();
			}
		};

		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [canEdit, handleSaveAndRun, handleRun]);

	return (
		<div ref={rootRef} className='flex min-h-0 flex-1 flex-col bg-background'>
			{canEdit && (
				<div className='flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2'>
					<div className='text-xs text-muted-foreground'>
						{isDirty ? 'Unsaved changes' : 'Edit the semantic query, then run or save'}
					</div>
					<div className='flex items-center gap-2'>
						<Button
							type='button'
							variant='outline'
							size='sm'
							className='h-8 gap-1.5'
							onClick={handleRun}
							disabled={!canRun}
						>
							{previewMutation.isPending ? (
								<Loader2 className='size-3.5 animate-spin' />
							) : (
								<Play className='size-3.5' />
							)}
							<span>Run</span>
							<kbd className='text-[10px] opacity-60 font-sans'>⌘↵</kbd>
						</Button>
						<Button
							type='button'
							size='sm'
							className='h-8 gap-1.5'
							onClick={handleSaveAndRun}
							disabled={!canRun}
						>
							{saveMutation.isPending ? (
								<Loader2 className='size-3.5 animate-spin' />
							) : (
								<Save className='size-3.5' />
							)}
							<span>Save & run</span>
							<kbd className='text-[10px] opacity-60 font-sans'>⌘S</kbd>
						</Button>
					</div>
				</div>
			)}

			{error && (
				<div className='shrink-0 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive'>{error}</div>
			)}
			<SemanticQueryFreshnessNotice freshness={freshness} />

			<ResizablePanelGroup orientation='vertical' className='min-h-0 flex-1'>
				<ResizablePanel id='definition' minSize={DEFINITION_MIN_HEIGHT} style={PANEL_SCROLL_Y}>
					<SemanticQueryForm draft={draft} onChange={setDraft} readOnly={!canEdit} />
				</ResizablePanel>

				<ResizableSeparator withHandle />

				<ResizablePanel
					id='results'
					defaultSize={RESULTS_MIN_HEIGHT}
					minSize={RESULTS_MIN_HEIGHT}
					className='flex flex-col'
					style={PANEL_OVERFLOW_HIDDEN}
				>
					<TabBar
						tabs={RESULTS_TABS}
						activeTab={resultsTab}
						onTabChange={setResultsTab}
						idBase={tabsId}
						className='shrink-0 border-b px-2'
					/>
					<TabPanel idBase={tabsId} tabId={resultsTab} className='flex min-h-0 flex-1 flex-col'>
						{resultsTab === 'results' ? (
							<TableDisplay
								data={resultRows.rows}
								serverPagination={resultRows.serverPagination}
								columns={previewOutput.columns}
								className='h-full'
								tableContainerClassName='flex-1 rounded-none border-0'
								emptyLabel={resultRows.isLoadingRows ? 'Loading rows...' : 'No rows returned'}
								maxRowsBeforePagination={RESULTS_PAGE_SIZE}
							/>
						) : (
							<SqlQueryDisplay query={previewSql} className='max-h-none flex-1' />
						)}
					</TabPanel>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

function SemanticQueryFreshnessNotice({ freshness }: { freshness: SemanticQueryFreshness }) {
	const description = describeSemanticQueryFreshness(freshness);
	if (freshness.status === 'outdated') {
		return (
			<div className='flex shrink-0 items-start gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'>
				<AlertTriangle className='mt-px size-3.5 shrink-0' />
				<span>{description} Save & run to refresh its results with the current definitions.</span>
			</div>
		);
	}
	if (freshness.status === 'broken') {
		return (
			<div className='flex shrink-0 items-start gap-1.5 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive'>
				<AlertTriangle className='mt-px size-3.5 shrink-0' />
				<span>
					{description} Update its metrics or dimensions.
					<span className='mt-0.5 block font-mono opacity-80'>{freshness.message}</span>
				</span>
			</div>
		);
	}
	return null;
}

interface SemanticQueryFormProps {
	draft: SemanticQueryDraft;
	onChange: (draft: SemanticQueryDraft) => void;
	readOnly: boolean;
}

function SemanticQueryForm({ draft, onChange, readOnly }: SemanticQueryFormProps) {
	const update = (patch: Partial<SemanticQueryDraft>) => onChange({ ...draft, ...patch });
	const isLimitInvalid = hasInvalidLimit(draft);

	return (
		<div className='@container flex flex-col gap-5 p-4'>
			<div className='grid gap-5 @2xl:grid-cols-2'>
				<ValueListField
					label='Metrics'
					values={draft.metrics}
					onChange={(metrics) => update({ metrics })}
					placeholder='revenue'
					addLabel='Add metric'
					readOnly={readOnly}
					required
				/>
				<ValueListField
					label='Group by'
					values={draft.group_by}
					onChange={(group_by) => update({ group_by })}
					placeholder='metric_time__month'
					addLabel='Add dimension'
					readOnly={readOnly}
				/>
				<ValueListField
					label='Where'
					values={draft.where}
					onChange={(where) => update({ where })}
					placeholder="{{ Dimension('customer__region') }} = 'EMEA'"
					addLabel='Add filter'
					readOnly={readOnly}
				/>
				<ValueListField
					label='Order by'
					values={draft.order_by}
					onChange={(order_by) => update({ order_by })}
					placeholder='-revenue'
					addLabel='Add sort'
					readOnly={readOnly}
				/>
			</div>
			<div className='grid grid-cols-3 gap-3'>
				<TextField
					label='Limit'
					value={draft.limit}
					onChange={(limit) => update({ limit })}
					placeholder='No limit'
					readOnly={readOnly}
					error={isLimitInvalid ? 'Use a positive whole number.' : undefined}
				/>
				<TextField
					label='From'
					value={draft.start_time}
					onChange={(start_time) => update({ start_time })}
					placeholder='YYYY-MM-DD'
					readOnly={readOnly}
				/>
				<TextField
					label='To'
					value={draft.end_time}
					onChange={(end_time) => update({ end_time })}
					placeholder='YYYY-MM-DD'
					readOnly={readOnly}
				/>
			</div>
		</div>
	);
}

interface ValueListFieldProps {
	label: string;
	values: string[];
	onChange: (values: string[]) => void;
	placeholder: string;
	addLabel: string;
	readOnly: boolean;
	required?: boolean;
}

function ValueListField({ label, values, onChange, placeholder, addLabel, readOnly, required }: ValueListFieldProps) {
	const isMissing = required && nonEmptyValues(values).length === 0;

	return (
		<div className='grid content-start gap-2'>
			<div className='flex h-7 items-center justify-between gap-2'>
				<span className='text-sm font-semibold text-foreground'>{label}</span>
				{!readOnly && (
					<Button
						type='button'
						size='sm'
						variant='outline'
						className='h-7 rounded-full text-xs'
						onClick={() => onChange([...values, ''])}
					>
						<Plus className='size-3.5' /> {addLabel}
					</Button>
				)}
			</div>
			{values.map((value, index) => (
				<div key={index} className='flex items-center gap-2'>
					<Input
						value={value}
						readOnly={readOnly}
						aria-label={`${label} ${index + 1}`}
						placeholder={placeholder}
						className='h-8 bg-panel font-mono text-xs'
						onChange={(event) =>
							onChange(values.map((current, i) => (i === index ? event.target.value : current)))
						}
					/>
					{!readOnly && (
						<Button
							type='button'
							size='icon-sm'
							variant='ghost-muted'
							className='size-8 shrink-0'
							onClick={() => onChange(values.filter((_, i) => i !== index))}
							aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
						>
							<Trash2 className='size-4' />
						</Button>
					)}
				</div>
			))}
			{values.length === 0 && <span className='text-xs text-muted-foreground'>None</span>}
			{isMissing && !readOnly && <span className='text-xs text-destructive'>Add at least one metric.</span>}
		</div>
	);
}

interface TextFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	readOnly: boolean;
	error?: string;
}

function TextField({ label, value, onChange, placeholder, readOnly, error }: TextFieldProps) {
	return (
		<label className='grid content-start gap-1'>
			<span className='text-xs text-muted-foreground'>{label}</span>
			<Input
				value={value}
				readOnly={readOnly}
				placeholder={placeholder}
				className='h-8 bg-panel font-mono text-xs'
				onChange={(event) => onChange(event.target.value)}
			/>
			{error && <span className='text-xs text-destructive'>{error}</span>}
		</label>
	);
}

function toSavedQuery(sourceQuery: SemanticSourceQuery): SavedSemanticQuery {
	return {
		queryId: sourceQuery.output.id,
		semanticQuery: normalizeSemanticQuery(sourceQuery.semanticQuery),
		compiledSql: sourceQuery.input.sql_query,
	};
}

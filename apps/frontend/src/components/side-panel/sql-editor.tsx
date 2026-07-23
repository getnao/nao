import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, useMonaco } from '@monaco-editor/react';
import { validateSqlFilterTemplate } from '@nao/shared/sql-template';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Play, Save } from 'lucide-react';
import { usePanelRef } from 'react-resizable-panels';
import { ResizableSeparator, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import type { Monaco } from '@monaco-editor/react';
import type { UIMessage } from '@nao/backend/chat';
import type { executeSql } from '@nao/shared/tools';
import type { editor } from 'monaco-editor';

import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useEditorTheme } from '@/hooks/use-editor-theme';
import { FixInChatButton } from '@/components/fix-in-chat-button';
import { SidePanelHeader } from '@/components/side-panel/side-panel-header';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Button } from '@/components/ui/button';
import { applyExecuteSqlResultToMessages } from '@/lib/execute-sql-messages';
import { formatSQL } from '@/lib/sql-formatter';
import { SQL_SHIKI_THEME, setupSqlHighlighting } from '@/lib/sql-shiki-theme';
import { trpc } from '@/main';

const RESULTS_MIN_HEIGHT = 240;
const SQL_MIN_HEIGHT = 100;
const SEPARATOR_HEIGHT = 12;
const SQL_CONTENT_PADDING = 8;

export const SidePanelContent = ({
	input,
	output,
	editable = false,
}: {
	input: executeSql.Input;
	output: executeSql.Output;
	editable?: boolean;
}) => {
	const queryClient = useQueryClient();
	const monaco = useMonaco();
	const editorTheme = useEditorTheme();
	const [shikiReady, setShikiReady] = useState(false);
	const agent = useOptionalAgentContext();
	const agentRef = useRef(agent);
	agentRef.current = agent;
	const queryId = output.id;
	const [sqlQuery, setSqlQuery] = useState(input.sql_query);
	const [savedSql, setSavedSql] = useState(input.sql_query);
	const [previewOutput, setPreviewOutput] = useState<executeSql.Output>(output);
	const [error, setError] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const sqlPanelRef = usePanelRef();
	const groupElementRef = useRef<HTMLDivElement>(null);
	const sqlQueryRef = useRef(sqlQuery);
	sqlQueryRef.current = sqlQuery;

	useEffect(() => {
		if (!monaco) {
			return;
		}
		let active = true;
		setupSqlHighlighting(monaco).then(() => {
			if (active) {
				setShikiReady(true);
			}
		});
		return () => {
			active = false;
		};
	}, [monaco]);

	const themeName = shikiReady
		? editorTheme === 'vs-dark'
			? SQL_SHIKI_THEME.dark
			: SQL_SHIKI_THEME.light
		: editorTheme;

	useEffect(() => {
		setSqlQuery(input.sql_query);
		setSavedSql(input.sql_query);
		setPreviewOutput(output);
		setError(null);
	}, [queryId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when switching queries

	const canEdit = Boolean(editable && queryId && agent && !agent.isReadonly);
	const isDirty = sqlQuery !== savedSql;
	const validationIssues = useMemo(() => (canEdit ? validateSqlFilterTemplate(sqlQuery) : []), [canEdit, sqlQuery]);

	const previewMutation = useMutation(trpc.sql.previewQuery.mutationOptions());
	const saveMutation = useMutation(trpc.sql.updateQuery.mutationOptions());
	const isBusy = previewMutation.isPending || saveMutation.isPending;
	const isBusyRef = useRef(isBusy);
	isBusyRef.current = isBusy;

	const buildMutationInput = useCallback(
		(sql: string) => ({
			queryId: queryId!,
			sql_query: sql,
			database_id: input.database_id ?? undefined,
			name: input.name ?? undefined,
		}),
		[queryId, input.database_id, input.name],
	);

	const beginMutation = useCallback(() => {
		const sql = editorRef.current?.getValue() ?? sqlQueryRef.current;
		if (!queryId || !sql.trim() || isBusyRef.current) {
			return null;
		}
		setSqlQuery(sql);
		setError(null);
		return sql;
	}, [queryId]);

	const handleRun = useCallback(() => {
		const sql = beginMutation();
		if (!sql) {
			return;
		}
		previewMutation.mutate(buildMutationInput(sql), {
			onSuccess: (result) => {
				setPreviewOutput(result);
				setError(null);
			},
			onError: (err) => setError(getMutationErrorMessage(err)),
		});
	}, [beginMutation, buildMutationInput, previewMutation]);

	const handleSaveAndRun = useCallback(() => {
		const sql = beginMutation();
		if (!sql) {
			return;
		}
		saveMutation.mutate(buildMutationInput(sql), {
			onSuccess: (result) => {
				setPreviewOutput(result.output);
				setSqlQuery(result.input.sql_query);
				setSavedSql(result.input.sql_query);
				setError(null);

				const applyUpdate = (messages: UIMessage[]) =>
					applyExecuteSqlResultToMessages(messages, result.output.id, result.input, result.output);

				const currentAgent = agentRef.current;
				if (currentAgent) {
					currentAgent.setMessages((messages) => applyUpdate(messages));
					if (currentAgent.chatId) {
						queryClient.setQueryData(trpc.chat.get.queryKey({ chatId: currentAgent.chatId }), (previous) =>
							previous ? { ...previous, messages: applyUpdate(previous.messages) } : previous,
						);
					}
				}

				void queryClient.invalidateQueries(trpc.story.getQuerySql.pathFilter());
				void queryClient.invalidateQueries(trpc.story.getFilteredQueryData.pathFilter());
				void queryClient.invalidateQueries(trpc.storyShare.getQuerySql.pathFilter());
				void queryClient.invalidateQueries(trpc.storyShare.getFilteredQueryData.pathFilter());
			},
			onError: (err) => setError(getMutationErrorMessage(err)),
		});
	}, [beginMutation, buildMutationInput, saveMutation, queryClient]);

	useEffect(() => {
		if (!canEdit) {
			return;
		}

		const isFocusInsidePanel = (target: EventTarget | null) =>
			target instanceof Node && Boolean(rootRef.current?.contains(target));

		const onKeyDown = (event: KeyboardEvent) => {
			if (!isFocusInsidePanel(event.target)) {
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

	const fitSqlPanelToContent = useCallback(
		(instance: editor.IStandaloneCodeEditor) => {
			const groupHeight = groupElementRef.current?.clientHeight ?? 0;
			const panel = sqlPanelRef.current;
			if (!panel || groupHeight <= 0) {
				return false;
			}

			instance.layout();
			const contentHeight = instance.getContentHeight() + SQL_CONTENT_PADDING;
			const maxSqlHeight = Math.max(SQL_MIN_HEIGHT, groupHeight - RESULTS_MIN_HEIGHT - SEPARATOR_HEIGHT);
			const sqlHeight = Math.min(Math.max(contentHeight, SQL_MIN_HEIGHT), maxSqlHeight);
			panel.resize(sqlHeight);
			return true;
		},
		[sqlPanelRef],
	);

	const handleEditorMount = useCallback(
		(instance: editor.IStandaloneCodeEditor, _monaco: Monaco) => {
			editorRef.current = instance;

			let fitted = false;
			const tryFit = () => {
				if (fitted || !fitSqlPanelToContent(instance)) {
					return;
				}
				fitted = true;
				disposable.dispose();
			};
			const disposable = instance.onDidContentSizeChange(tryFit);
			requestAnimationFrame(tryFit);
		},
		[fitSqlPanelToContent],
	);

	return (
		<div ref={rootRef} className='flex h-full min-h-0 flex-col bg-background'>
			<SidePanelHeader title={input.name ?? input.sql_query} label={queryId} />

			{canEdit && (
				<div className='flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2'>
					<div className='text-xs text-muted-foreground'>
						{isDirty ? 'Unsaved changes' : 'Edit SQL, then run or save'}
					</div>
					<div className='flex items-center gap-2'>
						<Button
							type='button'
							variant='outline'
							size='sm'
							className='h-8 gap-1.5'
							onClick={handleRun}
							disabled={isBusy || !sqlQuery.trim()}
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
							disabled={isBusy || !sqlQuery.trim()}
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
			{validationIssues.length > 0 && <SqlValidationBanner queryId={queryId} issues={validationIssues} />}

			<ResizablePanelGroup orientation='vertical' className='min-h-0 flex-1' elementRef={groupElementRef}>
				<ResizablePanel
					id='sql'
					minSize={SQL_MIN_HEIGHT}
					panelRef={sqlPanelRef}
					className='relative w-full group'
				>
					<div className='w-full h-full overflow-auto [&_span]:font-mono pl-2'>
						<Editor
							value={canEdit ? sqlQuery : formatSQL(input.sql_query, output.dialect)}
							onChange={canEdit ? (value) => setSqlQuery(value ?? '') : undefined}
							onMount={handleEditorMount}
							language='sql'
							theme={themeName}
							options={{
								readOnly: !canEdit,
								minimap: {
									enabled: false,
								},
								folding: false,
								lineNumbers: canEdit ? 'on' : 'off',
								scrollbar: {
									horizontal: 'hidden',
									vertical: 'hidden',
								},
								scrollBeyondLastLine: false,
								padding: {
									top: 16,
									bottom: 16,
								},
								wordWrap: 'on',
							}}
						/>
					</div>
				</ResizablePanel>

				<ResizableSeparator withHandle />

				<ResizablePanel id='results' defaultSize={RESULTS_MIN_HEIGHT} minSize={RESULTS_MIN_HEIGHT}>
					<TableDisplay
						data={previewOutput.data as Record<string, unknown>[]}
						columns={previewOutput.columns}
						className='h-full'
						tableContainerClassName='flex-1 rounded-none border-0'
						emptyLabel='No rows returned'
						maxRowsBeforePagination={100}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
};

function SqlValidationBanner({ queryId, issues }: { queryId: string | undefined; issues: string[] }) {
	const fixMessage = [
		`I'm seeing SQL template validation warnings${queryId ? ` for query ${queryId}` : ''}:`,
		...issues.map((issue) => `- ${issue}`),
		'',
		'Please fix the SQL filter template while preserving the query id.',
	].join('\n');

	return (
		<div className='flex shrink-0 items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-1.5 font-medium'>
					<AlertTriangle className='size-3.5 shrink-0' />
					<span>
						{issues.length} SQL template {issues.length === 1 ? 'warning' : 'warnings'}
					</span>
				</div>
				<ul className='mt-1 flex flex-col gap-0.5'>
					{issues.slice(0, 5).map((issue) => (
						<li key={issue} className='truncate'>
							{issue}
						</li>
					))}
					{issues.length > 5 && <li className='opacity-70'>and {issues.length - 5} more...</li>}
				</ul>
			</div>
			<FixInChatButton message={fixMessage} className='shrink-0 gap-1.5' />
		</div>
	);
}

function getMutationErrorMessage(err: unknown): string {
	if (err instanceof Error && err.message) {
		return err.message;
	}
	if (err && typeof err === 'object' && 'shape' in err) {
		const shape = (err as { shape?: { message?: string } }).shape;
		if (shape?.message) {
			return shape.message;
		}
	}
	return 'Failed to run query';
}

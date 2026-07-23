import { useCallback, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Save } from 'lucide-react';
import { usePanelRef } from 'react-resizable-panels';
import { ResizableSeparator, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import type { Monaco } from '@monaco-editor/react';
import type { executeSql } from '@nao/shared/tools';
import type { editor } from 'monaco-editor';

import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { SidePanelHeader } from '@/components/side-panel/side-panel-header';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Button } from '@/components/ui/button';
import { applyExecuteSqlResultToMessages } from '@/lib/execute-sql-messages';
import { formatSQL } from '@/lib/sql-formatter';
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
	const agent = useOptionalAgentContext();
	const [sqlQuery, setSqlQuery] = useState(input.sql_query);
	const [savedSql, setSavedSql] = useState(input.sql_query);
	const [previewOutput, setPreviewOutput] = useState<executeSql.Output>(output);
	const [error, setError] = useState<string | null>(null);
	const handleRunRef = useRef<() => void>(() => {});
	const handleSaveAndRunRef = useRef<() => void>(() => {});
	const sqlPanelRef = usePanelRef();
	const groupElementRef = useRef<HTMLDivElement>(null);

	const canEdit = Boolean(editable && output.id && agent && !agent.isReadonly);
	const isDirty = sqlQuery !== savedSql;

	const previewMutation = useMutation(
		trpc.sql.previewQuery.mutationOptions({
			onSuccess: (result) => {
				setPreviewOutput(result);
				setError(null);
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const saveMutation = useMutation(
		trpc.sql.updateQuery.mutationOptions({
			onSuccess: (result) => {
				setPreviewOutput(result.output);
				setSqlQuery(result.input.sql_query);
				setSavedSql(result.input.sql_query);
				setError(null);
				if (agent) {
					agent.setMessages(
						applyExecuteSqlResultToMessages(agent.messages, result.output.id, result.input, result.output),
					);
				}
				queryClient.invalidateQueries({ queryKey: [['chat', 'get']] });
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const isBusy = previewMutation.isPending || saveMutation.isPending;

	const handleRun = () => {
		if (!output.id || !sqlQuery.trim() || isBusy) {
			return;
		}
		setError(null);
		previewMutation.mutate({
			queryId: output.id,
			sql_query: sqlQuery,
			database_id: input.database_id,
			name: input.name,
		});
	};

	const handleSaveAndRun = () => {
		if (!output.id || !sqlQuery.trim() || isBusy) {
			return;
		}
		setError(null);
		saveMutation.mutate({
			queryId: output.id,
			sql_query: sqlQuery,
			database_id: input.database_id,
			name: input.name,
		});
	};

	handleRunRef.current = handleRun;
	handleSaveAndRunRef.current = handleSaveAndRun;

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
		(instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
			if (canEdit) {
				instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
					handleSaveAndRunRef.current();
				});
				instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
					handleRunRef.current();
				});
			}

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
		[canEdit, fitSqlPanelToContent],
	);

	return (
		<div className='flex h-full min-h-0 flex-col bg-background'>
			<SidePanelHeader title={input.name ?? input.sql_query} />

			{canEdit && (
				<div className='flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2'>
					<div className='text-xs text-muted-foreground'>
						{isDirty ? 'Unsaved changes' : 'Edit SQL, then run or save'}
					</div>
					<div className='flex items-center gap-2'>
						<Button
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
							theme='light'
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

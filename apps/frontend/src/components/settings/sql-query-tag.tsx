import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	DEFAULT_SQL_QUERY_TAG_POSITION,
	DEFAULT_SQL_QUERY_TAG_TEMPLATE,
	findUnknownSqlQueryTagVariables,
	formatSqlQueryTagComment,
	isSqlQueryTagPosition,
	renderSqlQueryTag,
	SQL_QUERY_TAG_POSITIONS,
	SQL_QUERY_TAG_TEMPLATE_MAX_LENGTH,
	SQL_QUERY_TAG_VARIABLES,
} from '@nao/shared/sql-query-tag';
import { useRef, useState } from 'react';
import type { SqlQueryTagConfig, SqlQueryTagPosition, SqlQueryTagVariables } from '@nao/shared/sql-query-tag';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { trpc } from '@/main';

type QueryTagSettings = SqlQueryTagConfig & { enabled: boolean };

const ENABLED_SWITCH_ID = 'sql-query-tag-enabled';
const TEMPLATE_INPUT_ID = 'sql-query-tag-template';
const POSITION_SELECT_ID = 'sql-query-tag-position';

const DEFAULT_SETTINGS: QueryTagSettings = {
	enabled: false,
	template: DEFAULT_SQL_QUERY_TAG_TEMPLATE,
	position: DEFAULT_SQL_QUERY_TAG_POSITION,
};

const POSITION_LABELS: Record<SqlQueryTagPosition, string> = {
	start: 'Start of the query',
	end: 'End of the query',
};

const PREVIEW_QUERY = 'SELECT status, COUNT(*) AS orders\nFROM orders\nGROUP BY status';

export function SettingsSqlQueryTag() {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const tagSettings = useQuery(trpc.project.getSqlQueryTagSettings.queryOptions());
	const templateInput = useRef<HTMLTextAreaElement>(null);
	const [draft, setDraft] = useState<QueryTagSettings | null>(null);

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
				setDraft(null);
			},
		}),
	);

	const configFile = tagSettings.data?.configFile ?? null;
	const saved = agentSettings.data?.sql?.queryTag ?? DEFAULT_SETTINGS;
	const settings = configFile ? { ...configFile, enabled: true } : (draft ?? saved);
	const isReadOnly =
		configFile !== null || agentSettings.isPending || tagSettings.isPending || updateAgentSettings.isPending;
	const isTemplateMissing = settings.enabled && settings.template.trim() === '';
	const unknownVariables = findUnknownSqlQueryTagVariables(settings.template);

	const edit = (changes: Partial<QueryTagSettings>) => {
		setDraft({ ...settings, ...changes });
	};

	const insertVariable = (name: string) => {
		const input = templateInput.current;
		const start = input?.selectionStart ?? settings.template.length;
		const end = input?.selectionEnd ?? settings.template.length;
		edit({ template: `${settings.template.slice(0, start)}{{ ${name} }}${settings.template.slice(end)}` });
		input?.focus();
	};

	return (
		<SettingsCard
			title='Query tagging'
			description={
				<>
					Add a comment to every SQL query nao sends to your warehouse, to find and attribute them in its
					query history. Declare it as <code>query_tag</code> in <code>nao_config.yaml</code> to manage it
					from the repository instead.
				</>
			}
			action={configFile ? <Badge variant='secondary'>Set in nao_config.yaml</Badge> : undefined}
			divide
		>
			<SettingsControlRow
				id={ENABLED_SWITCH_ID}
				label='Tag SQL queries'
				description={
					configFile
						? 'Declared in nao_config.yaml: edit the query_tag section there to change it.'
						: 'Queries on the warehouse are tagged, whether they come from a chat, a story, an automation or the MCP.'
				}
				control={
					<Switch
						id={ENABLED_SWITCH_ID}
						checked={settings.enabled}
						onCheckedChange={(enabled) => edit({ enabled })}
						disabled={isReadOnly}
					/>
				}
			/>

			<div className='flex flex-col gap-2'>
				<label htmlFor={TEMPLATE_INPUT_ID} className='text-sm font-medium text-foreground'>
					Comment
				</label>
				<Textarea
					id={TEMPLATE_INPUT_ID}
					ref={templateInput}
					value={settings.template}
					onChange={(event) => edit({ template: event.target.value })}
					maxLength={SQL_QUERY_TAG_TEMPLATE_MAX_LENGTH}
					disabled={isReadOnly}
					aria-invalid={isTemplateMissing}
					spellCheck={false}
					className='min-h-16 font-mono text-xs md:text-xs'
				/>
				<div className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
					Variables
					{Object.entries(SQL_QUERY_TAG_VARIABLES).map(([name, description]) => (
						<SimpleTooltip key={name} content={description}>
							<button
								type='button'
								onClick={() => insertVariable(name)}
								disabled={isReadOnly}
								className='rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-60'
							>
								{name}
							</button>
						</SimpleTooltip>
					))}
				</div>
				{unknownVariables.length > 0 && (
					<p className='text-xs text-amber-600 dark:text-amber-500'>
						Unknown variables are kept as written: {unknownVariables.join(', ')}.
					</p>
				)}
			</div>

			<SettingsControlRow
				id={POSITION_SELECT_ID}
				label='Position'
				description='Snowflake drops the comments placed before a query: put it at the end there.'
				control={
					<Select
						value={settings.position}
						onValueChange={(position) => isSqlQueryTagPosition(position) && edit({ position })}
						disabled={isReadOnly}
					>
						<SelectTrigger id={POSITION_SELECT_ID} className='w-48'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SQL_QUERY_TAG_POSITIONS.map((position) => (
								<SelectItem key={position} value={position}>
									{POSITION_LABELS[position]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>

			{tagSettings.data && <QueryTagPreview settings={settings} variables={tagSettings.data.previewVariables} />}

			{!configFile && (
				<div className='flex justify-end gap-2'>
					<Button
						variant='ghost'
						size='sm'
						onClick={() => setDraft(null)}
						disabled={!draft || updateAgentSettings.isPending}
					>
						Discard
					</Button>
					<Button
						size='sm'
						onClick={() => draft && updateAgentSettings.mutate({ sql: { queryTag: draft } })}
						disabled={!draft || isTemplateMissing}
						isLoading={updateAgentSettings.isPending}
					>
						Save
					</Button>
				</div>
			)}
		</SettingsCard>
	);
}

function QueryTagPreview({ settings, variables }: { settings: QueryTagSettings; variables: SqlQueryTagVariables }) {
	const comment = (
		<span className='text-emerald-700 dark:text-emerald-400'>
			{formatSqlQueryTagComment(renderSqlQueryTag(settings.template, variables))}
		</span>
	);

	return (
		<div className='flex flex-col gap-2'>
			<p className='text-sm font-medium text-foreground'>Preview</p>
			<pre className='overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground'>
				{settings.position === 'start' && (
					<>
						{comment}
						{'\n'}
					</>
				)}
				{PREVIEW_QUERY}
				{settings.position === 'end' && (
					<>
						{'\n'}
						{comment}
					</>
				)}
			</pre>
			<p className='text-xs text-muted-foreground'>What a query of yours looks like once in the warehouse.</p>
		</div>
	);
}

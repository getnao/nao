import { EMPTY_PROJECT_ROW_SECURITY, normalizeProjectRowSecurity, rowSecurityTableKey } from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ProjectRowSecurity, SensitiveTableDefinition } from '@nao/shared';

import type {
	DatabaseContextObject,
	GroupedDatabase,
	GroupedSchema,
} from '@/components/settings/user-group-context-access';
import { groupDatabaseContextObjects } from '@/components/settings/user-group-context-access';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { useLicenseFeatures } from '@/hooks/use-license';
import {
	getAutoExpandKeys,
	getSingleChildFolderChain,
	getTreeNodePadding,
	removeExpandedSubtree,
} from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export function ProjectRowSecurity({
	objects,
	catalogState = 'ready',
	onRetryCatalog,
}: {
	objects: DatabaseContextObject[];
	catalogState?: 'loading' | 'error' | 'ready';
	onRetryCatalog?: () => void;
}) {
	const rowSecurity = useQuery(trpc.userGroup.rowSecurity.queryOptions());
	const license = useLicenseFeatures();
	const queryClient = useQueryClient();
	const update = useMutation(
		trpc.userGroup.updateRowSecurity.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.userGroup.rowSecurity.queryKey() });
			},
		}),
	);
	const [draft, setDraft] = useState<ProjectRowSecurity>(EMPTY_PROJECT_ROW_SECURITY);
	const [search, setSearch] = useState('');
	const isLicensed = license.data?.['row-level-security'] === true;
	const storedRowSecurity = JSON.stringify(rowSecurity.data);

	useEffect(() => {
		if (storedRowSecurity) {
			setDraft(JSON.parse(storedRowSecurity) as ProjectRowSecurity);
		}
	}, [storedRowSecurity]);

	const visibleObjects = useMemo(() => filterRowSecurityObjects(objects, search), [objects, search]);
	const unavailable =
		rowSecurity.isLoading || rowSecurity.isError || catalogState !== 'ready'
			? []
			: getUnavailableDefinitions(draft, objects);
	const columnCount = draft.tables.reduce((total, table) => total + table.constraintColumns.length, 0);
	const changed =
		rowSecurity.data !== undefined &&
		JSON.stringify(normalizeProjectRowSecurity(draft)) !==
			JSON.stringify(normalizeProjectRowSecurity(rowSecurity.data));

	return (
		<SettingsCard
			title='Row-level security'
			description='Choose constraint columns for sensitive tables. Group policies can only use these columns.'
			action={!isLicensed ? <UpgradeToEnterprise /> : undefined}
		>
			<div className={cn('flex flex-col gap-4', !isLicensed && 'opacity-60')}>
				<div className='flex items-center gap-2'>
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder='Search databases, schemas, tables, and columns'
						aria-label='Search row-level security tables'
						disabled={!isLicensed}
					/>
					<Badge variant='secondary' className='shrink-0'>
						{draft.tables.length} {draft.tables.length === 1 ? 'table' : 'tables'} · {columnCount}{' '}
						{columnCount === 1 ? 'column' : 'columns'}
					</Badge>
				</div>
				<div className='max-h-[28rem] overflow-auto rounded-lg border'>
					{rowSecurity.isLoading || catalogState === 'loading' ? (
						<TreeStatusRow status='Loading security settings...' />
					) : rowSecurity.isError ? (
						<TreeStatusRow
							status='Failed to load security settings'
							onRetry={() => void rowSecurity.refetch()}
						/>
					) : catalogState === 'error' ? (
						<TreeStatusRow status='Failed to load synced tables' onRetry={onRetryCatalog} />
					) : visibleObjects.length === 0 ? (
						<TreeStatusRow status={search ? 'No matching tables or columns.' : 'No synced tables.'} />
					) : (
						<RowSecurityTree
							objects={visibleObjects}
							draft={draft}
							disabled={!isLicensed}
							isSearching={search.trim().length > 0}
							onChange={setDraft}
						/>
					)}
				</div>
				{unavailable.length > 0 && (
					<div className='rounded-lg border border-dashed p-3'>
						<p className='text-sm font-medium'>Unavailable saved selections</p>
						<p className='mb-2 text-xs text-muted-foreground'>
							These tables or columns were not found in the latest sync.
						</p>
						{unavailable.map((definition) => (
							<div key={rowSecurityTableKey(definition)} className='flex items-center gap-2 py-1 text-xs'>
								<span className='min-w-0 flex-1 truncate'>
									{definition.database}/{definition.schema}/{definition.table}:{' '}
									{definition.constraintColumns.join(', ')}
								</span>
								<Button
									type='button'
									size='icon'
									variant='ghost'
									aria-label={`Remove unavailable ${definition.table}`}
									disabled={!isLicensed}
									onClick={() => setDraft(removeUnavailableSelection(draft, definition))}
								>
									<X />
								</Button>
							</div>
						))}
					</div>
				)}
				{update.error && <p className='text-sm text-destructive'>{update.error.message}</p>}
				{changed && isLicensed && (
					<div className='flex justify-end gap-2'>
						<Button type='button' variant='ghost' onClick={() => setDraft(rowSecurity.data)}>
							Cancel
						</Button>
						<Button type='button' onClick={() => update.mutate(draft)} isLoading={update.isPending}>
							Save security
						</Button>
					</div>
				)}
			</div>
		</SettingsCard>
	);
}

const ROW_SECURITY_EXPANSION_ADAPTER = {
	getKey: (folder: GroupedDatabase | GroupedSchema) => folder.key,
	getChildren: (folder: GroupedDatabase | GroupedSchema): GroupedSchema[] =>
		folder.kind === 'database' ? folder.schemas : [],
	isFolder: () => true,
};

function RowSecurityTree({
	objects,
	draft,
	disabled,
	isSearching,
	onChange,
}: {
	objects: DatabaseContextObject[];
	draft: ProjectRowSecurity;
	disabled: boolean;
	isSearching: boolean;
	onChange: (rowSecurity: ProjectRowSecurity) => void;
}) {
	const databases = useMemo(() => groupDatabaseContextObjects(objects), [objects]);
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

	const toggleFolder = (folder: GroupedDatabase | GroupedSchema) => {
		setExpandedKeys((current) => {
			const next = new Set(current);
			if (current.has(folder.key)) {
				removeExpandedSubtree(next, folder.key, '\0');
			} else {
				for (const key of getAutoExpandKeys(folder, ROW_SECURITY_EXPANSION_ADAPTER)) {
					next.add(key);
				}
			}
			return next;
		});
	};

	const toggleTable = (object: DatabaseContextObject) => {
		const key = rowSecurityTableKey(object);
		setExpandedKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	return (
		<ul data-testid='project-row-security-tree'>
			{databases.map((database) => (
				<RowSecurityDatabaseNode
					key={database.key}
					database={database}
					draft={draft}
					disabled={disabled}
					expandedKeys={expandedKeys}
					isSearching={isSearching}
					onToggleFolder={toggleFolder}
					onToggleTable={toggleTable}
					onChange={onChange}
				/>
			))}
		</ul>
	);
}

function RowSecurityDatabaseNode({
	database,
	draft,
	disabled,
	expandedKeys,
	isSearching,
	onToggleFolder,
	onToggleTable,
	onChange,
}: {
	database: GroupedDatabase;
	draft: ProjectRowSecurity;
	disabled: boolean;
	expandedKeys: Set<string>;
	isSearching: boolean;
	onToggleFolder: (folder: GroupedDatabase | GroupedSchema) => void;
	onToggleTable: (object: DatabaseContextObject) => void;
	onChange: (rowSecurity: ProjectRowSecurity) => void;
}) {
	const folderChain = getSingleChildFolderChain(database, ROW_SECURITY_EXPANSION_ADAPTER);
	const compactSchema = folderChain.length === 2 ? folderChain[1] : undefined;
	if (compactSchema?.kind === 'schema') {
		return (
			<RowSecuritySchemaNode
				schema={compactSchema}
				label={`${database.database}/${compactSchema.schema}`}
				databaseType={database.databaseType}
				depth={0}
				open={isSearching || expandedKeys.has(compactSchema.key)}
				draft={draft}
				disabled={disabled}
				isSearching={isSearching}
				expandedKeys={expandedKeys}
				onToggle={() => onToggleFolder(compactSchema)}
				onToggleTable={onToggleTable}
				onChange={onChange}
			/>
		);
	}

	const open = isSearching || expandedKeys.has(database.key);
	const panelId = `row-security-database-${toDomId(database.key)}`;
	return (
		<li>
			<button
				type='button'
				className='flex h-8 w-full items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50'
				style={{ paddingLeft: `${getTreeNodePadding(0)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${database.database} database`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => onToggleFolder(database)}
			>
				<ChevronRight
					className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
				/>
				<FileExplorerIcon name={database.database} type='directory' />
				<span className='min-w-0 flex-1 truncate font-medium'>{database.database}</span>
				<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
					{database.databaseType}
				</Badge>
			</button>
			{open && (
				<ul id={panelId}>
					{database.schemas.map((schema) => (
						<RowSecuritySchemaNode
							key={schema.key}
							schema={schema}
							label={schema.schema}
							depth={1}
							open={isSearching || expandedKeys.has(schema.key)}
							draft={draft}
							disabled={disabled}
							isSearching={isSearching}
							expandedKeys={expandedKeys}
							onToggle={() => onToggleFolder(schema)}
							onToggleTable={onToggleTable}
							onChange={onChange}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function RowSecuritySchemaNode({
	schema,
	label,
	databaseType,
	depth,
	open,
	draft,
	disabled,
	isSearching,
	expandedKeys,
	onToggle,
	onToggleTable,
	onChange,
}: {
	schema: GroupedSchema;
	label: string;
	databaseType?: string;
	depth: number;
	open: boolean;
	draft: ProjectRowSecurity;
	disabled: boolean;
	isSearching: boolean;
	expandedKeys: Set<string>;
	onToggle: () => void;
	onToggleTable: (object: DatabaseContextObject) => void;
	onChange: (rowSecurity: ProjectRowSecurity) => void;
}) {
	const panelId = `row-security-schema-${toDomId(schema.key)}`;
	return (
		<li>
			<button
				type='button'
				className='flex h-8 w-full items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50'
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${label} schema`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<ChevronRight
					className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
				/>
				<FileExplorerIcon name={schema.schema} type='directory' />
				<span className='min-w-0 flex-1 truncate'>{label}</span>
				{databaseType && (
					<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
						{databaseType}
					</Badge>
				)}
			</button>
			{open && (
				<ul id={panelId}>
					{schema.tables.map((object) => (
						<SensitiveTableRow
							key={rowSecurityTableKey(object)}
							object={object}
							depth={depth + 1}
							open={isSearching || expandedKeys.has(rowSecurityTableKey(object))}
							definition={draft.tables.find(
								(table) => rowSecurityTableKey(table) === rowSecurityTableKey(object),
							)}
							disabled={disabled}
							onToggle={() => onToggleTable(object)}
							onChange={(definition) => onChange(updateDefinition(draft, object, definition))}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function SensitiveTableRow({
	object,
	depth,
	open,
	definition,
	disabled,
	onToggle,
	onChange,
}: {
	object: DatabaseContextObject;
	depth: number;
	open: boolean;
	definition?: SensitiveTableDefinition;
	disabled: boolean;
	onToggle: () => void;
	onChange: (definition?: SensitiveTableDefinition) => void;
}) {
	const selected = new Set(definition?.constraintColumns ?? []);
	const panelId = `row-security-table-${toDomId(rowSecurityTableKey(object))}`;
	return (
		<li>
			<button
				type='button'
				className={cn(
					'flex h-8 w-full items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50',
					definition && 'bg-primary/10',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${object.table} table columns`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				<FileExplorerIcon name={object.table} type='table' />
				<span className='min-w-0 flex-1 truncate'>{object.table}</span>
				{definition && (
					<span className='text-xs text-primary'>{definition.constraintColumns.length} selected</span>
				)}
			</button>
			{open && (
				<ul id={panelId} className='bg-muted/20 py-1'>
					{(object.columns ?? []).length === 0 ? (
						<li
							className='py-2 pr-2 text-xs text-muted-foreground'
							style={{ paddingLeft: `${getTreeNodePadding(depth + 1) + 22}px` }}
						>
							No synced columns available.
						</li>
					) : (
						(object.columns ?? []).map((column) => (
							<li key={column}>
								<label
									className='flex h-8 items-center gap-2 pr-2 text-sm hover:bg-muted/50'
									style={{ paddingLeft: `${getTreeNodePadding(depth + 1) + 22}px` }}
								>
									<Checkbox
										checked={selected.has(column)}
										disabled={disabled}
										aria-label={`${column} constraint column for ${object.table}`}
										onCheckedChange={(checked) => {
											const columns = checked
												? [...selected, column]
												: [...selected].filter((selectedColumn) => selectedColumn !== column);
											onChange(
												columns.length > 0
													? {
															databaseType: object.databaseType,
															database: object.database,
															schema: object.schema,
															table: object.table,
															constraintColumns: columns.sort(),
														}
													: undefined,
											);
										}}
									/>
									<span>{column}</span>
								</label>
							</li>
						))
					)}
				</ul>
			)}
		</li>
	);
}

function TreeStatusRow({ status, onRetry }: { status: string; onRetry?: () => void }) {
	return (
		<div className='flex min-h-10 items-center gap-2 p-3 text-sm text-muted-foreground'>
			<span className='min-w-0 flex-1'>{status}</span>
			{onRetry && (
				<Button type='button' size='sm' variant='ghost' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function toDomId(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
}

export function filterRowSecurityObjects(
	objects: readonly DatabaseContextObject[],
	search: string,
): DatabaseContextObject[] {
	const term = search.trim().toLowerCase();
	if (!term) {
		return [...objects];
	}
	return objects.filter((object) =>
		[object.database, object.schema, object.table, ...(object.columns ?? [])].some((value) =>
			value.toLowerCase().includes(term),
		),
	);
}

function updateDefinition(
	rowSecurity: ProjectRowSecurity,
	object: DatabaseContextObject,
	definition?: SensitiveTableDefinition,
): ProjectRowSecurity {
	const key = rowSecurityTableKey(object);
	return normalizeProjectRowSecurity({
		version: 1,
		tables: [
			...rowSecurity.tables.filter((table) => rowSecurityTableKey(table) !== key),
			...(definition ? [definition] : []),
		],
	});
}

function getUnavailableDefinitions(
	rowSecurity: ProjectRowSecurity,
	objects: DatabaseContextObject[],
): SensitiveTableDefinition[] {
	return rowSecurity.tables.flatMap((definition) => {
		const object = objects.find((candidate) => rowSecurityTableKey(candidate) === rowSecurityTableKey(definition));
		if (!object) {
			return [definition];
		}
		const missingColumns = definition.constraintColumns.filter(
			(column) => !(object.columns ?? []).includes(column),
		);
		return missingColumns.length > 0 ? [{ ...definition, constraintColumns: missingColumns }] : [];
	});
}

function removeUnavailableSelection(
	rowSecurity: ProjectRowSecurity,
	unavailable: SensitiveTableDefinition,
): ProjectRowSecurity {
	const key = rowSecurityTableKey(unavailable);
	const table = rowSecurity.tables.find((candidate) => rowSecurityTableKey(candidate) === key);
	if (!table) {
		return rowSecurity;
	}
	const missing = new Set(unavailable.constraintColumns);
	const remainingColumns = table.constraintColumns.filter((column) => !missing.has(column));
	return normalizeProjectRowSecurity({
		version: 1,
		tables: [
			...rowSecurity.tables.filter((candidate) => rowSecurityTableKey(candidate) !== key),
			...(remainingColumns.length > 0 ? [{ ...table, constraintColumns: remainingColumns }] : []),
		],
	});
}

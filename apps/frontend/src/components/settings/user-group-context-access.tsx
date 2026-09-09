import {
	isDatabaseContextTableGranted,
	matchesDatabaseContextPattern,
	normalizeDatabaseContextAccess,
	normalizeDatabaseContextPatterns,
} from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
	DatabaseContextAccess,
	DatabaseContextGrant,
	DatabaseSchemaGrant,
	DatabaseTableGrant,
	DocsContextAccess,
} from '@nao/shared';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { UserGroupContextModeSelector } from '@/components/settings/user-group-context-mode-selector';
import {
	DocsContextTreeRoot,
	getDocsContextSelectionCount,
	getUnavailableDocsContextGrants,
	UnavailableDocsGrants,
} from '@/components/settings/user-group-docs-context-access';
import { UserGroupSwitchRow } from '@/components/settings/user-group-switch-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
	getAutoExpandKeys,
	getSingleChildFolderChain,
	getTreeNodePadding,
	removeExpandedSubtree,
} from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export interface DatabaseContextObject {
	databaseType: string;
	database: string;
	schema: string;
	table: string;
}

interface UserGroupContextAccessProps {
	databaseAccess: DatabaseContextAccess;
	docsAccess?: DocsContextAccess;
	onDatabaseAccessChange: (access: DatabaseContextAccess) => void;
	onDocsAccessChange?: (access: DocsContextAccess) => void;
}

export function UserGroupContextAccess({
	databaseAccess,
	docsAccess,
	onDatabaseAccessChange,
	onDocsAccessChange = () => undefined,
}: UserGroupContextAccessProps) {
	const catalog = useQuery(trpc.userGroup.contextCatalog.queryOptions());
	const docsCatalog = useQuery(trpc.userGroup.docsContextCatalog.queryOptions());
	const [search, setSearch] = useState('');
	const [draftPattern, setDraftPattern] = useState('');

	const objects = catalog.data?.objects ?? [];
	const docsEntries = docsCatalog.data?.entries ?? [];
	const unavailableGrants =
		catalog.isLoading || catalog.isError ? [] : getUnavailableDatabaseContextGrants(databaseAccess, objects);
	const unavailableDocsGrants =
		docsAccess === undefined || docsCatalog.isLoading || docsCatalog.isError
			? []
			: getUnavailableDocsContextGrants(docsAccess, docsEntries);
	const combinedMode =
		databaseAccess.mode === 'all' && (docsAccess === undefined || docsAccess.mode === 'all') ? 'all' : 'restricted';
	const isSearchEnabled = combinedMode === 'restricted';
	const isSearching = isSearchEnabled && search.trim().length > 0;
	const treeObjects = isSearchEnabled ? filterDatabaseContextObjects(objects, search) : objects;
	const tableSummary = getDatabaseContextTableSelectionSummary(databaseAccess, objects);
	const docsCount = docsAccess === undefined ? undefined : getDocsContextSelectionCount(docsAccess, docsEntries);

	return (
		<div className='flex flex-col gap-4'>
			<p className='text-sm text-muted-foreground'>
				Choose which synced database tables and docs this group can access. Access from groups is combined.
			</p>
			<UserGroupContextModeSelector
				mode={combinedMode}
				everythingDescription='All current and future tables and docs.'
				specificDescription='Choose tables, folders, and files.'
				onEverything={() => {
					onDatabaseAccessChange({ mode: 'all', strict: databaseAccess.strict });
					if (docsAccess !== undefined) {
						onDocsAccessChange({ mode: 'all' });
					}
				}}
				onSpecific={() => {
					if (combinedMode === 'all') {
						onDatabaseAccessChange({
							mode: 'restricted',
							strict: databaseAccess.strict,
							grants: [],
							patterns: [],
						});
						if (docsAccess !== undefined) {
							onDocsAccessChange({ mode: 'restricted', grants: [] });
						}
					}
				}}
			/>
			<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
				{isSearchEnabled && (
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder='Search tables and docs paths'
						aria-label='Search context'
						className='min-w-0'
					/>
				)}
				<Badge variant='secondary' className='w-fit whitespace-nowrap'>
					{tableSummary}
					{docsCount !== undefined && ` · ${docsCount} ${docsCount === 1 ? 'doc' : 'docs'}`}
				</Badge>
			</div>
			<div data-testid='combined-context-tree' className='h-80 overflow-auto rounded-lg border'>
				<ul>
					{catalog.isLoading ? (
						<ContextTreeStatusRow label='Database tables' status='Loading...' />
					) : catalog.isError ? (
						<ContextTreeStatusRow
							label='Database tables'
							status='Failed to load'
							onRetry={() => catalog.refetch()}
						/>
					) : treeObjects.length > 0 ? (
						<DatabaseContextTree
							objects={treeObjects}
							selectionObjects={objects}
							databaseAccess={databaseAccess}
							onChange={onDatabaseAccessChange}
							isSearching={
								isSearching || (databaseAccess.mode === 'restricted' && draftPattern.trim().length > 0)
							}
							draftPattern={draftPattern}
						/>
					) : (
						<ContextTreeStatusRow
							label='Database tables'
							status={isSearching ? 'No matches' : 'No synced tables'}
						/>
					)}
					{docsAccess !== undefined && (
						<DocsContextTreeRoot
							entries={docsEntries}
							access={docsAccess}
							search={isSearchEnabled ? search : ''}
							searching={isSearching}
							syncState={docsCatalog.data?.syncState}
							isLoading={docsCatalog.isLoading}
							isError={docsCatalog.isError}
							disabled={combinedMode === 'all'}
							onRetry={() => docsCatalog.refetch()}
							onChange={onDocsAccessChange}
						/>
					)}
				</ul>
			</div>
			{databaseAccess.mode === 'restricted' && unavailableGrants.length > 0 && (
				<UnavailableSelections
					grants={unavailableGrants}
					databaseAccess={databaseAccess}
					onChange={onDatabaseAccessChange}
				/>
			)}
			{docsAccess?.mode === 'restricted' && unavailableDocsGrants.length > 0 && (
				<UnavailableDocsGrants
					grants={unavailableDocsGrants}
					access={docsAccess}
					onChange={onDocsAccessChange}
				/>
			)}
			{databaseAccess.mode === 'restricted' && (
				<DynamicPatterns
					access={databaseAccess}
					objects={objects}
					draftPattern={draftPattern}
					onDraftPatternChange={setDraftPattern}
					onChange={onDatabaseAccessChange}
				/>
			)}
			<div className='border-t pt-5'>
				<UserGroupSwitchRow
					id='user-group-context-strict'
					label='Strict mode'
					description="Block SQL queries to tables outside the user's combined group access."
					checked={databaseAccess.strict}
					onCheckedChange={(strict) => onDatabaseAccessChange({ ...databaseAccess, strict })}
				/>
			</div>
		</div>
	);
}

function ContextTreeStatusRow({ label, status, onRetry }: { label: string; status: string; onRetry?: () => void }) {
	return (
		<li className='flex h-8 items-center gap-2 px-3 text-sm text-muted-foreground'>
			<span className='min-w-0 flex-1 truncate'>{label}</span>
			<span className={cn('text-xs', status === 'Failed to load' && 'text-destructive')}>{status}</span>
			{onRetry && (
				<Button type='button' size='sm' variant='ghost' className='h-6 px-2 text-xs' onClick={onRetry}>
					Retry
				</Button>
			)}
		</li>
	);
}

function DynamicPatterns({
	access,
	objects,
	draftPattern,
	onDraftPatternChange,
	onChange,
}: {
	access: Extract<DatabaseContextAccess, { mode: 'restricted' }>;
	objects: DatabaseContextObject[];
	draftPattern: string;
	onDraftPatternChange: (pattern: string) => void;
	onChange: (access: DatabaseContextAccess) => void;
}) {
	const normalizedDraft = normalizeDatabaseContextPatterns([draftPattern])[0];
	const draftMatchCount = normalizedDraft ? countPatternMatches(normalizedDraft, objects) : 0;

	const addPattern = () => {
		if (!normalizedDraft) {
			return;
		}
		onChange(
			normalizeDatabaseContextAccess({
				...access,
				patterns: [...access.patterns, normalizedDraft],
			}),
		);
		onDraftPatternChange('');
	};

	return (
		<div className='flex flex-col gap-3 border-t pt-4'>
			<div>
				<h3 className='text-sm font-medium'>Dynamic table patterns</h3>
				<p className='text-xs text-muted-foreground'>
					Match schema.table across every configured database. New matching tables are included after sync.
				</p>
			</div>
			<div className='flex gap-2'>
				<Input
					value={draftPattern}
					onChange={(event) => onDraftPatternChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							addPattern();
						}
					}}
					placeholder='main.* or sales.customer_*'
					aria-label='Dynamic table pattern'
					maxLength={255}
					className='min-w-0'
				/>
				<Button type='button' variant='outline' className='shrink-0 rounded-full' onClick={addPattern}>
					Add pattern
				</Button>
			</div>
			{normalizedDraft && (
				<p className='text-xs text-primary'>
					{draftMatchCount} current {draftMatchCount === 1 ? 'match' : 'matches'} · future matching tables are
					included
				</p>
			)}
			{access.patterns.length > 0 && (
				<ul className='mt-1 rounded-lg border'>
					{access.patterns.map((pattern) => {
						const matchCount = countPatternMatches(pattern, objects);
						return (
							<li
								key={pattern}
								className='flex min-h-10 items-center gap-2 border-b px-3 py-1.5 last:border-b-0'
							>
								<span className='min-w-0 flex-1 break-all font-mono text-xs'>{pattern}</span>
								<span className='shrink-0 text-xs text-muted-foreground'>
									{matchCount} {matchCount === 1 ? 'table' : 'tables'}
								</span>
								<Button
									type='button'
									size='icon'
									variant='ghost'
									className='size-7 shrink-0 rounded-full'
									aria-label={`Remove dynamic pattern ${pattern}`}
									onClick={() =>
										onChange(
											normalizeDatabaseContextAccess({
												...access,
												patterns: access.patterns.filter(
													(savedPattern) => savedPattern !== pattern,
												),
											}),
										)
									}
								>
									<X className='size-3.5' />
								</Button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function DatabaseContextTree({
	objects,
	selectionObjects,
	databaseAccess,
	onChange,
	isSearching,
	draftPattern,
}: {
	objects: DatabaseContextObject[];
	selectionObjects: DatabaseContextObject[];
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
	isSearching: boolean;
	draftPattern: string;
}) {
	const databases = useMemo(() => groupDatabaseContextObjects(objects), [objects]);
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

	if (databases.length === 0) {
		return null;
	}

	const toggleFolder = (folder: GroupedDatabase | GroupedSchema) => {
		setExpandedKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			if (currentKeys.has(folder.key)) {
				removeExpandedSubtree(nextKeys, folder.key, '\0');
			} else {
				for (const key of getAutoExpandKeys(folder, DATABASE_TREE_EXPANSION_ADAPTER)) {
					nextKeys.add(key);
				}
			}
			return nextKeys;
		});
	};

	return (
		<>
			{databases.map((database) => (
				<DatabaseNode
					key={database.key}
					database={database}
					expandedKeys={expandedKeys}
					isSearching={isSearching}
					onToggle={toggleFolder}
					databaseAccess={databaseAccess}
					onChange={onChange}
					draftPattern={draftPattern}
					selectionObjects={selectionObjects}
				/>
			))}
		</>
	);
}

interface GroupedDatabase {
	kind: 'database';
	key: string;
	databaseType: string;
	database: string;
	schemas: GroupedSchema[];
}

interface GroupedSchema {
	kind: 'schema';
	key: string;
	databaseType: string;
	database: string;
	schema: string;
	tables: DatabaseContextObject[];
}

const DATABASE_TREE_EXPANSION_ADAPTER = {
	getKey: (folder: GroupedDatabase | GroupedSchema) => folder.key,
	getChildren: (folder: GroupedDatabase | GroupedSchema): GroupedSchema[] =>
		folder.kind === 'database' ? folder.schemas : [],
	isFolder: () => true,
};

const TREE_ROW_LAYOUT_CLASS =
	'flex h-8 w-full items-center gap-1 pr-2 text-left text-sm transition-colors hover:bg-muted/50';
const PARTIAL_CHECKBOX_CLASS =
	'data-[state=indeterminate]:bg-primary/15 data-[state=indeterminate]:text-primary/70 data-[state=indeterminate]:shadow-none';

function DatabaseNode({
	database,
	expandedKeys,
	isSearching,
	onToggle,
	databaseAccess,
	onChange,
	draftPattern,
	selectionObjects,
}: {
	database: GroupedDatabase;
	expandedKeys: Set<string>;
	isSearching: boolean;
	onToggle: (folder: GroupedDatabase | GroupedSchema) => void;
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
	draftPattern: string;
	selectionObjects: DatabaseContextObject[];
}) {
	const folderChain = getSingleChildFolderChain(database, DATABASE_TREE_EXPANSION_ADAPTER);
	const compactSchema = folderChain.length === 2 ? folderChain[1] : undefined;

	if (compactSchema?.kind === 'schema') {
		return (
			<SchemaRow
				schema={compactSchema}
				label={`${database.database}/${compactSchema.schema}`}
				databaseType={database.databaseType}
				depth={0}
				open={isSearching || expandedKeys.has(compactSchema.key)}
				onToggle={() => onToggle(compactSchema)}
				databaseAccess={databaseAccess}
				onChange={onChange}
				draftPattern={draftPattern}
				selectionObjects={selectionObjects}
			/>
		);
	}

	const open = isSearching || expandedKeys.has(database.key);
	const panelId = `database-${toDomId(database.key)}`;
	const inherited = databaseAccess.mode === 'all';
	const partial =
		!inherited &&
		selectionObjects.some(
			(object) =>
				object.databaseType === database.databaseType &&
				object.database === database.database &&
				isDatabaseContextTableGranted(databaseAccess, object),
		);

	return (
		<li>
			<button
				type='button'
				className={cn(
					'flex h-8 w-full items-center gap-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
					inherited && 'bg-primary/10 text-primary hover:bg-primary/15',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(0)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${database.database} database`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => onToggle(database)}
			>
				<ChevronRight
					className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
				/>
				<FileExplorerIcon
					name={database.database}
					type='directory'
					className={cn(inherited && 'text-primary')}
				/>
				<span className='min-w-0 flex-1 truncate font-medium' title={database.database}>
					{database.database}
				</span>
				{partial && <span className='shrink-0 text-[10px] text-muted-foreground'>Partial</span>}
				<Badge variant='secondary' className='h-5 shrink-0 px-1.5 text-[10px] font-normal'>
					{database.databaseType}
				</Badge>
			</button>
			{open && (
				<ul id={panelId}>
					{database.schemas.map((schema) => (
						<SchemaRow
							key={schema.key}
							schema={schema}
							label={schema.schema}
							depth={1}
							open={isSearching || expandedKeys.has(schema.key)}
							onToggle={() => onToggle(schema)}
							databaseAccess={databaseAccess}
							onChange={onChange}
							draftPattern={draftPattern}
							selectionObjects={selectionObjects}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function SchemaRow({
	schema,
	label,
	databaseType,
	depth,
	open,
	onToggle,
	databaseAccess,
	onChange,
	draftPattern,
	selectionObjects,
}: {
	schema: GroupedSchema;
	label: string;
	databaseType?: string;
	depth: number;
	open: boolean;
	onToggle: () => void;
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
	draftPattern: string;
	selectionObjects: DatabaseContextObject[];
}) {
	const schemaGrant: DatabaseSchemaGrant = {
		kind: 'schema',
		databaseType: schema.databaseType,
		database: schema.database,
		schema: schema.schema,
	};
	const explicitSchema = hasDatabaseContextGrant(databaseAccess, schemaGrant);
	const inherited = databaseAccess.mode === 'all';
	const selected = inherited || explicitSchema;
	const partial =
		!selected &&
		selectionObjects.some(
			(object) => sameSchema(object, schema) && isDatabaseContextTableGranted(databaseAccess, object),
		);
	const panelId = `schema-${toDomId(schema.key)}`;

	return (
		<li>
			<div
				className={cn(TREE_ROW_LAYOUT_CLASS, selected && 'bg-primary/10 text-primary hover:bg-primary/15')}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			>
				<button
					type='button'
					className='flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${label} folder`}
					aria-expanded={open}
					aria-controls={panelId}
					onClick={onToggle}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					checked={partial ? 'indeterminate' : selected}
					aria-label={`${label} schema access`}
					disabled={inherited}
					className={cn('disabled:cursor-default', PARTIAL_CHECKBOX_CLASS)}
					onCheckedChange={(checked) =>
						onChange(toggleDatabaseSchemaGrant(databaseAccess, schemaGrant, checked === true))
					}
				/>
				<button
					type='button'
					aria-expanded={open}
					aria-controls={panelId}
					onClick={onToggle}
					className='flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
				>
					<FileExplorerIcon
						name={schema.schema}
						type='directory'
						className={cn(selected && 'text-primary')}
					/>
					<span className='min-w-0 flex-1 truncate' title={label}>
						{label}
					</span>
					{inherited && <span className='shrink-0 text-[10px] text-primary/80'>Inherited</span>}
					{partial && <span className='shrink-0 text-[10px] text-muted-foreground'>Partial</span>}
					{databaseType && (
						<Badge variant='secondary' className='h-5 shrink-0 px-1.5 text-[10px] font-normal'>
							{databaseType}
						</Badge>
					)}
				</button>
			</div>
			{open && (
				<ul id={panelId}>
					{schema.tables.map((object) => (
						<TableRow
							key={databaseContextObjectKey(object)}
							object={object}
							depth={depth + 1}
							databaseAccess={databaseAccess}
							parentSchemaExplicit={explicitSchema}
							onChange={onChange}
							draftPattern={draftPattern}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function TableRow({
	object,
	depth,
	databaseAccess,
	parentSchemaExplicit,
	onChange,
	draftPattern,
}: {
	object: DatabaseContextObject;
	depth: number;
	databaseAccess: DatabaseContextAccess;
	parentSchemaExplicit: boolean;
	onChange: (access: DatabaseContextAccess) => void;
	draftPattern: string;
}) {
	const grant: DatabaseTableGrant = { kind: 'table', ...object };
	const patternInherited =
		databaseAccess.mode === 'restricted' &&
		databaseAccess.patterns.some((pattern) => matchesDatabaseContextPattern(pattern, object));
	const inherited = databaseAccess.mode === 'all' || parentSchemaExplicit || patternInherited;
	const selected = inherited || hasDatabaseContextGrant(databaseAccess, grant);
	const previewed = draftPattern.trim().length > 0 && matchesDatabaseContextPattern(draftPattern, object);

	return (
		<li>
			<div
				className={cn(
					TREE_ROW_LAYOUT_CLASS,
					previewed && !selected && 'bg-primary/5 hover:bg-primary/10',
					selected && 'bg-primary/10 text-primary hover:bg-primary/15',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			>
				<span className='size-4 shrink-0' />
				<Checkbox
					checked={selected}
					aria-label={`${object.table} table access`}
					disabled={inherited}
					title={
						patternInherited
							? 'Allowed by a dynamic pattern. Remove the pattern to revoke access.'
							: undefined
					}
					className='disabled:cursor-default'
					onCheckedChange={(checked) =>
						onChange(toggleDatabaseTableGrant(databaseAccess, grant, checked === true))
					}
				/>
				<FileExplorerIcon name={object.table} type='table' />
				<span className='min-w-0 flex-1 truncate' title={object.table}>
					{object.table}
				</span>
				{inherited && <span className='shrink-0 text-[10px] text-primary/80'>Inherited</span>}
			</div>
		</li>
	);
}

function UnavailableSelections({
	grants,
	databaseAccess,
	onChange,
}: {
	grants: DatabaseContextGrant[];
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
}) {
	return (
		<div className='flex flex-col gap-2 border-t pt-4'>
			<div>
				<h3 className='text-sm font-medium'>Unavailable table selections</h3>
				<p className='text-xs text-muted-foreground'>These saved selections are not in the latest sync.</p>
			</div>
			<ul className='rounded-lg border'>
				{grants.map((grant) => (
					<li
						key={databaseContextGrantKey(grant)}
						className='flex min-h-11 items-center gap-3 border-b px-3 last:border-b-0'
					>
						<Checkbox
							checked
							aria-label={`Remove unavailable selection ${formatGrant(grant)}`}
							onCheckedChange={(checked) => {
								if (checked !== true) {
									onChange(removeDatabaseContextGrant(databaseAccess, grant));
								}
							}}
						/>
						<span className='min-w-0 break-all text-sm'>{formatGrant(grant)}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function toggleDatabaseSchemaGrant(
	access: DatabaseContextAccess,
	schema: DatabaseSchemaGrant,
	checked: boolean,
): DatabaseContextAccess {
	if (access.mode === 'all') {
		return access;
	}
	const remaining = access.grants.filter((grant) => !sameSchema(grant, schema));
	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		strict: access.strict,
		grants: checked ? [...remaining, schema] : remaining,
		patterns: access.patterns,
	});
}

export function toggleDatabaseTableGrant(
	access: DatabaseContextAccess,
	table: DatabaseTableGrant,
	checked: boolean,
): DatabaseContextAccess {
	if (access.mode === 'all' || access.grants.some((grant) => grant.kind === 'schema' && sameSchema(grant, table))) {
		return access;
	}
	const remaining = access.grants.filter(
		(grant) => databaseContextGrantKey(grant) !== databaseContextGrantKey(table),
	);
	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		strict: access.strict,
		grants: checked ? [...remaining, table] : remaining,
		patterns: access.patterns,
	});
}

export function getUnavailableDatabaseContextGrants(
	access: DatabaseContextAccess,
	objects: readonly DatabaseContextObject[],
): DatabaseContextGrant[] {
	if (access.mode === 'all') {
		return [];
	}
	return access.grants.filter((grant) => !objects.some((object) => databaseContextGrantMatchesObject(grant, object)));
}

export function filterDatabaseContextObjects(
	objects: readonly DatabaseContextObject[],
	search: string,
): DatabaseContextObject[] {
	const query = search.trim().toLocaleLowerCase();
	if (!query) {
		return [...objects];
	}
	return objects.filter((object) =>
		[object.databaseType, object.database, object.schema, object.table].some((value) =>
			value.toLocaleLowerCase().includes(query),
		),
	);
}

export function getDatabaseContextTableSelectionSummary(
	access: DatabaseContextAccess,
	objects: readonly DatabaseContextObject[],
): string {
	const selectedTableKeys = new Set(
		objects.filter((object) => isDatabaseContextTableGranted(access, object)).map(databaseContextObjectKey),
	);
	const count = selectedTableKeys.size;
	return `${count} ${count === 1 ? 'table' : 'tables'}`;
}

function removeDatabaseContextGrant(
	access: DatabaseContextAccess,
	grantToRemove: DatabaseContextGrant,
): DatabaseContextAccess {
	if (access.mode === 'all') {
		return access;
	}
	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		strict: access.strict,
		grants: access.grants.filter(
			(grant) => databaseContextGrantKey(grant) !== databaseContextGrantKey(grantToRemove),
		),
		patterns: access.patterns,
	});
}

function hasDatabaseContextGrant(access: DatabaseContextAccess, grantToFind: DatabaseContextGrant): boolean {
	return (
		access.mode === 'restricted' &&
		access.grants.some((grant) => databaseContextGrantKey(grant) === databaseContextGrantKey(grantToFind))
	);
}

function groupDatabaseContextObjects(objects: DatabaseContextObject[]) {
	const databases = new Map<
		string,
		{
			kind: 'database';
			key: string;
			databaseType: string;
			database: string;
			schemas: Map<string, GroupedSchema>;
		}
	>();
	for (const object of objects) {
		const databaseKey = [object.databaseType, object.database].join('\0');
		const database = databases.get(databaseKey) ?? {
			kind: 'database' as const,
			key: databaseKey,
			databaseType: object.databaseType,
			database: object.database,
			schemas: new Map<string, GroupedSchema>(),
		};
		const schemaKey = [databaseKey, object.schema].join('\0');
		const schema = database.schemas.get(schemaKey) ?? {
			kind: 'schema' as const,
			key: schemaKey,
			databaseType: object.databaseType,
			database: object.database,
			schema: object.schema,
			tables: [],
		};
		schema.tables.push(object);
		database.schemas.set(schemaKey, schema);
		databases.set(databaseKey, database);
	}
	return [...databases.values()].map((database) => ({
		...database,
		schemas: [...database.schemas.values()],
	}));
}

function databaseContextObjectKey(object: DatabaseContextObject): string {
	return [object.databaseType, object.database, object.schema, object.table].join('\0');
}

function databaseContextGrantKey(grant: DatabaseContextGrant): string {
	return [
		grant.kind,
		grant.databaseType,
		grant.database,
		grant.schema,
		grant.kind === 'table' ? grant.table : '',
	].join('\0');
}

function sameSchema(
	left: Pick<DatabaseContextObject, 'databaseType' | 'database' | 'schema'>,
	right: Pick<DatabaseContextObject, 'databaseType' | 'database' | 'schema'>,
): boolean {
	return left.databaseType === right.databaseType && left.database === right.database && left.schema === right.schema;
}

function databaseContextGrantMatchesObject(grant: DatabaseContextGrant, object: DatabaseContextObject): boolean {
	return sameSchema(grant, object) && (grant.kind === 'schema' || grant.table === object.table);
}

function countPatternMatches(pattern: string, objects: readonly DatabaseContextObject[]): number {
	return new Set(
		objects.filter((object) => matchesDatabaseContextPattern(pattern, object)).map(databaseContextObjectKey),
	).size;
}

function toDomId(value: string): string {
	return encodeURIComponent(value).replaceAll('%', '-');
}

function formatGrant(grant: DatabaseContextGrant): string {
	return [grant.database, grant.schema, grant.kind === 'table' ? grant.table : 'All tables'].join(' / ');
}

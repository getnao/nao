import { normalizeDatabaseContextAccess } from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DatabaseContextAccess, DatabaseContextGrant, DatabaseSchemaGrant, DatabaseTableGrant } from '@nao/shared';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
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
	onDatabaseAccessChange: (access: DatabaseContextAccess) => void;
}

export function UserGroupContextAccess({ databaseAccess, onDatabaseAccessChange }: UserGroupContextAccessProps) {
	const catalog = useQuery(trpc.userGroup.contextCatalog.queryOptions());
	const [search, setSearch] = useState('');

	const objects = catalog.data?.objects ?? [];
	const unavailableGrants =
		catalog.isLoading || catalog.isError ? [] : getUnavailableDatabaseContextGrants(databaseAccess, objects);
	const hasSyncedObjects = catalog.data?.syncState === 'ready' && objects.length > 0;
	const isSearchEnabled = databaseAccess.mode === 'restricted';
	const isSearching = isSearchEnabled && search.trim().length > 0;
	const treeObjects = isSearchEnabled ? filterDatabaseContextObjects(objects, search) : objects;

	return (
		<div className='flex flex-col gap-4'>
			<p className='text-sm text-muted-foreground'>
				Choose which synced database tables this group can access. Access from groups is combined.
			</p>
			<ContextAccessModeSelector access={databaseAccess} onChange={onDatabaseAccessChange} />
			{catalog.isLoading ? (
				<div className='flex min-h-40 items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground'>
					Loading synced database tables...
				</div>
			) : catalog.isError ? (
				<div className='flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center'>
					<p className='text-sm text-destructive'>Failed to load synced database tables.</p>
					<Button size='sm' variant='outline' onClick={() => catalog.refetch()}>
						Retry
					</Button>
				</div>
			) : hasSyncedObjects ? (
				<>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
						{isSearchEnabled && (
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder='Search databases, schemas, or tables'
								aria-label='Search database context'
								className='min-w-0'
							/>
						)}
						<Badge variant='secondary' className='w-fit whitespace-nowrap'>
							{getDatabaseContextTableSelectionSummary(databaseAccess, objects)}
						</Badge>
					</div>
					<DatabaseContextTree
						objects={treeObjects}
						databaseAccess={databaseAccess}
						onChange={onDatabaseAccessChange}
						isSearching={isSearching}
					/>
					{databaseAccess.mode === 'restricted' && unavailableGrants.length > 0 && (
						<UnavailableSelections
							grants={unavailableGrants}
							databaseAccess={databaseAccess}
							onChange={onDatabaseAccessChange}
						/>
					)}
				</>
			) : (
				<div className='flex min-h-40 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
					No synced database tables found. Run nao sync to populate this list.
				</div>
			)}
		</div>
	);
}

function ContextAccessModeSelector({
	access,
	onChange,
}: {
	access: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
}) {
	return (
		<div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
			<AccessModeButton
				title='Everything'
				description='All synced tables, including future tables.'
				selected={access.mode === 'all'}
				onClick={() => onChange({ mode: 'all' })}
			/>
			<AccessModeButton
				title='Specific selection'
				description='Choose schemas and tables.'
				selected={access.mode === 'restricted'}
				onClick={() => {
					if (access.mode === 'all') {
						onChange({ mode: 'restricted', grants: [] });
					}
				}}
			/>
		</div>
	);
}

function AccessModeButton({
	title,
	description,
	selected,
	onClick,
}: {
	title: string;
	description: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				'min-h-16 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
				selected && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
			)}
		>
			<span className='block text-sm font-medium'>{title}</span>
			<span className={cn('block text-xs text-muted-foreground', selected && 'text-primary/80')}>
				{description}
			</span>
		</button>
	);
}

function DatabaseContextTree({
	objects,
	databaseAccess,
	onChange,
	isSearching,
}: {
	objects: DatabaseContextObject[];
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
	isSearching: boolean;
}) {
	const databases = useMemo(() => groupDatabaseContextObjects(objects), [objects]);
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

	if (databases.length === 0) {
		return (
			<div className='flex h-80 items-center justify-center rounded-lg border text-sm text-muted-foreground'>
				No matching tables.
			</div>
		);
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
		<div className='h-80 overflow-auto rounded-lg border'>
			<ul>
				{databases.map((database) => (
					<DatabaseNode
						key={database.key}
						database={database}
						expandedKeys={expandedKeys}
						isSearching={isSearching}
						onToggle={toggleFolder}
						databaseAccess={databaseAccess}
						onChange={onChange}
					/>
				))}
			</ul>
		</div>
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

function DatabaseNode({
	database,
	expandedKeys,
	isSearching,
	onToggle,
	databaseAccess,
	onChange,
}: {
	database: GroupedDatabase;
	expandedKeys: Set<string>;
	isSearching: boolean;
	onToggle: (folder: GroupedDatabase | GroupedSchema) => void;
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
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
			/>
		);
	}

	const open = isSearching || expandedKeys.has(database.key);
	const panelId = `database-${toDomId(database.key)}`;
	const inherited = databaseAccess.mode === 'all';

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
					className={inherited ? 'text-primary' : undefined}
				/>
				<span className='min-w-0 flex-1 truncate font-medium' title={database.database}>
					{database.database}
				</span>
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
}: {
	schema: GroupedSchema;
	label: string;
	databaseType?: string;
	depth: number;
	open: boolean;
	onToggle: () => void;
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
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
					checked={selected}
					aria-label={`${label} schema access`}
					disabled={inherited}
					className='disabled:cursor-default'
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
						className={selected ? 'text-primary' : undefined}
					/>
					<span className='min-w-0 flex-1 truncate' title={label}>
						{label}
					</span>
					{inherited && <span className='shrink-0 text-[10px] text-primary/80'>Inherited</span>}
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
}: {
	object: DatabaseContextObject;
	depth: number;
	databaseAccess: DatabaseContextAccess;
	parentSchemaExplicit: boolean;
	onChange: (access: DatabaseContextAccess) => void;
}) {
	const grant: DatabaseTableGrant = { kind: 'table', ...object };
	const inherited = databaseAccess.mode === 'all' || parentSchemaExplicit;
	const selected = inherited || hasDatabaseContextGrant(databaseAccess, grant);

	return (
		<li>
			<div
				className={cn(TREE_ROW_LAYOUT_CLASS, selected && 'bg-primary/10 text-primary hover:bg-primary/15')}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			>
				<span className='size-4 shrink-0' />
				<Checkbox
					checked={selected}
					aria-label={`${object.table} table access`}
					disabled={inherited}
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
				<h3 className='text-sm font-medium'>Unavailable selections</h3>
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
		grants: checked ? [...remaining, schema] : remaining,
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
		grants: checked ? [...remaining, table] : remaining,
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
		objects
			.filter(
				(object) =>
					access.mode === 'all' ||
					access.grants.some((grant) => databaseContextGrantMatchesObject(grant, object)),
			)
			.map(databaseContextObjectKey),
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
		grants: access.grants.filter(
			(grant) => databaseContextGrantKey(grant) !== databaseContextGrantKey(grantToRemove),
		),
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

function toDomId(value: string): string {
	return encodeURIComponent(value).replaceAll('%', '-');
}

function formatGrant(grant: DatabaseContextGrant): string {
	return [grant.database, grant.schema, grant.kind === 'table' ? grant.table : 'All tables'].join(' / ');
}

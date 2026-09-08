import { normalizeDatabaseContextAccess } from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { DatabaseContextAccess, DatabaseContextGrant, DatabaseSchemaGrant, DatabaseTableGrant } from '@nao/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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

	return (
		<div className='flex flex-col gap-4'>
			<p className='text-sm text-muted-foreground'>
				Choose which synced database tables this group can access. Access from groups is combined.
			</p>
			<EverythingAccessCard access={databaseAccess} onChange={onDatabaseAccessChange} />
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
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder='Search databases, schemas, or tables'
							aria-label='Search database context'
							className='min-w-0'
						/>
						<Badge variant='secondary' className='w-fit whitespace-nowrap'>
							{getDatabaseContextSelectionSummary(databaseAccess)}
						</Badge>
					</div>
					<DatabaseContextTree
						objects={filterDatabaseContextObjects(objects, search)}
						databaseAccess={databaseAccess}
						onChange={onDatabaseAccessChange}
						searching={search.trim().length > 0}
					/>
				</>
			) : (
				<div className='flex min-h-40 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
					No synced database tables found. Run nao sync to populate this list.
				</div>
			)}
			{unavailableGrants.length > 0 && (
				<UnavailableSelections
					grants={unavailableGrants}
					databaseAccess={databaseAccess}
					onChange={onDatabaseAccessChange}
				/>
			)}
		</div>
	);
}

function EverythingAccessCard({
	access,
	onChange,
}: {
	access: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
}) {
	const id = useId();
	return (
		<label htmlFor={id} className='flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3'>
			<Checkbox
				id={id}
				checked={getEverythingCheckboxState(access)}
				onCheckedChange={(checked) =>
					onChange(checked === true ? { mode: 'all' } : { mode: 'restricted', grants: [] })
				}
			/>
			<span className='min-w-0'>
				<span className='block text-sm font-medium'>Everything</span>
				<span className='block text-xs text-muted-foreground'>
					All synced database tables, including future tables.
				</span>
			</span>
		</label>
	);
}

export function getEverythingCheckboxState(access: DatabaseContextAccess): boolean | 'indeterminate' {
	if (access.mode === 'all') {
		return true;
	}
	return access.grants.length > 0 ? 'indeterminate' : false;
}

function DatabaseContextTree({
	objects,
	databaseAccess,
	onChange,
	searching,
}: {
	objects: DatabaseContextObject[];
	databaseAccess: DatabaseContextAccess;
	onChange: (access: DatabaseContextAccess) => void;
	searching: boolean;
}) {
	const databases = useMemo(() => groupDatabaseContextObjects(objects), [objects]);
	const [collapsedDatabases, setCollapsedDatabases] = useState<Set<string>>(new Set());
	const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());

	if (databases.length === 0) {
		return (
			<div className='flex h-80 items-center justify-center rounded-lg border text-sm text-muted-foreground'>
				No matching tables.
			</div>
		);
	}

	return (
		<div className='h-80 overflow-auto rounded-lg border'>
			<ul className='divide-y'>
				{databases.map((database) => {
					const databaseOpen = searching || !collapsedDatabases.has(database.key);
					const databasePanelId = `database-${toDomId(database.key)}`;
					return (
						<li key={database.key}>
							<button
								type='button'
								className='flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-muted/50'
								aria-expanded={databaseOpen}
								aria-controls={databasePanelId}
								onClick={() =>
									setCollapsedDatabases((current) =>
										toggleSetValue(current, database.key, !databaseOpen),
									)
								}
							>
								<ChevronRight
									className={cn('size-4 shrink-0 transition-transform', databaseOpen && 'rotate-90')}
								/>
								<span className='min-w-0 flex-1 truncate text-sm font-medium' title={database.database}>
									{database.database}
								</span>
								<Badge variant='secondary' className='shrink-0 font-normal'>
									{database.databaseType}
								</Badge>
							</button>
							{databaseOpen && (
								<ul id={databasePanelId} className='border-t bg-muted/10 py-1'>
									{database.schemas.map((schema) => {
										const schemaOpen = searching || expandedSchemas.has(schema.key);
										return (
											<SchemaRow
												key={schema.key}
												schema={schema}
												open={schemaOpen}
												onOpenChange={(open) =>
													setExpandedSchemas((current) =>
														toggleSetValue(current, schema.key, !open),
													)
												}
												databaseAccess={databaseAccess}
												onChange={onChange}
											/>
										);
									})}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

interface GroupedSchema {
	key: string;
	databaseType: string;
	database: string;
	schema: string;
	tables: DatabaseContextObject[];
}

function SchemaRow({
	schema,
	open,
	onOpenChange,
	databaseAccess,
	onChange,
}: {
	schema: GroupedSchema;
	open: boolean;
	onOpenChange: (open: boolean) => void;
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
	const explicitTableCount =
		databaseAccess.mode === 'restricted'
			? databaseAccess.grants.filter(
					(grant) =>
						grant.kind === 'table' &&
						sameSchema(grant, schemaGrant) &&
						schema.tables.some((table) => table.table === grant.table),
				).length
			: 0;
	const disabled = databaseAccess.mode === 'all';
	const panelId = `schema-${toDomId(schema.key)}`;

	return (
		<li>
			<div className='flex min-h-11 items-center gap-2 px-3 pl-7'>
				<button
					type='button'
					className='flex size-8 shrink-0 items-center justify-center rounded hover:bg-muted'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${schema.schema} schema`}
					aria-expanded={open}
					aria-controls={panelId}
					onClick={() => onOpenChange(!open)}
				>
					<ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					id={`${panelId}-checkbox`}
					checked={
						databaseAccess.mode === 'all'
							? true
							: explicitSchema
								? true
								: explicitTableCount > 0
									? 'indeterminate'
									: false
					}
					disabled={disabled}
					onCheckedChange={(checked) =>
						onChange(toggleDatabaseSchemaGrant(databaseAccess, schemaGrant, checked === true))
					}
				/>
				<label
					htmlFor={`${panelId}-checkbox`}
					className={cn(
						'min-w-0 flex-1 truncate text-sm',
						disabled ? 'cursor-not-allowed' : 'cursor-pointer',
					)}
					title={schema.schema}
				>
					{schema.schema}
				</label>
			</div>
			{open && (
				<ul id={panelId} className='pb-1'>
					{schema.tables.map((object) => (
						<TableRow
							key={databaseContextObjectKey(object)}
							object={object}
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
	databaseAccess,
	parentSchemaExplicit,
	onChange,
}: {
	object: DatabaseContextObject;
	databaseAccess: DatabaseContextAccess;
	parentSchemaExplicit: boolean;
	onChange: (access: DatabaseContextAccess) => void;
}) {
	const grant: DatabaseTableGrant = { kind: 'table', ...object };
	const id = `table-${toDomId(databaseContextObjectKey(object))}`;
	const disabled = databaseAccess.mode === 'all' || parentSchemaExplicit;
	const checked = disabled || hasDatabaseContextGrant(databaseAccess, grant);

	return (
		<li className='flex min-h-10 items-center gap-2 px-3 pl-[4.75rem]'>
			<Checkbox
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={(value) => onChange(toggleDatabaseTableGrant(databaseAccess, grant, value === true))}
			/>
			<label
				htmlFor={id}
				className={cn('min-w-0 flex-1 break-words text-sm', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
			>
				{object.table}
			</label>
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
	return access.grants.filter((grant) =>
		grant.kind === 'schema'
			? !objects.some((object) => sameSchema(object, grant))
			: !objects.some(
					(object) =>
						databaseContextGrantKey({ kind: 'table', ...object }) === databaseContextGrantKey(grant),
				),
	);
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

export function getDatabaseContextSelectionSummary(access: DatabaseContextAccess): string {
	if (access.mode === 'all') {
		return 'Everything selected';
	}
	const schemas = access.grants.filter((grant) => grant.kind === 'schema').length;
	const tables = access.grants.length - schemas;
	if (schemas === 0 && tables === 0) {
		return 'Nothing selected';
	}
	return `${schemas} ${schemas === 1 ? 'schema' : 'schemas'}, ${tables} ${tables === 1 ? 'table' : 'tables'}`;
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
			key: string;
			databaseType: string;
			database: string;
			schemas: Map<string, GroupedSchema>;
		}
	>();
	for (const object of objects) {
		const databaseKey = [object.databaseType, object.database].join('\0');
		const database = databases.get(databaseKey) ?? {
			key: databaseKey,
			databaseType: object.databaseType,
			database: object.database,
			schemas: new Map<string, GroupedSchema>(),
		};
		const schemaKey = [databaseKey, object.schema].join('\0');
		const schema = database.schemas.get(schemaKey) ?? {
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

function toggleSetValue(current: Set<string>, value: string, remove: boolean): Set<string> {
	const next = new Set(current);
	if (remove) {
		next.delete(value);
	} else {
		next.add(value);
	}
	return next;
}

function toDomId(value: string): string {
	return encodeURIComponent(value).replaceAll('%', '-');
}

function formatGrant(grant: DatabaseContextGrant): string {
	return [grant.database, grant.schema, grant.kind === 'table' ? grant.table : 'All tables'].join(' / ');
}

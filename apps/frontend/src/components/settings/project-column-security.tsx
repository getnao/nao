import { EMPTY_PROJECT_COLUMN_SECURITY, normalizeProjectColumnSecurity } from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LockKeyhole, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectColumnSecurity, SensitiveColumnDefinition } from '@nao/shared';
import type { Dispatch, SetStateAction } from 'react';

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
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { useLicenseFeatures } from '@/hooks/use-license';
import { getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type ColumnSecurityDialog = { mode: 'add' } | { mode: 'edit'; definition: SensitiveColumnDefinition };

export function ProjectColumnSecurity({
	objects,
	catalogState = 'ready',
}: {
	objects: DatabaseContextObject[];
	catalogState?: 'loading' | 'error' | 'ready';
}) {
	const queryClient = useQueryClient();
	const security = useQuery(trpc.userGroup.columnSecurity.queryOptions());
	const license = useLicenseFeatures();
	const update = useMutation(
		trpc.userGroup.updateColumnSecurity.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.userGroup.columnSecurity.queryKey() });
			},
		}),
	);
	const registry = normalizeProjectColumnSecurity(security.data ?? EMPTY_PROJECT_COLUMN_SECURITY);
	const isLicensed = license.data?.['row-level-security'] === true;
	const [dialog, setDialog] = useState<ColumnSecurityDialog | null>(null);
	const [dialogBase, setDialogBase] = useState<ProjectColumnSecurity>(EMPTY_PROJECT_COLUMN_SECURITY);
	const [dialogDraft, setDialogDraft] = useState<ProjectColumnSecurity>(EMPTY_PROJECT_COLUMN_SECURITY);
	const [search, setSearch] = useState('');
	const [manualExpandedKeys, setManualExpandedKeys] = useState<Set<string>>(() => new Set());
	const [removeTarget, setRemoveTarget] = useState<SensitiveColumnDefinition | null>(null);
	const visibleObjects = useMemo(() => filterObjects(objects, search), [objects, search]);
	const unavailableByTable =
		catalogState === 'ready'
			? new Map(
					getUnavailableDefinitions(registry, objects).map((definition) => [
						tableKey(definition),
						definition,
					]),
				)
			: new Map<string, SensitiveColumnDefinition>();
	const columnCount = registry.tables.reduce((total, table) => total + table.restrictedColumns.length, 0);
	const draftColumnCount = dialogDraft.tables.reduce((total, table) => total + table.restrictedColumns.length, 0);

	const openAddDialog = () => {
		const snapshot = cloneColumnSecurity(registry);
		setDialogBase(snapshot);
		setDialogDraft(snapshot);
		setSearch('');
		setManualExpandedKeys(new Set());
		setDialog({ mode: 'add' });
	};

	const openEditDialog = (definition: SensitiveColumnDefinition) => {
		setDialogBase(cloneColumnSecurity(registry));
		setDialog({
			mode: 'edit',
			definition: cloneDefinition(definition),
		});
	};

	const openRemoveDialog = (definition: SensitiveColumnDefinition) => {
		setDialogBase(cloneColumnSecurity(registry));
		setRemoveTarget(definition);
	};

	const saveDialog = () => {
		if (!dialog) {
			return;
		}
		const nextRegistry =
			dialog.mode === 'add'
				? normalizeProjectColumnSecurity(dialogDraft)
				: replaceDefinition(registry, dialog.definition);
		update.mutate(
			{ ...nextRegistry, expectedCurrent: dialogBase },
			{
				onSuccess: () => {
					setDialog(null);
				},
			},
		);
	};

	const removeTable = () => {
		if (!removeTarget) {
			return;
		}
		update.mutate(
			{ ...replaceDefinition(registry, removeTarget, true), expectedCurrent: dialogBase },
			{
				onSuccess: () => {
					setRemoveTarget(null);
				},
			},
		);
	};

	return (
		<>
			<SettingsCard
				title='Sensitive fields'
				description='Choose fields to hide by default, then make them visible to selected groups in Data access. Also known as column-level security.'
				action={!isLicensed ? <UpgradeToEnterprise /> : undefined}
				unstyled
			>
				{!isLicensed && registry.tables.length > 0 && (
					<p className='text-xs text-muted-foreground'>
						Queries on tables with sensitive fields are blocked until the license is restored. Remove tables
						to unblock them.
					</p>
				)}
				<div className='flex items-center justify-between gap-3'>
					<Badge variant='secondary' className='shrink-0'>
						{registry.tables.length} {registry.tables.length === 1 ? 'table' : 'tables'} · {columnCount}{' '}
						{columnCount === 1 ? 'field' : 'fields'}
					</Badge>
					<Button
						type='button'
						disabled={!isLicensed || security.isLoading || security.isError}
						onClick={openAddDialog}
					>
						<Plus />
						Mark sensitive fields
					</Button>
				</div>
				<div className='overflow-hidden rounded-lg border' role='region' aria-label='Sensitive fields'>
					{security.isLoading ? (
						<StatusRow status='Loading security settings...' />
					) : security.isError ? (
						<StatusRow status='Failed to load security settings' onRetry={() => void security.refetch()} />
					) : registry.tables.length === 0 ? (
						<div className='flex flex-col items-center gap-2 px-4 py-8 text-center'>
							<p className='text-sm font-medium'>No sensitive fields</p>
							<p className='max-w-md text-xs text-muted-foreground'>
								Mark fields that should be hidden unless a group is allowed to see them.
							</p>
							<Button
								type='button'
								size='sm'
								variant='outline'
								className='rounded-full'
								disabled={!isLicensed}
								onClick={openAddDialog}
							>
								Mark sensitive fields
							</Button>
						</div>
					) : (
						<div className='divide-y'>
							{registry.tables.map((definition) => (
								<RestrictedColumnSummary
									key={tableKey(definition)}
									definition={definition}
									object={objects.find((object) => tableKey(object) === tableKey(definition))}
									unavailable={unavailableByTable.get(tableKey(definition))}
									catalogState={catalogState}
									editDisabled={!isLicensed}
									onEdit={() => openEditDialog(definition)}
									onRemove={() => openRemoveDialog(definition)}
								/>
							))}
						</div>
					)}
				</div>
				{catalogState === 'loading' && !security.isLoading && (
					<p className='text-xs text-muted-foreground'>Loading synced tables...</p>
				)}
				{catalogState === 'error' && !security.isLoading && (
					<p className='text-xs text-destructive'>Failed to load synced tables.</p>
				)}
			</SettingsCard>

			<Dialog
				open={dialog !== null}
				onOpenChange={(open) => {
					if (!open && !update.isPending) {
						setDialog(null);
					}
				}}
			>
				{dialog?.mode === 'add' ? (
					<DialogContent className='grid h-[min(46rem,calc(100vh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-3xl'>
						<DialogHeader>
							<DialogTitle>Mark sensitive fields</DialogTitle>
							<DialogDescription>
								Expand a table and select fields to hide by default. You can make them visible to
								specific groups from Data access.
							</DialogDescription>
						</DialogHeader>
						<div className='flex items-center gap-2'>
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder='Search databases, schemas, tables, and fields'
								aria-label='Search sensitive fields'
								autoFocus
							/>
							<Badge variant='secondary' className='shrink-0'>
								{dialogDraft.tables.length} {dialogDraft.tables.length === 1 ? 'table' : 'tables'} ·{' '}
								{draftColumnCount} {draftColumnCount === 1 ? 'field' : 'fields'}
							</Badge>
						</div>
						<div className='min-h-0 overflow-auto rounded-lg border'>
							{catalogState === 'loading' ? (
								<StatusRow status='Loading synced tables...' />
							) : catalogState === 'error' ? (
								<StatusRow status='Failed to load synced tables.' />
							) : visibleObjects.length === 0 ? (
								<StatusRow status={search ? 'No matching tables or fields.' : 'No synced tables.'} />
							) : (
								<ColumnSecurityTree
									key={search}
									objects={visibleObjects}
									search={search}
									draft={dialogDraft}
									manualExpandedKeys={manualExpandedKeys}
									onManualExpandedKeysChange={setManualExpandedKeys}
									onChange={setDialogDraft}
								/>
							)}
						</div>
						<DialogActions
							isPending={update.isPending}
							error={update.error}
							onCancel={() => setDialog(null)}
							onSave={saveDialog}
						/>
					</DialogContent>
				) : dialog?.mode === 'edit' ? (
					<DialogContent className='sm:max-w-xl'>
						<DialogHeader>
							<DialogTitle>Edit sensitive fields</DialogTitle>
							<DialogDescription>Choose which fields to hide by default.</DialogDescription>
						</DialogHeader>
						<EditTableSelector
							definition={dialog.definition}
							object={objects.find((object) => tableKey(object) === tableKey(dialog.definition))}
							catalogState={catalogState}
							onChange={(definition) =>
								setDialog((current) =>
									current?.mode === 'edit' ? { ...current, definition } : current,
								)
							}
						/>
						{dialog.definition.restrictedColumns.length === 0 && (
							<p className='text-sm text-muted-foreground'>Select at least one sensitive field.</p>
						)}
						<DialogActions
							isPending={update.isPending}
							error={update.error}
							saveDisabled={dialog.definition.restrictedColumns.length === 0}
							onCancel={() => setDialog(null)}
							onSave={saveDialog}
						/>
					</DialogContent>
				) : null}
			</Dialog>

			<ConfirmationDialog
				open={removeTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRemoveTarget(null);
					}
				}}
				title='Remove sensitive fields?'
				description={
					removeTarget
						? `Columns in ${removeTarget.database}/${removeTarget.schema}/${removeTarget.table} will be visible to everyone with access to the table.`
						: ''
				}
				confirmLabel='Remove'
				onConfirm={removeTable}
				isPending={update.isPending}
				error={update.error?.message}
				preventCloseWhilePending
			/>
		</>
	);
}

function RestrictedColumnSummary({
	definition,
	object,
	unavailable,
	catalogState,
	editDisabled,
	onEdit,
	onRemove,
}: {
	definition: SensitiveColumnDefinition;
	object?: DatabaseContextObject;
	unavailable?: SensitiveColumnDefinition;
	catalogState: 'loading' | 'error' | 'ready';
	editDisabled: boolean;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const missingColumns = new Set(unavailable?.restrictedColumns ?? []);
	const isTableUnavailable = catalogState === 'ready' && object === undefined;
	return (
		<div className='flex items-start gap-3 p-3'>
			<FileExplorerIcon name={definition.table} type='table' />
			<div className='min-w-0 flex-1'>
				<div className='flex flex-wrap items-center gap-2'>
					<p className='truncate text-sm font-medium'>
						{definition.database}/{definition.schema}/{definition.table}
					</p>
					{isTableUnavailable && <Badge variant='destructive'>Unavailable</Badge>}
				</div>
				<div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
					<span className='flex items-center gap-1 text-xs text-muted-foreground'>
						<LockKeyhole aria-hidden='true' className='size-3.5' />
						Hidden
					</span>
					{definition.restrictedColumns.map((column) => (
						<Badge
							key={column}
							variant={missingColumns.has(column) ? 'outline' : 'secondary'}
							className={cn(missingColumns.has(column) && 'border-destructive/40 text-destructive')}
						>
							{column}
							{missingColumns.has(column) && <span className='sr-only'> unavailable</span>}
						</Badge>
					))}
				</div>
				{unavailable && !isTableUnavailable && (
					<p className='mt-1.5 text-xs text-destructive'>Some saved fields are unavailable after sync.</p>
				)}
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				<Button
					type='button'
					size='icon-sm'
					variant='ghost'
					className='rounded-full'
					aria-label={`Edit ${definition.table}`}
					disabled={editDisabled}
					onClick={onEdit}
				>
					<Pencil />
				</Button>
				<Button
					type='button'
					size='icon-sm'
					variant='ghost'
					className='rounded-full'
					aria-label={`Remove ${definition.table}`}
					onClick={onRemove}
				>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

function ColumnSecurityTree({
	objects,
	search,
	draft,
	manualExpandedKeys,
	onManualExpandedKeysChange,
	onChange,
}: {
	objects: DatabaseContextObject[];
	search: string;
	draft: ProjectColumnSecurity;
	manualExpandedKeys: Set<string>;
	onManualExpandedKeysChange: Dispatch<SetStateAction<Set<string>>>;
	onChange: (security: ProjectColumnSecurity) => void;
}) {
	const databases = useMemo(() => groupDatabaseContextObjects(objects), [objects]);
	const autoExpandedKeys = useMemo(() => getSearchExpandedKeys(databases, search), [databases, search]);
	const [collapsedAutoExpandedKeys, setCollapsedAutoExpandedKeys] = useState<Set<string>>(() => new Set());
	const expandedKeys = useMemo(
		() =>
			new Set([...manualExpandedKeys, ...autoExpandedKeys].filter((key) => !collapsedAutoExpandedKeys.has(key))),
		[manualExpandedKeys, autoExpandedKeys, collapsedAutoExpandedKeys],
	);

	const toggleFolder = (folder: GroupedDatabase | GroupedSchema) => {
		const isOpen = expandedKeys.has(folder.key);
		onManualExpandedKeysChange((current) => {
			const next = new Set(current);
			if (isOpen) {
				removeExpandedSubtree(next, folder.key, '\0');
			} else {
				next.add(folder.key);
			}
			return next;
		});
		setCollapsedAutoExpandedKeys((current) => {
			const next = new Set(current);
			if (isOpen && autoExpandedKeys.has(folder.key)) {
				next.add(folder.key);
			} else {
				next.delete(folder.key);
			}
			return next;
		});
	};

	const toggleTable = (object: DatabaseContextObject) => {
		const key = tableKey(object);
		const isOpen = expandedKeys.has(key);
		onManualExpandedKeysChange((current) => {
			const next = new Set(current);
			if (isOpen) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
		setCollapsedAutoExpandedKeys((current) => {
			const next = new Set(current);
			if (isOpen && autoExpandedKeys.has(key)) {
				next.add(key);
			} else {
				next.delete(key);
			}
			return next;
		});
	};

	return (
		<ul data-testid='project-column-security-tree'>
			{databases.map((database) => (
				<ColumnSecurityDatabaseNode
					key={database.key}
					database={database}
					draft={draft}
					expandedKeys={expandedKeys}
					onToggleFolder={toggleFolder}
					onToggleTable={toggleTable}
					onChange={onChange}
				/>
			))}
		</ul>
	);
}

function ColumnSecurityDatabaseNode({
	database,
	draft,
	expandedKeys,
	onToggleFolder,
	onToggleTable,
	onChange,
}: {
	database: GroupedDatabase;
	draft: ProjectColumnSecurity;
	expandedKeys: Set<string>;
	onToggleFolder: (folder: GroupedDatabase | GroupedSchema) => void;
	onToggleTable: (object: DatabaseContextObject) => void;
	onChange: (security: ProjectColumnSecurity) => void;
}) {
	const open = expandedKeys.has(database.key);
	const panelId = `column-security-database-${toDomId(database.key)}`;
	const configuredCount = getConfiguredDatabaseTableCount(draft, database);
	return (
		<li>
			<button
				type='button'
				className='flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50'
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
				{configuredCount > 0 && (
					<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
						{configuredCount} configured
					</Badge>
				)}
				<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
					{database.databaseType}
				</Badge>
			</button>
			{open && (
				<ul id={panelId}>
					{database.schemas.map((schema) => (
						<ColumnSecuritySchemaNode
							key={schema.key}
							schema={schema}
							depth={1}
							open={expandedKeys.has(schema.key)}
							draft={draft}
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

function ColumnSecuritySchemaNode({
	schema,
	depth,
	open,
	draft,
	expandedKeys,
	onToggle,
	onToggleTable,
	onChange,
}: {
	schema: GroupedSchema;
	depth: number;
	open: boolean;
	draft: ProjectColumnSecurity;
	expandedKeys: Set<string>;
	onToggle: () => void;
	onToggleTable: (object: DatabaseContextObject) => void;
	onChange: (security: ProjectColumnSecurity) => void;
}) {
	const panelId = `column-security-schema-${toDomId(schema.key)}`;
	const configuredCount = getConfiguredTableCount(draft, schema);
	return (
		<li>
			<button
				type='button'
				className='flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50'
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${schema.schema} schema`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<ChevronRight
					className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
				/>
				<FileExplorerIcon name={schema.schema} type='directory' />
				<span className='min-w-0 flex-1 truncate'>{schema.schema}</span>
				{configuredCount > 0 && (
					<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
						{configuredCount} configured
					</Badge>
				)}
			</button>
			{open && (
				<ul id={panelId}>
					{schema.tables.map((object) => (
						<ColumnSecurityTableNode
							key={tableKey(object)}
							object={object}
							depth={depth + 1}
							open={expandedKeys.has(tableKey(object))}
							definition={draft.tables.find((definition) => tableKey(definition) === tableKey(object))}
							onToggle={() => onToggleTable(object)}
							onChange={(column, checked) =>
								onChange(toggleRestrictedColumn(draft, object, column, checked))
							}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function ColumnSecurityTableNode({
	object,
	depth,
	open,
	definition,
	onToggle,
	onChange,
}: {
	object: DatabaseContextObject;
	depth: number;
	open: boolean;
	definition?: SensitiveColumnDefinition;
	onToggle: () => void;
	onChange: (column: string, checked: boolean) => void;
}) {
	const restricted = new Set(definition?.restrictedColumns ?? []);
	const syncedColumns = object.columns ?? [];
	const columns = [...new Set([...syncedColumns, ...(definition?.restrictedColumns ?? [])])];
	const panelId = `column-security-table-${toDomId(tableKey(object))}`;
	return (
		<li>
			<button
				type='button'
				className={cn(
					'flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50',
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
				{definition && <span className='text-xs text-primary'>{restricted.size} hidden</span>}
			</button>
			{open && (
				<ul id={panelId} className='bg-muted/20 py-1'>
					{columns.length === 0 ? (
						<li
							className='py-2 pr-2 text-xs text-muted-foreground'
							style={{ paddingLeft: `${getTreeNodePadding(depth + 1) + 22}px` }}
						>
							No synced fields available.
						</li>
					) : (
						columns.map((column) => (
							<li key={column}>
								<label
									className='flex h-8 cursor-pointer items-center gap-2 pr-2 text-sm hover:bg-muted/50'
									style={{ paddingLeft: `${getTreeNodePadding(depth + 1) + 22}px` }}
								>
									<Checkbox
										checked={restricted.has(column)}
										aria-label={`Hide ${column} on ${object.table}`}
										onCheckedChange={(checked) => onChange(column, checked === true)}
									/>
									<span className='min-w-0 flex-1 truncate'>{column}</span>
									{!syncedColumns.includes(column) && (
										<Badge variant='outline' className='text-muted-foreground'>
											Unavailable
										</Badge>
									)}
								</label>
							</li>
						))
					)}
				</ul>
			)}
		</li>
	);
}

function EditTableSelector({
	definition,
	object,
	catalogState,
	onChange,
}: {
	definition: SensitiveColumnDefinition;
	object?: DatabaseContextObject;
	catalogState: 'loading' | 'error' | 'ready';
	onChange: (definition: SensitiveColumnDefinition) => void;
}) {
	const selected = new Set(definition.restrictedColumns);
	const syncedColumns = object?.columns ?? [];
	const unavailableColumns = new Set(
		catalogState === 'ready'
			? definition.restrictedColumns.filter((column) => !syncedColumns.includes(column))
			: [],
	);
	const columns = [...new Set([...syncedColumns, ...definition.restrictedColumns])];
	return (
		<div className='overflow-hidden rounded-lg border'>
			<div className='flex items-center gap-2 border-b px-3 py-2.5'>
				<FileExplorerIcon name={definition.table} type='table' />
				<span className='min-w-0 flex-1 truncate text-sm font-medium'>
					{definition.database}/{definition.schema}/{definition.table}
				</span>
				{catalogState === 'ready' && !object && <Badge variant='destructive'>Unavailable</Badge>}
			</div>
			{catalogState === 'loading' && <StatusRow status='Loading synced table...' />}
			{catalogState === 'error' && <StatusRow status='Failed to load synced table.' />}
			{catalogState === 'ready' && !object && (
				<p className='border-b px-3 py-2 text-xs text-muted-foreground'>
					This table was not found in the latest sync. Use Remove outside this dialog to stop hiding its
					columns.
				</p>
			)}
			{columns.length === 0 ? (
				catalogState === 'ready' && <StatusRow status='No synced fields available.' />
			) : (
				<div className='py-1'>
					{columns.map((column) => {
						const unavailable = unavailableColumns.has(column);
						return (
							<label
								key={column}
								className='flex h-9 cursor-pointer items-center gap-2 px-3 text-sm hover:bg-muted/50'
							>
								<Checkbox
									checked={selected.has(column)}
									aria-label={`Hide ${column} on ${definition.table}`}
									onCheckedChange={(checked) => {
										const restrictedColumns =
											checked === true
												? [...selected, column]
												: [...selected].filter((selectedColumn) => selectedColumn !== column);
										onChange({ ...definition, restrictedColumns: restrictedColumns.sort() });
									}}
								/>
								<span className='min-w-0 flex-1 truncate'>{column}</span>
								{unavailable && (
									<Badge variant='outline' className='text-muted-foreground'>
										Unavailable
									</Badge>
								)}
							</label>
						);
					})}
				</div>
			)}
		</div>
	);
}

function DialogActions({
	isPending,
	error,
	saveDisabled = false,
	onCancel,
	onSave,
}: {
	isPending: boolean;
	error: { message: string } | null;
	saveDisabled?: boolean;
	onCancel: () => void;
	onSave: () => void;
}) {
	return (
		<div>
			{error && <p className='mb-2 text-sm text-destructive'>{error.message}</p>}
			<DialogFooter>
				<Button
					type='button'
					variant='ghost'
					className='rounded-full border'
					disabled={isPending}
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button
					type='button'
					variant='primary-gradient'
					className='rounded-full'
					disabled={saveDisabled}
					isLoading={isPending}
					onClick={onSave}
				>
					Save
				</Button>
			</DialogFooter>
		</div>
	);
}

function StatusRow({ status, onRetry }: { status: string; onRetry?: () => void }) {
	return (
		<div className='flex min-h-16 items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground'>
			<span>{status}</span>
			{onRetry && (
				<Button type='button' size='sm' variant='ghost' className='rounded-full' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function toDomId(value: string): string {
	return value
		.split('')
		.map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
		.join('');
}

function toggleRestrictedColumn(
	security: ProjectColumnSecurity,
	object: DatabaseContextObject,
	column: string,
	checked: boolean,
): ProjectColumnSecurity {
	const identity = tableIdentity(object);
	const current = security.tables.find((table) => tableKey(table) === tableKey(identity));
	const restrictedColumns = new Set(current?.restrictedColumns ?? []);
	if (checked) {
		restrictedColumns.add(column);
	} else {
		restrictedColumns.delete(column);
	}
	return normalizeProjectColumnSecurity({
		version: 1,
		tables: [
			...security.tables.filter((table) => tableKey(table) !== tableKey(identity)),
			...(restrictedColumns.size > 0 ? [{ ...identity, restrictedColumns: [...restrictedColumns].sort() }] : []),
		],
	});
}

function replaceDefinition(
	security: ProjectColumnSecurity,
	definition: SensitiveColumnDefinition,
	remove = false,
): ProjectColumnSecurity {
	return normalizeProjectColumnSecurity({
		version: 1,
		tables: [
			...security.tables.filter((table) => tableKey(table) !== tableKey(definition)),
			...(remove ? [] : [definition]),
		],
	});
}

function filterObjects(objects: DatabaseContextObject[], search: string): DatabaseContextObject[] {
	const query = search.trim().toLocaleLowerCase();
	if (!query) {
		return objects;
	}
	return objects.filter((object) =>
		[object.databaseType, object.database, object.schema, object.table, ...(object.columns ?? [])].some((value) =>
			value.toLocaleLowerCase().includes(query),
		),
	);
}

function getSearchExpandedKeys(databases: GroupedDatabase[], search: string): Set<string> {
	const query = search.trim().toLocaleLowerCase();
	if (!query) {
		return new Set();
	}

	if (databases.some((database) => database.database.toLocaleLowerCase().includes(query))) {
		return new Set();
	}

	const schemaExpandedKeys = new Set<string>();
	for (const database of databases) {
		for (const schema of database.schemas) {
			if (schema.schema.toLocaleLowerCase().includes(query)) {
				schemaExpandedKeys.add(database.key);
			}
		}
	}
	if (schemaExpandedKeys.size > 0) {
		return schemaExpandedKeys;
	}

	const tableExpandedKeys = new Set<string>();
	for (const database of databases) {
		for (const schema of database.schemas) {
			for (const object of schema.tables) {
				if (object.table.toLocaleLowerCase().includes(query)) {
					tableExpandedKeys.add(database.key);
					tableExpandedKeys.add(schema.key);
				}
			}
		}
	}
	if (tableExpandedKeys.size > 0) {
		return tableExpandedKeys;
	}

	const columnExpandedKeys = new Set<string>();
	for (const database of databases) {
		for (const schema of database.schemas) {
			for (const object of schema.tables) {
				if ((object.columns ?? []).some((column) => column.toLocaleLowerCase().includes(query))) {
					columnExpandedKeys.add(database.key);
					columnExpandedKeys.add(schema.key);
					columnExpandedKeys.add(tableKey(object));
				}
			}
		}
	}
	return columnExpandedKeys;
}

function getUnavailableDefinitions(
	security: ProjectColumnSecurity,
	objects: DatabaseContextObject[],
): SensitiveColumnDefinition[] {
	return security.tables.flatMap((definition) => {
		const object = objects.find((candidate) => tableKey(candidate) === tableKey(definition));
		if (!object) {
			return [definition];
		}
		const missingColumns = definition.restrictedColumns.filter(
			(column) => !(object.columns ?? []).includes(column),
		);
		return missingColumns.length > 0 ? [{ ...definition, restrictedColumns: missingColumns }] : [];
	});
}

function cloneColumnSecurity(security: ProjectColumnSecurity): ProjectColumnSecurity {
	return {
		version: 1,
		tables: security.tables.map(cloneDefinition),
	};
}

function cloneDefinition(definition: SensitiveColumnDefinition): SensitiveColumnDefinition {
	return {
		...definition,
		restrictedColumns: [...definition.restrictedColumns],
	};
}

function tableIdentity(object: DatabaseContextObject): Omit<SensitiveColumnDefinition, 'restrictedColumns'> {
	return {
		databaseType: object.databaseType,
		database: object.database,
		schema: object.schema,
		table: object.table,
	};
}

function tableKey(table: { databaseType: string; database: string; schema: string; table: string }): string {
	return [table.databaseType, table.database, table.schema, table.table].join('\0');
}

function getConfiguredTableCount(security: ProjectColumnSecurity, schema: GroupedSchema): number {
	return security.tables.filter(
		(table) =>
			table.databaseType === schema.databaseType &&
			table.database === schema.database &&
			table.schema === schema.schema,
	).length;
}

function getConfiguredDatabaseTableCount(security: ProjectColumnSecurity, database: GroupedDatabase): number {
	return security.tables.filter(
		(table) => table.databaseType === database.databaseType && table.database === database.database,
	).length;
}

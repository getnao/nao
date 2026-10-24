import { isDatabaseContextTableGranted } from '@nao/shared';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DatabaseContextAccess, DatabaseContextGrant } from '@nao/shared';

import { DatabaseContextTree, filterDatabaseContextObjects } from '@/components/settings/user-group-context-access';
import { UserGroupContextModeSelector } from '@/components/settings/user-group-context-mode-selector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-fields';
import { Input } from '@/components/ui/input';

export interface WarehouseSchemaInventory {
	schema: string;
	tables: string[];
}

export type WarehouseTableSelectionMode = 'all' | 'selected';

interface WarehouseTableSelectionProps {
	schemas: WarehouseSchemaInventory[];
	databaseType: string;
	databaseLabel: string;
	selectionMode: WarehouseTableSelectionMode;
	selectedTableKeys: Set<string>;
	isPending: boolean;
	error: { message: string } | null;
	onSelectionModeChange: (mode: WarehouseTableSelectionMode) => void;
	onChange: (selectedTableKeys: Set<string>) => void;
	onBack: () => void;
	onSubmit: () => void;
}

export function WarehouseTableSelection({
	schemas,
	databaseType,
	databaseLabel,
	selectionMode,
	selectedTableKeys,
	isPending,
	error,
	onSelectionModeChange,
	onChange,
	onBack,
	onSubmit,
}: WarehouseTableSelectionProps) {
	const [search, setSearch] = useState('');
	const tableCount = countTables(schemas);
	const selectedCount = selectedTableKeys.size;
	const objects = useMemo(
		() =>
			schemas.flatMap(({ schema, tables }) =>
				tables.map((table) => ({ databaseType, database: databaseLabel, schema, table })),
			),
		[databaseLabel, databaseType, schemas],
	);
	const databaseAccess: DatabaseContextAccess =
		selectionMode === 'all'
			? { mode: 'all', strict: true }
			: {
					mode: 'restricted',
					strict: true,
					grants: schemas.flatMap(({ schema, tables }): DatabaseContextGrant[] => {
						const selectedTables = tables.filter((table) =>
							selectedTableKeys.has(getWarehouseTableKey(schema, table)),
						);
						if (tables.length > 0 && selectedTables.length === tables.length) {
							return [{ kind: 'schema', databaseType, database: databaseLabel, schema }];
						}
						return selectedTables.map((table) => ({
							kind: 'table',
							databaseType,
							database: databaseLabel,
							schema,
							table,
						}));
					}),
					patterns: [],
				};
	const isSearching = databaseAccess.mode === 'restricted' && search.trim().length > 0;
	const filteredObjects =
		databaseAccess.mode === 'restricted' ? filterDatabaseContextObjects(objects, search) : objects;
	const updateSelection = (access: DatabaseContextAccess) => {
		onChange(
			new Set(
				objects
					.filter((object) => isDatabaseContextTableGranted(access, object))
					.map((object) => getWarehouseTableKey(object.schema, object.table)),
			),
		);
	};

	return (
		<div className='flex flex-col gap-5'>
			<section className='space-y-3 rounded-xl border bg-muted/20 p-4'>
				<div>
					<h3 className='text-sm font-medium text-foreground'>Tables to sync</h3>
					<p className='text-[11px] leading-relaxed text-muted-foreground'>
						Only selected tables are added to nao's context. Warehouse permissions are unchanged.
					</p>
				</div>
				<UserGroupContextModeSelector
					mode={databaseAccess.mode}
					everythingDescription='All current and future tables.'
					specificDescription='Choose the schemas and tables to sync.'
					onEverything={() => {
						onSelectionModeChange('all');
						onChange(getAllWarehouseTableKeys(schemas));
					}}
					onSpecific={() => {
						onSelectionModeChange('selected');
						onChange(new Set());
					}}
				/>
				<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
					{databaseAccess.mode === 'restricted' && (
						<div className='relative min-w-0 flex-1'>
							<Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder='Search schemas and tables'
								aria-label='Search schemas and tables'
								className='pl-9'
							/>
						</div>
					)}
					<Badge variant='secondary' className='w-fit whitespace-nowrap'>
						{selectedCount} of {tableCount} selected
					</Badge>
				</div>

				<div className='h-64 overflow-y-auto rounded-lg border'>
					{filteredObjects.length === 0 ? (
						<div className='flex h-full items-center justify-center px-4 text-sm text-muted-foreground'>
							{tableCount === 0 ? 'No tables were found.' : 'No tables match your search.'}
						</div>
					) : (
						<ul>
							<DatabaseContextTree
								objects={filteredObjects}
								selectionObjects={objects}
								databaseAccess={databaseAccess}
								onChange={updateSelection}
								isSearching={isSearching}
								draftPattern=''
								showDatabaseRoot={false}
								showSelectionSourceLabels={false}
							/>
						</ul>
					)}
				</div>
			</section>

			{error && <FormError error={error.message} />}

			<div className='flex items-center justify-between gap-2 border-t pt-4'>
				<Button type='button' variant='ghost' size='sm' onClick={onBack} disabled={isPending}>
					Previous
				</Button>
				<Button
					type='button'
					size='sm'
					className='rounded-full'
					onClick={onSubmit}
					disabled={selectedCount === 0 || isPending}
					isLoading={isPending}
				>
					Next
				</Button>
			</div>
		</div>
	);
}

export function getWarehouseTableKey(schema: string, table: string): string {
	return `${schema}\0${table}`;
}

export function getAllWarehouseTableKeys(schemas: WarehouseSchemaInventory[]): Set<string> {
	return new Set(
		schemas.flatMap((schema) => schema.tables.map((table) => getWarehouseTableKey(schema.schema, table))),
	);
}

export function getCompactWarehouseTableSelection(
	schemas: WarehouseSchemaInventory[],
	selectedTableKeys: Set<string>,
): { schemas: string[]; tables: Array<{ schema: string; table: string }> } {
	const selectedSchemas: string[] = [];
	const selectedTables: Array<{ schema: string; table: string }> = [];

	for (const schema of schemas) {
		const tables = schema.tables.filter((table) =>
			selectedTableKeys.has(getWarehouseTableKey(schema.schema, table)),
		);
		if (schema.tables.length > 0 && tables.length === schema.tables.length) {
			selectedSchemas.push(schema.schema);
		} else {
			selectedTables.push(...tables.map((table) => ({ schema: schema.schema, table })));
		}
	}

	return { schemas: selectedSchemas, tables: selectedTables };
}

function countTables(schemas: WarehouseSchemaInventory[]): number {
	return schemas.reduce((count, schema) => count + schema.tables.length, 0);
}

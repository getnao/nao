import { EMPTY_PROJECT_COLUMN_SECURITY, normalizeProjectColumnSecurity } from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectColumnSecurity, SensitiveColumnDefinition } from '@nao/shared';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { SettingsCard } from '@/components/ui/settings-card';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

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

	const toggleColumn = (object: DatabaseContextObject, column: string, checked: boolean) => {
		const identity = tableIdentity(object);
		const current = registry.tables.find((table) => tableKey(table) === tableKey(identity));
		const restrictedColumns = new Set(current?.restrictedColumns ?? []);
		if (checked) {
			restrictedColumns.add(column);
		} else {
			restrictedColumns.delete(column);
		}
		const next: ProjectColumnSecurity = {
			version: 1,
			tables: [
				...registry.tables.filter((table) => tableKey(table) !== tableKey(identity)),
				...(restrictedColumns.size > 0
					? [{ ...identity, restrictedColumns: [...restrictedColumns].sort() }]
					: []),
			],
		};
		update.mutate(normalizeProjectColumnSecurity(next));
	};

	return (
		<SettingsCard
			title='Column-level security'
			description='Restrict sensitive columns, then grant them to selected user groups.'
			action={!isLicensed ? <UpgradeToEnterprise /> : undefined}
		>
			{catalogState === 'loading' || security.isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading column security...</p>
			) : catalogState === 'error' || security.isError ? (
				<p className='text-sm text-destructive'>Failed to load column security.</p>
			) : objects.length === 0 ? (
				<p className='text-sm text-muted-foreground'>No synced tables are available.</p>
			) : (
				<div className='max-h-[32rem] overflow-auto rounded-lg border'>
					{objects.map((object) => {
						const definition = registry.tables.find((table) => tableKey(table) === tableKey(object));
						const restricted = new Set(definition?.restrictedColumns ?? []);
						return (
							<details key={tableKey(object)} className='border-b last:border-b-0'>
								<summary className='flex cursor-pointer items-center gap-2 px-3 py-2 text-sm'>
									<span className='min-w-0 flex-1 truncate'>
										{object.database}/{object.schema}/{object.table}
									</span>
									{restricted.size > 0 && (
										<Badge variant='secondary'>{restricted.size} restricted</Badge>
									)}
								</summary>
								<div className='border-t bg-muted/20 py-1'>
									{(object.columns ?? []).map((column) => (
										<label
											key={column}
											className='flex min-h-9 cursor-pointer items-center gap-2 px-5 py-1.5 text-sm'
										>
											<Checkbox
												checked={restricted.has(column)}
												disabled={!isLicensed || update.isPending}
												aria-label={`Restrict ${column} on ${object.table}`}
												onCheckedChange={(checked) =>
													toggleColumn(object, column, checked === true)
												}
											/>
											<span className='min-w-0 flex-1 truncate'>{column}</span>
										</label>
									))}
								</div>
							</details>
						);
					})}
				</div>
			)}
			{update.error && <p className='text-sm text-destructive'>{update.error.message}</p>}
		</SettingsCard>
	);
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

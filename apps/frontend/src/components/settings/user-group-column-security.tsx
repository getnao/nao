import {
	columnSecurityTableKey,
	filterProjectColumnSecurityByDatabaseContext,
	normalizeUserGroupColumnPolicies,
} from '@nao/shared';
import type {
	DatabaseContextAccess,
	ProjectColumnSecurity,
	SensitiveColumnDefinition,
	UserGroupColumnPolicies,
} from '@nao/shared';

import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Checkbox } from '@/components/ui/checkbox';

export function UserGroupColumnSecurity({
	registry,
	databaseAccess,
	policies,
	isLicensed,
	onChange,
}: {
	registry: ProjectColumnSecurity;
	databaseAccess: DatabaseContextAccess;
	policies: UserGroupColumnPolicies;
	isLicensed: boolean;
	onChange: (policies: UserGroupColumnPolicies) => void;
}) {
	const accessibleRegistry = filterProjectColumnSecurityByDatabaseContext(registry, databaseAccess);
	return (
		<section className='flex flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Column-level security</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Grant sensitive columns to this group. Unchecked columns remain hidden and cannot be queried.
					</p>
				</div>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			{registry.tables.length === 0 ? (
				<p className='rounded-md bg-muted/40 p-3 text-sm text-muted-foreground'>
					No restricted columns are configured in the project Security tab.
				</p>
			) : accessibleRegistry.tables.length === 0 ? (
				<p className='rounded-md bg-muted/40 p-3 text-sm text-muted-foreground'>
					No protected tables are available through this group&apos;s Context permissions.
				</p>
			) : (
				<div className='divide-y rounded-lg border'>
					{accessibleRegistry.tables.map((table) => {
						const policy = policies.policies.find(
							(candidate) => columnSecurityTableKey(candidate) === columnSecurityTableKey(table),
						);
						const granted = new Set(policy?.grantedColumns ?? []);
						return (
							<div key={columnSecurityTableKey(table)} className='p-3'>
								<p className='truncate text-sm font-medium'>
									{table.database}/{table.schema}/{table.table}
								</p>
								<div className='mt-2 grid gap-1 sm:grid-cols-2'>
									{table.restrictedColumns.map((column) => (
										<label key={column} className='flex min-h-9 items-center gap-2 text-sm'>
											<Checkbox
												checked={granted.has(column)}
												disabled={!isLicensed}
												aria-label={`Grant ${column} on ${table.table}`}
												onCheckedChange={(checked) =>
													onChange(updatePolicy(policies, table, column, checked === true))
												}
											/>
											<span className='min-w-0 truncate'>{column}</span>
										</label>
									))}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

function updatePolicy(
	policies: UserGroupColumnPolicies,
	table: SensitiveColumnDefinition,
	column: string,
	granted: boolean,
): UserGroupColumnPolicies {
	const current = policies.policies.find(
		(policy) => columnSecurityTableKey(policy) === columnSecurityTableKey(table),
	);
	const grantedColumns = new Set(current?.grantedColumns ?? []);
	if (granted) {
		grantedColumns.add(column);
	} else {
		grantedColumns.delete(column);
	}
	return normalizeUserGroupColumnPolicies({
		version: 1,
		policies: [
			...policies.policies.filter((policy) => columnSecurityTableKey(policy) !== columnSecurityTableKey(table)),
			...(grantedColumns.size > 0
				? [
						{
							databaseType: table.databaseType,
							database: table.database,
							schema: table.schema,
							table: table.table,
							grantedColumns: [...grantedColumns],
						},
					]
				: []),
		],
	});
}

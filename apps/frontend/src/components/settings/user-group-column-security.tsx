import { columnSecurityTableKey, normalizeUserGroupColumnPolicies } from '@nao/shared';
import { LockKeyhole } from 'lucide-react';
import type { SensitiveColumnDefinition, UserGroupColumnPolicies } from '@nao/shared';

import { Checkbox } from '@/components/ui/checkbox';
import { getTreeNodePadding } from '@/lib/tree-expansion';

export function UserGroupColumnRows({
	table,
	depth,
	policies,
	isLicensed,
	onChange,
}: {
	table: SensitiveColumnDefinition;
	depth: number;
	policies: UserGroupColumnPolicies;
	isLicensed: boolean;
	onChange: (policies: UserGroupColumnPolicies) => void;
}) {
	const policy = policies.policies.find(
		(candidate) => columnSecurityTableKey(candidate) === columnSecurityTableKey(table),
	);
	const granted = new Set(policy?.grantedColumns ?? []);

	return (
		<ul>
			{table.restrictedColumns.map((column) => (
				<li
					key={column}
					className='flex h-8 w-full items-center gap-1 pr-2 text-sm hover:bg-muted/50'
					style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
				>
					<span className='size-4 shrink-0' />
					<Checkbox
						checked={granted.has(column)}
						disabled={!isLicensed}
						title={!isLicensed ? 'Sensitive-field access requires an Enterprise license.' : undefined}
						aria-label={`Make ${column} visible on ${table.table}`}
						onCheckedChange={(checked) => onChange(updatePolicy(policies, table, column, checked === true))}
					/>
					<LockKeyhole aria-hidden='true' className='size-4 shrink-0 text-amber-600 dark:text-amber-400' />
					<span className='min-w-0 flex-1 truncate' title={column}>
						{column}
					</span>
					<span className='shrink-0 text-[10px] text-muted-foreground'>
						{granted.has(column) ? 'Visible' : 'Hidden'}
					</span>
				</li>
			))}
		</ul>
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

import { rowSecurityTableKey } from '@nao/shared';
import type {
	ProjectRowSecurity,
	SensitiveTableDefinition,
	UserGroupRowPolicies,
	UserGroupTablePolicy,
} from '@nao/shared';

import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function UserGroupRowSecurity({
	registry,
	policies,
	isLicensed,
	onChange,
}: {
	registry: ProjectRowSecurity;
	policies: UserGroupRowPolicies;
	isLicensed: boolean;
	onChange: (policies: UserGroupRowPolicies) => void;
}) {
	return (
		<section className='flex flex-col gap-3 rounded-lg border p-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Row-level security</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Choose row access for each sensitive table. No policy means no rows.
					</p>
				</div>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			{registry.tables.length === 0 ? (
				<p className='rounded-md bg-muted/40 p-3 text-sm text-muted-foreground'>
					No sensitive tables are configured in the project Security tab.
				</p>
			) : (
				<div className='flex flex-col divide-y rounded-lg border'>
					{registry.tables.map((table) => (
						<TablePolicyEditor
							key={rowSecurityTableKey(table)}
							table={table}
							policy={policies.policies.find(
								(candidate) => rowSecurityTableKey(candidate) === rowSecurityTableKey(table),
							)}
							disabled={!isLicensed}
							onChange={(policy) => onChange(updatePolicy(policies, table, policy))}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function TablePolicyEditor({
	table,
	policy,
	disabled,
	onChange,
}: {
	table: SensitiveTableDefinition;
	policy?: UserGroupTablePolicy;
	disabled: boolean;
	onChange: (policy?: UserGroupTablePolicy) => void;
}) {
	const predicate = policy?.access === 'predicate' ? policy.predicate : '';
	const predicateError =
		policy?.access === 'predicate' ? getPredicateDraftError(predicate, table.constraintColumns) : null;
	return (
		<div className='flex flex-col gap-3 p-3'>
			<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
				<div className='min-w-0 flex-1'>
					<p className='truncate text-sm font-medium'>
						{table.database}/{table.schema}/{table.table}
					</p>
					<p className='text-xs text-muted-foreground'>
						Constraint columns: {table.constraintColumns.join(', ')}
					</p>
				</div>
				<Select
					value={policy?.access ?? 'none'}
					disabled={disabled}
					onValueChange={(value) => {
						if (value === 'none') {
							onChange(undefined);
						} else if (value === 'full') {
							onChange({ ...tableIdentity(table), access: 'full' });
						} else {
							onChange({ ...tableIdentity(table), access: 'predicate', predicate: predicate || '' });
						}
					}}
				>
					<SelectTrigger className='w-full sm:w-44' aria-label={`Row access for ${table.table}`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='none'>No rows</SelectItem>
						<SelectItem value='predicate'>WHERE predicate</SelectItem>
						<SelectItem value='full'>Full row access</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{policy?.access === 'predicate' && (
				<div>
					<Input
						value={policy.predicate}
						disabled={disabled}
						aria-label={`WHERE predicate for ${table.table}`}
						placeholder={`${table.constraintColumns[0]} = 'value'`}
						onChange={(event) =>
							onChange({
								...tableIdentity(table),
								access: 'predicate',
								predicate: event.target.value,
							})
						}
					/>
					<p className={`mt-1 text-xs ${predicateError ? 'text-destructive' : 'text-muted-foreground'}`}>
						{predicateError ?? 'Use a boolean SQL expression. AND and OR are supported.'}
					</p>
				</div>
			)}
		</div>
	);
}

function updatePolicy(
	policies: UserGroupRowPolicies,
	table: SensitiveTableDefinition,
	policy?: UserGroupTablePolicy,
): UserGroupRowPolicies {
	const key = rowSecurityTableKey(table);
	const next = policies.policies.filter((candidate) => rowSecurityTableKey(candidate) !== key);
	return { version: 1, policies: policy ? [...next, policy] : next };
}

function tableIdentity(table: SensitiveTableDefinition) {
	return {
		databaseType: table.databaseType,
		database: table.database,
		schema: table.schema,
		table: table.table,
	};
}

function getPredicateDraftError(predicate: string, columns: string[]): string | null {
	if (!predicate.trim()) {
		return 'Enter a predicate or choose another access option.';
	}
	if (/;|--|\/\*/.test(predicate)) {
		return 'Comments and multiple statements are not allowed.';
	}
	const identifiers = predicate.replace(/'(?:''|[^'])*'/g, '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
	const keywords = new Set(['and', 'or', 'not', 'null', 'is', 'in', 'between', 'true', 'false']);
	const unknown = identifiers.find(
		(identifier) =>
			!keywords.has(identifier.toLowerCase()) &&
			!columns.some((column) => column.toLowerCase() === identifier.toLowerCase()),
	);
	return unknown ? `Only constraint columns may be used. "${unknown}" is not configured.` : null;
}

import {
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	ROW_SECURITY_OPERATORS,
	rowSecurityTableKey,
} from '@nao/shared';
import { Plus, X } from 'lucide-react';
import type {
	ProjectRowSecurity,
	RowSecurityCondition,
	RowSecurityOperator,
	SensitiveTableDefinition,
	UserGroupRowPolicies,
	UserGroupTablePolicy,
} from '@nao/shared';

import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const OPERATOR_LABELS: Record<RowSecurityOperator, string> = {
	equals: 'Equals',
	'does-not-equal': 'Does not equal',
	'greater-than': 'Greater than',
	'greater-than-or-equal': 'Greater than or equal',
	'less-than': 'Less than',
	'less-than-or-equal': 'Less than or equal',
	'is-one-of': 'Is one of',
	'is-not-one-of': 'Is not one of',
	'is-null': 'Is null',
	'is-not-null': 'Is not null',
};

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
		<section className='flex flex-col gap-3'>
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
				<div className='flex flex-col divide-y rounded-lg border' role='region' aria-label='Table row policies'>
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
	const conditions = policy?.access === 'predicate' ? policy.conditions : [];
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
							onChange({
								...tableIdentity(table),
								access: 'predicate',
								conditions:
									conditions.length > 0 ? conditions : [createCondition(table.constraintColumns[0])],
							});
						}
					}}
				>
					<SelectTrigger className='w-full sm:w-44' aria-label={`Row access for ${table.table}`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='none'>No rows</SelectItem>
						<SelectItem value='predicate'>Filtered rows</SelectItem>
						<SelectItem value='full'>Full row access</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{policy?.access === 'predicate' && (
				<div className='flex flex-col gap-2'>
					{policy.conditions.map((condition, index) => (
						<ConditionEditor
							key={index}
							table={table}
							condition={condition}
							index={index}
							disabled={disabled}
							onChange={(nextCondition) =>
								onChange({
									...policy,
									conditions: replaceAt(policy.conditions, index, nextCondition),
								})
							}
							onRemove={() =>
								onChange({
									...policy,
									conditions: policy.conditions.filter(
										(_, candidateIndex) => candidateIndex !== index,
									),
								})
							}
						/>
					))}
					{policy.conditions.length === 0 ? (
						<p className='text-xs text-destructive'>Add at least one condition.</p>
					) : (
						<p className='text-xs text-muted-foreground'>All conditions must match.</p>
					)}
					<Button
						type='button'
						variant='outline'
						size='sm'
						className='w-fit rounded-full'
						disabled={disabled || policy.conditions.length >= ROW_SECURITY_MAX_CONDITIONS}
						onClick={() =>
							onChange({
								...policy,
								conditions: [...policy.conditions, createCondition(table.constraintColumns[0])],
							})
						}
					>
						<Plus />
						Add condition
					</Button>
				</div>
			)}
		</div>
	);
}

function ConditionEditor({
	table,
	condition,
	index,
	disabled,
	onChange,
	onRemove,
}: {
	table: SensitiveTableDefinition;
	condition: RowSecurityCondition;
	index: number;
	disabled: boolean;
	onChange: (condition: RowSecurityCondition) => void;
	onRemove: () => void;
}) {
	const conditionNumber = index + 1;
	const error = getConditionDraftError(condition, table.constraintColumns);
	return (
		<div>
			<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
				<Select
					value={condition.column}
					disabled={disabled}
					onValueChange={(column) => onChange({ ...condition, column })}
				>
					<SelectTrigger
						className='w-full sm:min-w-36 sm:flex-1'
						aria-label={`Column for ${table.table} condition ${conditionNumber}`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{table.constraintColumns.map((column) => (
							<SelectItem key={column} value={column}>
								{column}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select
					value={condition.operator}
					disabled={disabled}
					onValueChange={(operator: RowSecurityOperator) =>
						onChange(
							operatorNeedsValue(operator)
								? { ...condition, operator, value: condition.value ?? '' }
								: { column: condition.column, operator },
						)
					}
				>
					<SelectTrigger
						className='w-full sm:w-52'
						aria-label={`Operator for ${table.table} condition ${conditionNumber}`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{ROW_SECURITY_OPERATORS.map((operator) => (
							<SelectItem key={operator} value={operator}>
								{OPERATOR_LABELS[operator]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{operatorNeedsValue(condition.operator) && (
					<Input
						value={condition.value ?? ''}
						disabled={disabled}
						aria-label={`Value for ${table.table} condition ${conditionNumber}`}
						aria-invalid={error !== null}
						placeholder={isListOperator(condition.operator) ? 'value 1, value 2' : 'Enter value'}
						className='w-full sm:min-w-36 sm:flex-1'
						onChange={(event) => onChange({ ...condition, value: event.target.value })}
					/>
				)}
				<Button
					type='button'
					variant='ghost-muted'
					size='icon-sm'
					className='self-end rounded-full sm:self-auto'
					disabled={disabled}
					aria-label={`Remove condition ${conditionNumber} from ${table.table}`}
					onClick={onRemove}
				>
					<X />
				</Button>
			</div>
			{error && <p className='mt-1 text-xs text-destructive'>{error}</p>}
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

function createCondition(column: string): RowSecurityCondition {
	return { column, operator: 'equals', value: '' };
}

function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
	return values.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate));
}

function getConditionDraftError(condition: RowSecurityCondition, columns: string[]): string | null {
	if (!columns.includes(condition.column)) {
		return `"${condition.column}" is not a configured constraint column.`;
	}
	if (!operatorNeedsValue(condition.operator)) {
		return condition.value === undefined ? null : 'This operator does not accept a value.';
	}
	if (!condition.value?.trim()) {
		return 'Enter a value.';
	}
	if (condition.value.length > ROW_SECURITY_MAX_VALUE_LENGTH) {
		return 'The value is too long.';
	}
	if (isListOperator(condition.operator) && condition.value.split(',').some((item) => !item.trim())) {
		return 'Remove empty items from the comma-separated list.';
	}
	return null;
}

function operatorNeedsValue(operator: RowSecurityOperator): boolean {
	return operator !== 'is-null' && operator !== 'is-not-null';
}

function isListOperator(operator: RowSecurityOperator): boolean {
	return operator === 'is-one-of' || operator === 'is-not-one-of';
}

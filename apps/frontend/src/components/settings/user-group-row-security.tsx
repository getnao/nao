import {
	compileRowSecurityConditions,
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	ROW_SECURITY_OPERATORS,
	rowSecurityTableKey,
	stripRowSecurityWhereClause,
} from '@nao/shared';
import { Plus, X } from 'lucide-react';
import type {
	ProjectRowSecurity,
	RowSecurityCombinator,
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
	showValidationErrors = false,
	onChange,
}: {
	registry: ProjectRowSecurity;
	policies: UserGroupRowPolicies;
	isLicensed: boolean;
	showValidationErrors?: boolean;
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
							showValidationErrors={showValidationErrors}
							onChange={(policy) => onChange(updatePolicy(policies, table, policy))}
						/>
					))}
				</div>
			)}
		</section>
	);
}

export function areUserGroupRowPolicyDraftsValid(
	registry: ProjectRowSecurity,
	policies: UserGroupRowPolicies,
): boolean {
	const tables = new Map(registry.tables.map((table) => [rowSecurityTableKey(table), table]));
	return policies.policies.every((policy) => {
		if (policy.access === 'full') {
			return true;
		}
		const table = tables.get(rowSecurityTableKey(policy));
		if (!table) {
			return false;
		}
		if (policy.mode === 'sql') {
			return getSqlDraftError(policy.predicate) === null;
		}
		return (
			policy.conditions.length > 0 &&
			policy.conditions.length <= ROW_SECURITY_MAX_CONDITIONS &&
			policy.conditions.every((condition) => getConditionDraftError(condition, table.constraintColumns) === null)
		);
	});
}

function TablePolicyEditor({
	table,
	policy,
	disabled,
	showValidationErrors,
	onChange,
}: {
	table: SensitiveTableDefinition;
	policy?: UserGroupTablePolicy;
	disabled: boolean;
	showValidationErrors: boolean;
	onChange: (policy?: UserGroupTablePolicy) => void;
}) {
	const guidedPolicy = policy?.access === 'predicate' && policy.mode === 'guided' ? policy : null;
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
								mode: 'guided',
								combinator: 'and',
								conditions: guidedPolicy?.conditions.length
									? guidedPolicy.conditions
									: [createCondition(table.constraintColumns[0])],
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
						<SelectItem value='full'>Full access</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{policy?.access === 'predicate' && (
				<div className='flex flex-col gap-2'>
					<div
						className='flex flex-wrap items-center gap-2'
						role='group'
						aria-label={`Filter controls for ${table.table}`}
					>
						<PolicyModeSelector
							table={table}
							mode={policy.mode}
							disabled={disabled}
							onChange={(mode) =>
								onChange(
									mode === 'guided'
										? createGuidedPolicy(table)
										: createSqlPolicy(table, policy.mode === 'guided' ? policy : undefined),
								)
							}
						/>
						{policy.mode === 'guided' && policy.conditions.length >= 2 && (
							<ConditionCombinatorSelector
								table={table}
								combinator={policy.combinator}
								disabled={disabled}
								onChange={(combinator) => onChange({ ...policy, combinator })}
							/>
						)}
					</div>
					{policy.mode === 'guided' ? (
						<GuidedPolicyEditor
							table={table}
							policy={policy}
							disabled={disabled}
							showValidationErrors={showValidationErrors}
							onChange={onChange}
						/>
					) : (
						<SqlPolicyEditor
							table={table}
							policy={policy}
							disabled={disabled}
							showValidationErrors={showValidationErrors}
							onChange={onChange}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function PolicyModeSelector({
	table,
	mode,
	disabled,
	onChange,
}: {
	table: SensitiveTableDefinition;
	mode: 'guided' | 'sql';
	disabled: boolean;
	onChange: (mode: 'guided' | 'sql') => void;
}) {
	return (
		<div
			className='flex w-fit rounded-md border bg-muted/30 p-0.5'
			role='group'
			aria-label={`Filter mode for ${table.table}`}
		>
			<SegmentButton selected={mode === 'guided'} disabled={disabled} onClick={() => onChange('guided')}>
				Guided
			</SegmentButton>
			<SegmentButton selected={mode === 'sql'} disabled={disabled} onClick={() => onChange('sql')}>
				SQL
			</SegmentButton>
		</div>
	);
}

function ConditionCombinatorSelector({
	table,
	combinator,
	disabled,
	onChange,
}: {
	table: SensitiveTableDefinition;
	combinator: RowSecurityCombinator;
	disabled: boolean;
	onChange: (combinator: RowSecurityCombinator) => void;
}) {
	return (
		<div
			className='flex rounded-md border bg-muted/30 p-0.5'
			role='group'
			aria-label={`Condition combination for ${table.table}`}
		>
			{(['and', 'or'] as const).map((value) => (
				<SegmentButton
					key={value}
					selected={combinator === value}
					disabled={disabled}
					onClick={() => onChange(value)}
				>
					{value.toUpperCase()}
				</SegmentButton>
			))}
		</div>
	);
}

function GuidedPolicyEditor({
	table,
	policy,
	disabled,
	showValidationErrors,
	onChange,
}: {
	table: SensitiveTableDefinition;
	policy: Extract<UserGroupTablePolicy, { mode: 'guided' }>;
	disabled: boolean;
	showValidationErrors: boolean;
	onChange: (policy: UserGroupTablePolicy) => void;
}) {
	return (
		<div className='flex flex-col gap-2'>
			{policy.conditions.map((condition, index) => (
				<ConditionEditor
					key={index}
					table={table}
					condition={condition}
					index={index}
					disabled={disabled}
					showValidationErrors={showValidationErrors}
					onChange={(nextCondition) =>
						onChange({
							...policy,
							conditions: replaceAt(policy.conditions, index, nextCondition),
						})
					}
					onRemove={() =>
						onChange({
							...policy,
							conditions: policy.conditions.filter((_, candidateIndex) => candidateIndex !== index),
						})
					}
				/>
			))}
			{showValidationErrors && policy.conditions.length === 0 && (
				<p className='text-xs text-destructive'>Add at least one condition.</p>
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
	);
}

function SqlPolicyEditor({
	table,
	policy,
	disabled,
	showValidationErrors,
	onChange,
}: {
	table: SensitiveTableDefinition;
	policy: Extract<UserGroupTablePolicy, { mode: 'sql' }>;
	disabled: boolean;
	showValidationErrors: boolean;
	onChange: (policy: UserGroupTablePolicy) => void;
}) {
	const error = getSqlDraftError(policy.predicate);
	return (
		<div className='flex flex-col gap-1'>
			<Textarea
				value={policy.predicate}
				disabled={disabled}
				aria-label={`SQL predicate for ${table.table}`}
				aria-invalid={showValidationErrors && error !== null}
				className='min-h-20 resize-y font-mono text-xs'
				placeholder={createSqlExample(table)}
				onChange={(event) => onChange({ ...policy, predicate: event.target.value })}
			/>
			{showValidationErrors && error ? (
				<p className='text-xs text-destructive'>{error}</p>
			) : (
				<p className='text-xs text-muted-foreground'>
					Enter a WHERE clause. Only configured constraint columns may be used.
				</p>
			)}
		</div>
	);
}

function SegmentButton({
	selected,
	disabled,
	onClick,
	children,
}: {
	selected: boolean;
	disabled: boolean;
	onClick: () => void;
	children: string;
}) {
	return (
		<button
			type='button'
			aria-pressed={selected}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
				selected && 'bg-background text-foreground shadow-xs',
			)}
		>
			{children}
		</button>
	);
}

function ConditionEditor({
	table,
	condition,
	index,
	disabled,
	showValidationErrors,
	onChange,
	onRemove,
}: {
	table: SensitiveTableDefinition;
	condition: RowSecurityCondition;
	index: number;
	disabled: boolean;
	showValidationErrors: boolean;
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
						aria-invalid={showValidationErrors && error !== null}
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
			{showValidationErrors && error && <p className='mt-1 text-xs text-destructive'>{error}</p>}
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

function createGuidedPolicy(
	table: SensitiveTableDefinition,
	combinator: RowSecurityCombinator = 'and',
): Extract<UserGroupTablePolicy, { mode: 'guided' }> {
	return {
		...tableIdentity(table),
		access: 'predicate',
		mode: 'guided',
		combinator,
		conditions: [createCondition(table.constraintColumns[0])],
	};
}

function createSqlPolicy(
	table: SensitiveTableDefinition,
	guidedPolicy?: Extract<UserGroupTablePolicy, { mode: 'guided' }>,
): Extract<UserGroupTablePolicy, { mode: 'sql' }> {
	const predicate =
		guidedPolicy &&
		guidedPolicy.conditions.every(
			(condition) => getConditionDraftError(condition, table.constraintColumns) === null,
		)
			? `WHERE ${compileRowSecurityConditions(
					guidedPolicy.conditions,
					table.databaseType,
					guidedPolicy.combinator,
				)}`
			: '';
	return {
		...tableIdentity(table),
		access: 'predicate',
		mode: 'sql',
		predicate,
	};
}

function createSqlExample(table: SensitiveTableDefinition): string {
	return `WHERE ${compileRowSecurityConditions(
		[{ column: table.constraintColumns[0], operator: 'equals', value: 'example' }],
		table.databaseType,
	)}`;
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

function getSqlDraftError(predicate: string): string | null {
	if (!predicate.trim()) {
		return 'Enter a WHERE clause.';
	}
	if (predicate.length > ROW_SECURITY_MAX_VALUE_LENGTH) {
		return 'The WHERE clause is too long.';
	}
	if (!/^\s*where\b/i.test(predicate)) {
		return 'Start with WHERE.';
	}
	if (stripRowSecurityWhereClause(predicate) === null) {
		return 'Enter an expression after WHERE.';
	}
	return null;
}

function operatorNeedsValue(operator: RowSecurityOperator): boolean {
	return operator !== 'is-null' && operator !== 'is-not-null';
}

function isListOperator(operator: RowSecurityOperator): boolean {
	return operator === 'is-one-of' || operator === 'is-not-one-of';
}

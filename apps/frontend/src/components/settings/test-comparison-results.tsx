import {
	ArrowRight,
	ChevronDown,
	ChevronRight,
	CircleCheck,
	CircleDashed,
	CircleX,
	FilePen,
	FilePlus,
	FileX,
} from 'lucide-react';
import { Fragment, useState } from 'react';

import type {
	TestComparison,
	TestComparisonChange,
	TestComparisonRow,
	TestRunResult,
	TestRunWithResults,
} from '@/components/settings/test-run-types';
import {
	AttemptChatLink,
	DetailBlock,
	ResultDetails,
	TestRunActions,
	TestRunProgress,
} from '@/components/settings/test-run-results';
import { formatPassRate, isActiveRun, onEnterOrSpace } from '@/components/settings/test-run-types';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type ContextChange = NonNullable<TestRunWithResults['contextChanges']>[number];
type VariantOutcome = TestComparison['production'];

const CHANGE_BADGES: Record<
	TestComparisonChange,
	{ label: string; variant: 'success' | 'error' | 'viewer' | 'secondary' }
> = {
	regressed: { label: 'Regressed', variant: 'error' },
	worsened: { label: 'Less reliable', variant: 'error' },
	fixed: { label: 'Fixed', variant: 'success' },
	improved: { label: 'More reliable', variant: 'success' },
	unchanged: { label: 'No change', variant: 'viewer' },
	pending: { label: 'Running', variant: 'secondary' },
};

const CHANGE_KIND_DISPLAY = {
	added: { icon: FilePlus, label: 'New', color: 'text-emerald-500' },
	modified: { icon: FilePen, label: 'Edited', color: 'text-amber-500' },
	deleted: { icon: FileX, label: 'Removed', color: 'text-red-500' },
} as const;

const SUMMARY_CHANGES: TestComparisonChange[] = ['regressed', 'worsened', 'fixed', 'improved', 'unchanged'];
const MAX_LISTED_CHANGES = 6;

interface TestComparisonResultsProps {
	run: TestRunWithResults;
	comparison: TestComparison;
	isCancelling: boolean;
	onCancel: () => void;
	onClose: () => void;
}

export function TestComparisonResults({
	run,
	comparison,
	isCancelling,
	onCancel,
	onClose,
}: TestComparisonResultsProps) {
	const [expandedTestPath, setExpandedTestPath] = useState<string | null>(null);
	const isActive = isActiveRun(run);
	const attemptsPerVariant = run.models.length * run.attempts;

	return (
		<SettingsCard
			title={`Comparison of ${new Date(run.createdAt).toLocaleString()}`}
			description={<TestRunProgress run={run} />}
			action={
				<TestRunActions isActive={isActive} isCancelling={isCancelling} onCancel={onCancel} onClose={onClose} />
			}
			flush
		>
			<div className='flex flex-col'>
				<ComparisonSummary comparison={comparison} isActive={isActive} />
				<ContextChangesSummary branch={run.contextRef} changes={run.contextChanges ?? []} />
				{comparison.tests.length === 0 ? (
					<Empty className='py-6'>
						{isActive ? 'Waiting for the first results…' : 'No results recorded.'}
					</Empty>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className='w-6' />
								<TableHead>Test</TableHead>
								<TableHead>Production</TableHead>
								<TableHead>Your changes</TableHead>
								<TableHead>Change</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{comparison.tests.map((test) => (
								<Fragment key={test.testPath}>
									<ComparisonRow
										test={test}
										attemptsPerVariant={attemptsPerVariant}
										isActive={isActive}
										isExpanded={expandedTestPath === test.testPath}
										onToggle={() =>
											setExpandedTestPath(
												expandedTestPath === test.testPath ? null : test.testPath,
											)
										}
									/>
									{expandedTestPath === test.testPath && (
										<TableRow className='hover:bg-transparent'>
											<TableCell colSpan={5} className='bg-muted/30'>
												<VariantAttempts
													results={run.results.filter(
														(result) => result.testPath === test.testPath,
													)}
												/>
											</TableCell>
										</TableRow>
									)}
								</Fragment>
							))}
						</TableBody>
					</Table>
				)}
			</div>
		</SettingsCard>
	);
}

function ComparisonSummary({ comparison, isActive }: { comparison: TestComparison; isActive: boolean }) {
	const delta = passRateDelta(comparison.production, comparison.draft);
	return (
		<div className='flex flex-wrap items-center justify-between gap-4 border-b p-4'>
			<div className='flex items-center gap-4'>
				<VariantScore label='Production' outcome={comparison.production} />
				<ArrowRight className='size-4 text-muted-foreground' />
				<VariantScore label='Your changes' outcome={comparison.draft} />
				{delta !== null && (
					<span
						className={cn(
							'text-sm font-medium',
							delta > 0 && 'text-green-600 dark:text-green-500',
							delta < 0 && 'text-destructive',
							delta === 0 && 'text-muted-foreground',
						)}
					>
						{delta > 0 ? '+' : ''}
						{delta} pts
					</span>
				)}
			</div>
			<div className='flex flex-wrap items-center gap-1.5'>
				{SUMMARY_CHANGES.filter((change) => comparison.counts[change] > 0).map((change) => (
					<Badge key={change} variant={CHANGE_BADGES[change].variant}>
						{comparison.counts[change]} {CHANGE_BADGES[change].label.toLowerCase()}
					</Badge>
				))}
				{comparison.counts.pending > 0 && (
					<Badge variant='secondary'>
						{comparison.counts.pending} {isActive ? 'running' : 'incomplete'}
					</Badge>
				)}
			</div>
		</div>
	);
}

function VariantScore({ label, outcome }: { label: string; outcome: VariantOutcome }) {
	return (
		<div className='flex flex-col'>
			<span className='text-xs text-muted-foreground'>{label}</span>
			<span className='text-xl font-semibold text-foreground'>
				{formatPassRate(outcome.passed, outcome.total)}
				<span className='ml-1.5 text-xs font-normal text-muted-foreground'>
					{outcome.passed}/{outcome.total} attempts
				</span>
			</span>
		</div>
	);
}

function ContextChangesSummary({ branch, changes }: { branch: string | null; changes: ContextChange[] }) {
	if (changes.length === 0) {
		return null;
	}
	const hiddenCount = changes.length - MAX_LISTED_CHANGES;
	return (
		<div className='flex flex-col gap-1.5 border-b px-4 py-3 text-xs'>
			<span className='text-muted-foreground'>
				{changes.length} changed file{changes.length === 1 ? '' : 's'}
				{branch && (
					<>
						{' '}
						on <span className='font-mono text-foreground'>{branch}</span>
					</>
				)}
			</span>
			<div className='flex flex-wrap gap-x-4 gap-y-1'>
				{changes.slice(0, MAX_LISTED_CHANGES).map((change) => (
					<ContextChangeItem key={change.path} change={change} />
				))}
				{hiddenCount > 0 && <span className='text-muted-foreground'>+{hiddenCount} more</span>}
			</div>
		</div>
	);
}

export function ContextChangeItem({ change }: { change: ContextChange }) {
	const display = CHANGE_KIND_DISPLAY[change.kind];
	const Icon = display.icon;
	return (
		<span className='flex min-w-0 items-center gap-1.5' title={`${display.label}: ${change.path}`}>
			<Icon className={cn('size-3 shrink-0', display.color)} />
			<span className='truncate font-mono'>{change.path}</span>
		</span>
	);
}

interface ComparisonRowProps {
	test: TestComparisonRow;
	attemptsPerVariant: number;
	isActive: boolean;
	isExpanded: boolean;
	onToggle: () => void;
}

function ComparisonRow({ test, attemptsPerVariant, isActive, isExpanded, onToggle }: ComparisonRowProps) {
	const Chevron = isExpanded ? ChevronDown : ChevronRight;
	const badge = CHANGE_BADGES[test.change];
	return (
		<TableRow
			className='cursor-pointer'
			tabIndex={0}
			aria-expanded={isExpanded}
			onClick={onToggle}
			onKeyDown={onEnterOrSpace(onToggle)}
		>
			<TableCell>
				<Chevron className='size-3.5 text-muted-foreground' />
			</TableCell>
			<TableCell className='max-w-[260px]'>
				<div className='flex flex-col'>
					<span className='truncate font-medium'>{test.testName}</span>
					<span className='truncate font-mono text-xs text-muted-foreground'>tests/{test.testPath}</span>
				</div>
			</TableCell>
			<TableCell>
				<VariantOutcomeCell outcome={test.production} attemptsPerVariant={attemptsPerVariant} />
			</TableCell>
			<TableCell>
				<VariantOutcomeCell outcome={test.draft} attemptsPerVariant={attemptsPerVariant} />
			</TableCell>
			<TableCell>
				<Badge variant={badge.variant}>
					{test.change === 'pending' && !isActive ? 'Incomplete' : badge.label}
				</Badge>
			</TableCell>
		</TableRow>
	);
}

function VariantOutcomeCell({ outcome, attemptsPerVariant }: { outcome: VariantOutcome; attemptsPerVariant: number }) {
	if (outcome.total === 0) {
		return (
			<span className='flex items-center gap-1 text-xs text-muted-foreground'>
				<CircleDashed className='size-3.5' />
				Waiting
			</span>
		);
	}
	const allPassed = outcome.passed === outcome.total;
	const nonePassed = outcome.passed === 0;
	const Icon = allPassed ? CircleCheck : nonePassed ? CircleX : CircleDashed;
	return (
		<span
			className={cn(
				'flex items-center gap-1 text-xs',
				allPassed && 'text-green-600 dark:text-green-500',
				nonePassed && 'text-destructive',
				!allPassed && !nonePassed && 'text-amber-600 dark:text-amber-500',
			)}
		>
			<Icon className='size-3.5 shrink-0' />
			{attemptsPerVariant === 1 ? (allPassed ? 'Passed' : 'Failed') : `${outcome.passed}/${outcome.total} passed`}
		</span>
	);
}

function VariantAttempts({ results }: { results: TestRunResult[] }) {
	const referenceSql = results.find((result) => result.details?.referenceSql)?.details?.referenceSql;
	return (
		<div className='flex flex-col gap-3 py-1 text-xs'>
			<DetailBlock label='Reference SQL' value={referenceSql} isCode />
			<div className='grid grid-cols-2 gap-4'>
				<VariantAttemptsColumn
					label='Production'
					results={results.filter((result) => result.contextVariant === 'production')}
				/>
				<VariantAttemptsColumn
					label='Your changes'
					results={results.filter((result) => result.contextVariant === 'draft')}
				/>
			</div>
		</div>
	);
}

function VariantAttemptsColumn({ label, results }: { label: string; results: TestRunResult[] }) {
	return (
		<div className='flex min-w-0 flex-col gap-3'>
			<span className='text-xs font-semibold text-foreground'>{label}</span>
			{results.length === 0 && <span className='text-xs text-muted-foreground'>No attempt yet.</span>}
			{results.map((result) => (
				<div key={result.id} className='flex min-w-0 flex-col gap-1 rounded-md border bg-background p-2'>
					<div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
						<span>
							Attempt {result.attempt} · {result.llmModelId}
						</span>
						<AttemptChatLink result={result} />
					</div>
					<ResultDetails result={result} showReferenceSql={false} />
				</div>
			))}
		</div>
	);
}

function passRateDelta(production: VariantOutcome, draft: VariantOutcome): number | null {
	if (production.total === 0 || draft.total === 0) {
		return null;
	}
	return Math.round((draft.passed / draft.total) * 100) - Math.round((production.passed / production.total) * 100);
}

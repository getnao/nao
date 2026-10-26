import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, CircleCheck, CircleX, MessageSquare, X } from 'lucide-react';
import { Fragment, useState } from 'react';

import type { TestRunResult, TestRunWithResults } from '@/components/settings/test-run-types';
import { formatCost, formatPassRate, isActiveRun } from '@/components/settings/test-run-types';
import { TestRunStatusBadge } from '@/components/settings/test-runs-table';
import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { SettingsCard } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface TestRunResultsProps {
	run: TestRunWithResults;
	isCancelling: boolean;
	onCancel: () => void;
	onClose: () => void;
}

export function TestRunResults({ run, isCancelling, onCancel, onClose }: TestRunResultsProps) {
	const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
	const isActive = isActiveRun(run);
	const showAttempt = run.attempts > 1;

	return (
		<SettingsCard
			title={`Run of ${new Date(run.createdAt).toLocaleString()}`}
			description={<TestRunProgress run={run} />}
			action={
				<div className='flex items-center gap-1'>
					{isActive && (
						<Button size='sm' variant='ghost' onClick={onCancel} disabled={isCancelling}>
							{isCancelling ? <Spinner className='size-4' /> : <X className='size-4' />}
							Cancel run
						</Button>
					)}
					<Button size='icon-sm' variant='ghost' onClick={onClose} aria-label='Close run'>
						<X className='size-4' />
					</Button>
				</div>
			}
			flush
		>
			{run.results.length === 0 ? (
				<Empty className='py-6'>{isActive ? 'Waiting for the first results…' : 'No results recorded.'}</Empty>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className='w-6' />
							<TableHead>Test</TableHead>
							<TableHead>Model</TableHead>
							{showAttempt && <TableHead>Attempt</TableHead>}
							<TableHead>Result</TableHead>
							<TableHead className='text-right'>Time</TableHead>
							<TableHead className='text-right'>Cost</TableHead>
							<TableHead className='w-8' />
						</TableRow>
					</TableHeader>
					<TableBody>
						{run.results.map((result) => (
							<Fragment key={result.id}>
								<ResultRow
									result={result}
									showAttempt={showAttempt}
									isExpanded={expandedResultId === result.id}
									onToggle={() =>
										setExpandedResultId(expandedResultId === result.id ? null : result.id)
									}
								/>
								{expandedResultId === result.id && (
									<TableRow className='hover:bg-transparent'>
										<TableCell colSpan={showAttempt ? 8 : 7} className='bg-muted/30'>
											<ResultDetails result={result} />
										</TableCell>
									</TableRow>
								)}
							</Fragment>
						))}
					</TableBody>
				</Table>
			)}
		</SettingsCard>
	);
}

function TestRunProgress({ run }: { run: TestRunWithResults }) {
	return (
		<span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
			<TestRunStatusBadge status={run.status} />
			<span>
				{run.completedAttempts}/{run.totalAttempts} attempts
			</span>
			<span>{formatPassRate(run.passedAttempts, run.completedAttempts)} passed</span>
			<span>{formatCost(run.totalCost)}</span>
			<span>{run.models.map((model) => model.modelId).join(', ')}</span>
			{run.errorMessage && <span className='text-destructive'>{run.errorMessage}</span>}
		</span>
	);
}

interface ResultRowProps {
	result: TestRunResult;
	showAttempt: boolean;
	isExpanded: boolean;
	onToggle: () => void;
}

function ResultRow({ result, showAttempt, isExpanded, onToggle }: ResultRowProps) {
	const Chevron = isExpanded ? ChevronDown : ChevronRight;
	const Icon = result.passed ? CircleCheck : CircleX;

	return (
		<TableRow className='cursor-pointer' onClick={onToggle}>
			<TableCell>
				<Chevron className='size-3.5 text-muted-foreground' />
			</TableCell>
			<TableCell className='max-w-[220px] truncate font-medium' title={result.testPath}>
				{result.testName}
			</TableCell>
			<TableCell className='text-xs text-muted-foreground'>{result.llmModelId}</TableCell>
			{showAttempt && <TableCell className='text-xs text-muted-foreground'>{result.attempt}</TableCell>}
			<TableCell className='max-w-[280px]'>
				<span
					className={
						result.passed
							? 'flex items-center gap-1 text-xs text-green-600 dark:text-green-500'
							: 'flex items-center gap-1 text-xs text-destructive'
					}
				>
					<Icon className='size-3.5 shrink-0' />
					<span className='truncate'>{result.message}</span>
				</span>
			</TableCell>
			<TableCell className='text-right text-xs text-muted-foreground'>
				{result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : '—'}
			</TableCell>
			<TableCell className='text-right text-xs text-muted-foreground'>{formatCost(result.totalCost)}</TableCell>
			<TableCell onClick={(event) => event.stopPropagation()}>
				{result.chatId && (
					<Button size='icon-sm' variant='ghost' asChild>
						<Link
							to='/settings/usage/replay/$chatId'
							params={{ chatId: result.chatId }}
							search={{ ...DEFAULT_USAGE_SEARCH, origin: 'tests', testRunId: result.runId }}
							aria-label='Open the chat of this attempt'
						>
							<MessageSquare className='size-3.5' />
						</Link>
					</Button>
				)}
			</TableCell>
		</TableRow>
	);
}

function ResultDetails({ result }: { result: TestRunResult }) {
	const details = result.details;
	return (
		<div className='flex flex-col gap-3 py-1 text-xs'>
			<DetailBlock label='Result' value={result.errorMessage ?? result.message} />
			<DetailBlock label='Differences' value={details?.comparison} isCode />
			<DetailBlock label='Answer' value={details?.responseText} />
			<DetailBlock label='Reference SQL' value={details?.referenceSql} isCode />
			<DetailBlock label='Verification SQL' value={details?.verificationSql} isCode />
		</div>
	);
}

function DetailBlock({ label, value, isCode }: { label: string; value: string | null | undefined; isCode?: boolean }) {
	if (!value) {
		return null;
	}
	return (
		<div className='flex flex-col gap-1'>
			<span className='font-medium text-foreground'>{label}</span>
			{isCode ? (
				<pre className='max-h-60 overflow-auto rounded-md bg-background p-2 font-mono whitespace-pre-wrap'>
					{value}
				</pre>
			) : (
				<p className='max-h-60 overflow-auto whitespace-pre-wrap text-muted-foreground'>{value}</p>
			)}
		</div>
	);
}

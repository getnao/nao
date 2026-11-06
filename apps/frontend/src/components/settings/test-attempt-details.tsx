import { pluralize } from '@nao/shared';
import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { useId, useState } from 'react';

import type { RunBranches } from '@/components/settings/test-run-labels';
import type { TestRunResult } from '@/components/settings/test-run-types';
import type { TabBarItem } from '@/components/ui/tab-bar';
import { AttemptAnswer } from '@/components/settings/test-attempt-chat';
import { AttemptSql, ComparedAttemptSql } from '@/components/settings/test-attempt-sql';
import { TestDataDiffView } from '@/components/settings/test-data-diff';
import { AttemptSideHeader, BranchName } from '@/components/settings/test-run-labels';
import { formatCost, formatCount, formatDuration } from '@/components/settings/test-run-types';
import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { Button } from '@/components/ui/button';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';

type AttemptTab = 'data' | 'answer' | 'sql';

export type ShownAttempt =
	| { kind: 'single'; attempt: number; result: TestRunResult }
	| { kind: 'comparison'; attempt: number; production: TestRunResult | null; draft: TestRunResult | null };

const ATTEMPT_TABS: TabBarItem<AttemptTab>[] = [
	{ id: 'data', label: 'Data' },
	{ id: 'answer', label: 'Answer' },
	{ id: 'sql', label: 'SQL' },
];

const REFERENCE_SIDES = { removed: 'the reference', added: "the agent's answer" };

export function TestAttemptDetails({ shownAttempt, branches }: { shownAttempt: ShownAttempt; branches: RunBranches }) {
	const idBase = useId();
	const [tab, setTab] = useState<AttemptTab>(() =>
		listAttemptResults(shownAttempt).some((result) => result.details?.referenceSql) ? 'data' : 'answer',
	);

	return (
		<div className='flex min-h-0 min-w-0 flex-1 flex-col'>
			<div className='flex shrink-0 items-center gap-1 border-b px-3'>
				<TabBar
					tabs={ATTEMPT_TABS}
					activeTab={tab}
					onTabChange={setTab}
					idBase={idBase}
					label='Attempt details'
					size='sm'
					className='shrink-0 items-center'
				/>
				<AttemptMetrics shownAttempt={shownAttempt} />
			</div>
			{tab === 'data' && (
				<TabPanel idBase={idBase} tabId='data' className='flex min-h-0 flex-1 flex-col overflow-auto text-xs'>
					{shownAttempt.kind === 'single' ? (
						<AttemptData result={shownAttempt.result} />
					) : (
						<ComparedAttemptData
							production={shownAttempt.production}
							draft={shownAttempt.draft}
							branches={branches}
						/>
					)}
				</TabPanel>
			)}
			{tab === 'answer' && (
				<TabPanel idBase={idBase} tabId='answer' className='flex min-h-0 flex-1 flex-col text-xs'>
					{shownAttempt.kind === 'single' ? (
						<AttemptAnswer result={shownAttempt.result} />
					) : (
						<ComparedAnswers
							production={shownAttempt.production}
							draft={shownAttempt.draft}
							branches={branches}
						/>
					)}
				</TabPanel>
			)}
			{tab === 'sql' && (
				<TabPanel idBase={idBase} tabId='sql' className='min-h-0 flex-1 overflow-auto p-3 text-xs'>
					{shownAttempt.kind === 'single' ? (
						<AttemptSql result={shownAttempt.result} />
					) : (
						<ComparedAttemptSql
							production={shownAttempt.production}
							draft={shownAttempt.draft}
							branches={branches}
						/>
					)}
				</TabPanel>
			)}
		</div>
	);
}

function AttemptChatLink({ result }: { result: TestRunResult }) {
	if (!result.chatId) {
		return null;
	}
	return (
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
	);
}

function AttemptMetrics({ shownAttempt }: { shownAttempt: ShownAttempt }) {
	if (shownAttempt.kind === 'single') {
		return (
			<span className='ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
				<span className='truncate tabular-nums'>{describeAttemptMetrics(shownAttempt.result)}</span>
				<AttemptChatLink result={shownAttempt.result} />
			</span>
		);
	}
	return (
		<span className='ml-auto min-w-0 truncate py-1.5 text-xs text-muted-foreground tabular-nums'>
			{describeComparedMetrics(shownAttempt.production, shownAttempt.draft)}
		</span>
	);
}

function AttemptData({ result }: { result: TestRunResult }) {
	const details = result.details;
	if (result.errorMessage) {
		return <p className='p-3 text-destructive'>The attempt failed before it could answer: {result.errorMessage}</p>;
	}
	if (!details?.referenceSql) {
		return (
			<p className='p-3 text-muted-foreground'>
				This test has no reference <code className='font-mono'>sql</code>, so there is no data to compare. Only
				its assertions are checked.
			</p>
		);
	}
	if (result.dataDiff) {
		return <TestDataDiffView diff={result.dataDiff} sides={REFERENCE_SIDES} />;
	}
	if (!details.actualData) {
		return <p className='p-3 text-muted-foreground'>The agent returned no data to compare: {result.message}.</p>;
	}
	const differences = details.comparison ?? result.message;
	return (
		<div className='p-3'>
			{differences && (
				<div className='flex flex-col gap-1'>
					<span className='font-medium text-foreground'>Differences</span>
					<pre className='max-h-60 overflow-auto rounded-md bg-background p-2 font-mono whitespace-pre-wrap'>
						{differences}
					</pre>
				</div>
			)}
		</div>
	);
}

function ComparedAttemptData({
	production,
	draft,
	branches,
}: {
	production: TestRunResult | null;
	draft: TestRunResult | null;
	branches: RunBranches;
}) {
	if (draft?.variantDiff) {
		return (
			<TestDataDiffView diff={draft.variantDiff} sides={{ removed: branches.main, added: branches.changes }} />
		);
	}
	const sides = [
		{ result: production, branch: branches.main },
		{ result: draft, branch: branches.changes },
	];
	return (
		<div className='flex flex-col gap-1.5 p-3 text-muted-foreground'>
			{sides.map((side) => (
				<p key={side.branch}>
					<BranchName name={side.branch} />: {describeMissingData(side.result)}
				</p>
			))}
		</div>
	);
}

function ComparedAnswers({
	production,
	draft,
	branches,
}: {
	production: TestRunResult | null;
	draft: TestRunResult | null;
	branches: RunBranches;
}) {
	const sides = [
		{ result: production, branch: branches.main },
		{ result: draft, branch: branches.changes },
	];
	return (
		<div className='grid min-h-0 flex-1 grid-cols-2 divide-x'>
			{sides.map((side) => (
				<div key={side.branch} className='flex min-h-0 min-w-0 flex-col'>
					<div className='flex h-8 shrink-0 items-center border-b px-3'>
						<AttemptSideHeader result={side.result} branch={side.branch}>
							{side.result && <AttemptChatLink result={side.result} />}
						</AttemptSideHeader>
					</div>
					{side.result ? (
						<AttemptAnswer result={side.result} />
					) : (
						<p className='p-3 text-muted-foreground'>No attempt recorded on this branch.</p>
					)}
				</div>
			))}
		</div>
	);
}

function listAttemptResults(shownAttempt: ShownAttempt): TestRunResult[] {
	if (shownAttempt.kind === 'single') {
		return [shownAttempt.result];
	}
	return [shownAttempt.production, shownAttempt.draft].filter((result): result is TestRunResult => !!result);
}

function describeMissingData(result: TestRunResult | null): string {
	if (!result) {
		return 'no attempt recorded yet.';
	}
	if (result.errorMessage) {
		return `the attempt failed before it could answer: ${result.errorMessage}`;
	}
	if (!result.details?.referenceSql) {
		return 'this test has no reference SQL, so no data was kept.';
	}
	if (!result.details.actualData) {
		return `the agent returned no data: ${result.message}`;
	}
	return 'the data of the other branch is missing.';
}

function describeAttemptMetrics(result: TestRunResult): string {
	return [
		result.llmModelId,
		result.durationMs ? formatDuration(result.durationMs) : null,
		result.toolCallCount !== null
			? `${result.toolCallCount} ${pluralize('tool call', result.toolCallCount)}`
			: null,
		result.totalTokens !== null ? `${formatCount(result.totalTokens)} tokens` : null,
		result.totalCost !== null ? formatCost(result.totalCost) : null,
	]
		.filter((part) => part !== null)
		.join(' · ');
}

/** The metrics of both branches of an attempt, as "before → after" when they differ. */
function describeComparedMetrics(production: TestRunResult | null, draft: TestRunResult | null): string {
	const compare = (value: (result: TestRunResult) => number | null, format: (value: number) => string) =>
		compareMetric(production && value(production), draft && value(draft), format);
	const lastToolCallCount = draft?.toolCallCount ?? production?.toolCallCount ?? 0;
	return [
		(draft ?? production)?.llmModelId ?? null,
		compare((result) => result.durationMs || null, formatDuration),
		compare((result) => result.toolCallCount, formatCount)?.concat(` ${pluralize('tool call', lastToolCallCount)}`),
		compare((result) => result.totalTokens, formatCount)?.concat(' tokens'),
		compare((result) => result.totalCost, formatCost),
	]
		.filter((part) => part !== null && part !== undefined)
		.join(' · ');
}

function compareMetric(before: number | null, after: number | null, format: (value: number) => string): string | null {
	if (before === null || after === null) {
		const value = before ?? after;
		return value === null ? null : format(value);
	}
	return before === after ? format(after) : `${format(before)} → ${format(after)}`;
}

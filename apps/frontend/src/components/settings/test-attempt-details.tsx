import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { TestRunResult } from '@/components/settings/test-run-types';
import { TestDataDiffView } from '@/components/settings/test-data-diff';
import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AttemptTab = 'data' | 'answer' | 'sql';

const ATTEMPT_TABS: { id: AttemptTab; label: string }[] = [
	{ id: 'data', label: 'Data' },
	{ id: 'answer', label: 'Answer' },
	{ id: 'sql', label: 'SQL' },
];

/** What one attempt answered, next to what the test expected. */
export function TestAttemptDetails({ result, actions }: { result: TestRunResult; actions?: ReactNode }) {
	const [tab, setTab] = useState<AttemptTab>(() => (result.details?.referenceSql ? 'data' : 'answer'));

	return (
		<div className='flex min-h-0 min-w-0 flex-1 flex-col'>
			<div className='flex shrink-0 items-center gap-1 border-b px-3'>
				<div role='tablist' aria-label='Attempt details' className='flex items-center'>
					{ATTEMPT_TABS.map((attemptTab) => (
						<button
							key={attemptTab.id}
							type='button'
							role='tab'
							aria-selected={tab === attemptTab.id}
							onClick={() => setTab(attemptTab.id)}
							className={cn(
								'-mb-px cursor-pointer border-b-2 px-2 py-1.5 text-xs font-medium transition-colors',
								tab === attemptTab.id
									? 'border-primary text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground',
							)}
						>
							{attemptTab.label}
						</button>
					))}
				</div>
				<div className='ml-auto flex items-center'>{actions}</div>
			</div>
			<div role='tabpanel' className='min-h-0 flex-1 overflow-auto p-3 text-xs'>
				{tab === 'data' && <AttemptData result={result} />}
				{tab === 'answer' && (
					<div className='flex flex-col gap-3'>
						<DetailBlock label='Verdict' value={result.errorMessage ?? result.message} />
						<DetailBlock label="Agent's answer" value={result.details?.responseText} />
						{!result.details?.responseText && <p className='text-muted-foreground'>No answer recorded.</p>}
					</div>
				)}
				{tab === 'sql' && <AttemptSql result={result} />}
			</div>
		</div>
	);
}

/** Opens the chat of an attempt, to replay how the agent answered. */
export function AttemptChatLink({ result }: { result: TestRunResult }) {
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

export function DetailBlock({
	label,
	value,
	isCode,
}: {
	label: string;
	value: string | null | undefined;
	isCode?: boolean;
}) {
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

function AttemptData({ result }: { result: TestRunResult }) {
	const details = result.details;
	if (result.errorMessage) {
		return <p className='text-destructive'>The attempt failed before it could answer: {result.errorMessage}</p>;
	}
	if (!details?.referenceSql) {
		return (
			<p className='text-muted-foreground'>
				This test has no reference <code className='font-mono'>sql</code>, so there is no data to compare. Only
				its assertions are checked.
			</p>
		);
	}
	if (result.dataDiff) {
		return <TestDataDiffView diff={result.dataDiff} />;
	}
	if (!details.actualData) {
		return <p className='text-muted-foreground'>The agent returned no data to compare: {result.message}.</p>;
	}
	return <DetailBlock label='Differences' value={details.comparison ?? result.message} isCode />;
}

function AttemptSql({ result }: { result: TestRunResult }) {
	const details = result.details;
	if (!details?.verificationSql && !details?.referenceSql) {
		return <p className='text-muted-foreground'>No SQL recorded for this attempt.</p>;
	}
	return (
		<div className='grid gap-3 lg:grid-cols-2'>
			<DetailBlock label="Agent's SQL" value={details.verificationSql ?? 'The agent ran no query.'} isCode />
			<DetailBlock label='Reference SQL' value={details.referenceSql} isCode />
		</div>
	);
}

import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, CircleX, FlaskConical, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TestRunWithResults } from '@/components/settings/test-run-types';
import { formatPassRate, isActiveRun } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpc } from '@/main';

const VALIDATION_DEBOUNCE_MS = 500;
const ACTIVE_RUN_REFETCH_MS = 2_000;

interface TestFileToolbarProps {
	filePath: string;
	content: string;
}

export function TestFileToolbar({ filePath, content }: TestFileToolbarProps) {
	const debouncedContent = useDebouncedValue(content, VALIDATION_DEBOUNCE_MS);
	const [startedRun, setStartedRun] = useState<{ id: string; content: string } | null>(null);
	const validation = useMutation(trpc.testRun.validateTestFile.mutationOptions());
	const { mutate: validate } = validation;
	const run = useQuery({
		...trpc.testRun.getRun.queryOptions({ runId: startedRun?.id ?? '' }),
		enabled: startedRun !== null,
		refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const startRun = useMutation(
		trpc.testRun.startDraftRun.mutationOptions({
			onSuccess: (createdRun, input) => setStartedRun({ id: createdRun.id, content: input.content }),
		}),
	);

	useEffect(() => {
		validate({ path: filePath, content: debouncedContent });
	}, [validate, filePath, debouncedContent]);

	const isValidationCurrent = validation.isSuccess && validation.variables.content === content;
	const isRunning = startRun.isPending || (!!run.data && isActiveRun(run.data));
	const isRunOfCurrentContent = startedRun?.content === content;
	const canRun = isValidationCurrent && !!validation.data.test && !isRunning;

	return (
		<div
			role='toolbar'
			aria-label='Test file'
			className='flex w-full shrink-0 items-center gap-3 border-b border-border bg-muted/20 px-4 py-1.5 text-xs'
		>
			<FlaskConical className='size-3.5 shrink-0 text-muted-foreground' />
			<div className='min-w-0 flex-1'>
				<ValidationSummary
					validation={isValidationCurrent ? validation.data : undefined}
					error={validation.error?.message}
				/>
			</div>
			<RunOutcome
				run={isRunOfCurrentContent || isRunning ? run.data : undefined}
				error={startRun.error?.message}
			/>
			<Button
				type='button'
				size='sm'
				variant='outline'
				className='h-7 gap-1.5'
				disabled={!canRun}
				onClick={() => startRun.mutate({ path: filePath, content })}
			>
				{isRunning ? <Spinner className='size-3.5' /> : <Play className='size-3.5' />}
				Run test
			</Button>
		</div>
	);
}

/** Whether the explorer path is a test definition, mirroring the files `nao test` discovers. */
export function isTestFilePath(filePath: string): boolean {
	const segments = filePath.replaceAll('\\', '/').replace(/^\/+/, '').split('/');
	const fileName = segments.at(-1) ?? '';
	return (
		segments.length > 1 &&
		segments[0] === 'tests' &&
		!segments.slice(1, -1).includes('outputs') &&
		/\.ya?ml$/.test(fileName)
	);
}

function ValidationSummary({
	validation,
	error,
}: {
	validation:
		| { test: { name: string; tags: string[]; assertions: unknown[] } | null; error: string | null }
		| undefined;
	error: string | undefined;
}) {
	if (error) {
		return <span className='block truncate text-destructive'>Could not check the test: {error}</span>;
	}
	if (!validation) {
		return <span className='text-muted-foreground'>Checking test…</span>;
	}
	if (validation.error !== null || !validation.test) {
		return (
			<SimpleTooltip content={<pre className='whitespace-pre-wrap font-mono'>{validation.error}</pre>}>
				<span className='flex min-w-0 items-center gap-1 text-destructive'>
					<CircleAlert className='size-3.5 shrink-0' />
					<span className='truncate'>Invalid test: {validation.error}</span>
				</span>
			</SimpleTooltip>
		);
	}
	return (
		<span className='block truncate text-muted-foreground'>
			<span className='font-medium text-foreground'>{validation.test.name}</span>
			{validation.test.tags.length > 0 && <> · {validation.test.tags.join(', ')}</>}
			{validation.test.assertions.length > 0 && (
				<> · {pluralize(validation.test.assertions.length, 'assertion')}</>
			)}
		</span>
	);
}

function RunOutcome({ run, error }: { run: TestRunWithResults | undefined; error: string | undefined }) {
	if (error) {
		return <span className='max-w-64 truncate text-destructive'>{error}</span>;
	}
	if (!run) {
		return null;
	}
	return (
		<Link
			to='/settings/tests'
			search={{ run: run.id }}
			className='flex shrink-0 items-center gap-1 underline-offset-4 hover:underline'
		>
			<RunOutcomeLabel run={run} />
		</Link>
	);
}

function RunOutcomeLabel({ run }: { run: TestRunWithResults }) {
	if (isActiveRun(run)) {
		return (
			<span className='text-muted-foreground'>
				Running {run.completedAttempts}/{run.totalAttempts}
			</span>
		);
	}
	if (run.status !== 'completed') {
		return <span className='text-muted-foreground'>Run {run.status}</span>;
	}
	const hasPassed = run.passedAttempts === run.totalAttempts;
	const Icon = hasPassed ? CircleCheck : CircleX;
	return (
		<span className={hasPassed ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
			<Icon className='mr-1 inline size-3.5 align-[-2px]' />
			{hasPassed ? 'Passed' : `Failed · ${formatPassRate(run.passedAttempts, run.totalAttempts)} passed`}
		</span>
	);
}

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

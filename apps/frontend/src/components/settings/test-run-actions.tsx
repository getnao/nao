import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, GitCompareArrows, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { TestModelPicker } from '@/components/settings/test-model-picker';
import { getContextChanges } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface RunActionsBaseProps {
	settings: TestRunSettings;
	draft: DraftContext | null;
	activeRun: TestRunSummary | undefined;
	onRunStarted: (run: { id: string }) => void;
}

export interface SuiteRunScope {
	/** The tests to run, or undefined for the whole suite. */
	paths: string[] | undefined;
	testCount: number;
	/** Names the scope in the button, such as "6 tests" or "2 selected". */
	label: string;
}

/** Runs the test suite, or the tests picked in it, from the drawer's tab row. */
export function SuiteRunActions({
	settings,
	draft,
	activeRun,
	scope,
	onRunStarted,
}: RunActionsBaseProps & { scope: SuiteRunScope }) {
	const startRun = useMutation(trpc.testRun.startRun.mutationOptions({ onSuccess: onRunStarted }));
	const startComparison = useMutation(trpc.testRun.startComparisonRun.mutationOptions({ onSuccess: onRunStarted }));
	const hasContextChanges = getContextChanges(draft).length > 0;
	const runSettings = { models: settings.models, attempts: settings.attempts };
	const disabledReason =
		scope.testCount === 0
			? 'Add a test to the tests/ folder first.'
			: settings.models.length === 0
				? 'Loading the models…'
				: startRun.isPending || startComparison.isPending
					? 'Starting the run…'
					: null;

	const run = () => {
		startComparison.reset();
		startRun.mutate({ paths: scope.paths, ...runSettings });
	};
	const compare = () => {
		startRun.reset();
		startComparison.mutate({ paths: scope.paths, ...runSettings });
	};
	const verb = settings.models.length > 1 ? 'Benchmark' : 'Run';

	return (
		<RunActionsRow
			error={startRun.error?.message ?? startComparison.error?.message}
			picker={
				<TestModelPicker
					settings={settings}
					testCount={scope.testCount}
					variantCount={hasContextChanges ? 2 : 1}
					disabled={!!activeRun}
				/>
			}
			activeRun={activeRun}
		>
			{hasContextChanges ? (
				<CompareButton
					label={`Compare ${scope.label} with production`}
					tooltip='Runs the tests on production and with your changes, side by side, to see which ones your changes break or fix.'
					disabledReason={disabledReason}
					isStarting={startRun.isPending || startComparison.isPending}
					onCompare={compare}
					onRunOnProduction={run}
				/>
			) : (
				<StartButton
					icon={<Play className='size-3.5' />}
					label={`${verb} ${scope.label}`}
					tooltip='Runs the tests against the production context.'
					disabledReason={disabledReason}
					isStarting={startRun.isPending}
					onClick={run}
				/>
			)}
		</RunActionsRow>
	);
}

/** Runs the test open in the editor, as it is there, from the drawer's tab row. */
export function TestFileRunActions({
	settings,
	draft,
	activeRun,
	testFile,
	validation,
	onRunStarted,
}: RunActionsBaseProps & { testFile: { path: string; content: string }; validation: TestFileValidationState }) {
	const startRun = useMutation(trpc.testRun.startDraftRun.mutationOptions({ onSuccess: onRunStarted }));
	const startComparison = useMutation(trpc.testRun.startComparisonRun.mutationOptions({ onSuccess: onRunStarted }));
	const contextChangeCount = getContextChanges(draft).length;
	const runSettings = { models: settings.models, attempts: settings.attempts };
	const disabledReason = !validation.validation?.test
		? 'Fix the test file first.'
		: settings.models.length === 0
			? 'Loading the models…'
			: startRun.isPending || startComparison.isPending
				? 'Starting the run…'
				: null;

	const run = () => {
		startComparison.reset();
		startRun.mutate({ ...testFile, ...runSettings });
	};
	const compare = () => {
		startRun.reset();
		startComparison.mutate({ testFile, ...runSettings });
	};

	return (
		<RunActionsRow
			error={startRun.error?.message ?? startComparison.error?.message}
			picker={
				<TestModelPicker
					settings={settings}
					testCount={1}
					variantCount={contextChangeCount > 0 ? 2 : 1}
					disabled={!!activeRun}
				/>
			}
			activeRun={activeRun}
		>
			{contextChangeCount > 0 ? (
				<CompareButton
					label='Compare with production'
					tooltip={`Runs this test, as it is in the editor, on production and with your ${contextChangeCount} changed file${contextChangeCount === 1 ? '' : 's'}, side by side.`}
					disabledReason={disabledReason}
					isStarting={startRun.isPending || startComparison.isPending}
					onCompare={compare}
					onRunOnProduction={run}
				/>
			) : (
				<StartButton
					icon={<Play className='size-3.5' />}
					label='Run test'
					tooltip='Runs this test, as it is in the editor, against the production context.'
					disabledReason={disabledReason}
					isStarting={startRun.isPending}
					onClick={run}
				/>
			)}
		</RunActionsRow>
	);
}

/** The model picker and start button, or the button that cancels the run in progress, which blocks any other. */
function RunActionsRow({
	error,
	picker,
	activeRun,
	children,
}: {
	error: string | undefined;
	picker: ReactNode;
	activeRun: TestRunSummary | undefined;
	children: ReactNode;
}) {
	return (
		<div className='flex min-w-0 items-center gap-1.5'>
			{error && (
				<span className='max-w-72 truncate text-destructive' title={error}>
					{error}
				</span>
			)}
			{picker}
			{activeRun ? <CancelRunButton run={activeRun} /> : children}
		</div>
	);
}

function CancelRunButton({ run }: { run: TestRunSummary }) {
	const queryClient = useQueryClient();
	const cancelRun = useMutation(
		trpc.testRun.cancelRun.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.testRun.listRuns.queryKey() }),
		}),
	);
	return (
		<Button
			type='button'
			size='sm'
			variant='ghost'
			className='h-6 gap-1.5 px-2 text-xs'
			disabled={cancelRun.isPending}
			onClick={() => cancelRun.mutate({ runId: run.id })}
		>
			{cancelRun.isPending ? <Spinner className='size-3.5' /> : <X className='size-3.5' />}
			Cancel run
		</Button>
	);
}

function StartButton({
	icon,
	label,
	tooltip,
	disabledReason,
	isStarting,
	onClick,
	className,
}: {
	icon: ReactNode;
	label: string;
	tooltip: string;
	disabledReason: string | null;
	isStarting: boolean;
	onClick: () => void;
	className?: string;
}) {
	return (
		<SimpleTooltip content={disabledReason ?? tooltip} side='top'>
			<span className='shrink-0'>
				<Button
					type='button'
					size='sm'
					className={cn('h-6 gap-1.5 px-2 text-xs', className)}
					disabled={disabledReason !== null}
					onClick={onClick}
				>
					{isStarting ? <Spinner className='size-3.5' /> : icon}
					{label}
				</Button>
			</span>
		</SimpleTooltip>
	);
}

/** Compares with production, with a menu to run on production only, as one button does not fit both in the tab row. */
function CompareButton({
	label,
	tooltip,
	disabledReason,
	isStarting,
	onCompare,
	onRunOnProduction,
}: {
	label: string;
	tooltip: string;
	disabledReason: string | null;
	isStarting: boolean;
	onCompare: () => void;
	onRunOnProduction: () => void;
}) {
	return (
		<span className='flex shrink-0 items-center'>
			<StartButton
				icon={<GitCompareArrows className='size-3.5' />}
				label={label}
				tooltip={tooltip}
				disabledReason={disabledReason}
				isStarting={isStarting}
				onClick={onCompare}
				className='rounded-r-none'
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type='button'
						size='sm'
						className='h-6 rounded-l-none border-l border-l-primary-foreground/25 px-1.5'
						disabled={disabledReason !== null}
						aria-label='More ways to run'
					>
						<ChevronDown className='size-3.5' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='text-xs'>
					<DropdownMenuItem onSelect={onRunOnProduction}>
						<Play className='size-3.5' />
						Run on production only
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	);
}

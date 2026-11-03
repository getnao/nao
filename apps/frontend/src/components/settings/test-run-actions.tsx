import { pluralize } from '@nao/shared';
import { TESTS_FOLDER } from '@nao/shared/test-paths';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FilePen, GitCompareArrows, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import type { ContextRunMode } from '@/hooks/use-test-run-start';
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
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useContextRunMode, useTestFileRun, useTestRunStart } from '@/hooks/use-test-run-start';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface ContextRunAction {
	label: string;
	tooltip: string;
}

const CONTEXT_RUN_MODES: Record<ContextRunMode, { icon: ReactNode; menuLabel: string }> = {
	compare: { icon: <GitCompareArrows className='size-3.5' />, menuLabel: 'Compare with production' },
	changes: { icon: <FilePen className='size-3.5' />, menuLabel: 'Run with your changes only' },
	production: { icon: <Play className='size-3.5' />, menuLabel: 'Run on production only' },
};

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

export function SuiteRunActions({
	settings,
	draft,
	activeRun,
	scope,
	onRunStarted,
}: RunActionsBaseProps & { scope: SuiteRunScope }) {
	const testRun = useTestRunStart({
		target: { paths: scope.paths },
		blockedReason: scope.testCount === 0 ? `Add a test to the ${TESTS_FOLDER}/ folder first.` : null,
		settings,
		draft,
		activeRun,
		onRunStarted,
	});
	const verb = settings.models.length > 1 ? 'Benchmark' : 'Run';

	return (
		<RunActionsRow
			error={testRun.error}
			picker={
				<TestModelPicker
					settings={settings}
					testCount={scope.testCount}
					variantCount={testRun.mode === 'compare' ? 2 : 1}
					disabled={!!activeRun}
				/>
			}
			activeRun={activeRun}
		>
			{testRun.hasContextChanges ? (
				<ContextRunButton
					actions={{
						compare: {
							label: `Compare ${scope.label} with production`,
							tooltip:
								'Runs the tests on production and with your changes, side by side, to see which ones your changes break or fix.',
						},
						changes: {
							label: `Run ${scope.label} with your changes`,
							tooltip: 'Runs the tests with your changes only.',
						},
						production: {
							label: `Run ${scope.label} on production`,
							tooltip: 'Runs the tests against the production context only.',
						},
					}}
					disabledReason={testRun.disabledReason}
					isStarting={testRun.isStarting}
					onRun={testRun.run}
				/>
			) : (
				<StartButton
					icon={<Play className='size-3.5' />}
					label={`${verb} ${scope.label}`}
					tooltip='Runs the tests against the production context.'
					disabledReason={testRun.disabledReason}
					isStarting={testRun.isStarting}
					onClick={testRun.run}
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
	const testRun = useTestFileRun({
		testPath: testFile.path,
		testFile,
		isTestFileInvalid: !validation.validation?.test,
		settings,
		draft,
		activeRun,
		onRunStarted,
	});
	const contextChangeCount = getContextChanges(draft).length;
	const changedFiles = `${contextChangeCount} changed ${pluralize('file', contextChangeCount)}`;

	return (
		<RunActionsRow
			error={testRun.error}
			picker={
				<TestModelPicker
					settings={settings}
					testCount={1}
					variantCount={testRun.mode === 'compare' ? 2 : 1}
					disabled={!!activeRun}
				/>
			}
			activeRun={activeRun}
		>
			{testRun.hasContextChanges ? (
				<ContextRunButton
					actions={{
						compare: {
							label: 'Compare with production',
							tooltip: `Runs this test, as it is in the editor, on production and with your ${changedFiles}, side by side.`,
						},
						changes: {
							label: 'Run with your changes',
							tooltip: `Runs this test, as it is in the editor, with your ${changedFiles} only.`,
						},
						production: {
							label: 'Run on production',
							tooltip: 'Runs this test, as it is in the editor, against the production context only.',
						},
					}}
					disabledReason={testRun.disabledReason}
					isStarting={testRun.isStarting}
					onRun={testRun.run}
				/>
			) : (
				<StartButton
					icon={<Play className='size-3.5' />}
					label='Run test'
					tooltip='Runs this test, as it is in the editor, against the production context.'
					disabledReason={testRun.disabledReason}
					isStarting={testRun.isStarting}
					onClick={testRun.run}
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
	useKeyboardShortcuts({
		'run-tests': () => {
			if (disabledReason === null) {
				onClick();
			}
		},
	});

	return (
		<SimpleTooltip content={disabledReason ?? `${tooltip} (${getShortcutLabel('run-tests')})`} side='top'>
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

/**
 * Starts a run on production, with the user's changes, or both side by side. Picking another way to run in the menu
 * makes it the button's action, remembered in this browser.
 */
function ContextRunButton({
	actions,
	disabledReason,
	isStarting,
	onRun,
}: {
	actions: Record<ContextRunMode, ContextRunAction>;
	disabledReason: string | null;
	isStarting: boolean;
	onRun: () => void;
}) {
	const [selectedMode, setMode] = useContextRunMode();
	const action = actions[selectedMode];
	const otherModes = (Object.keys(CONTEXT_RUN_MODES) as ContextRunMode[]).filter((other) => other !== selectedMode);

	return (
		<span className='flex shrink-0 items-center'>
			<StartButton
				icon={CONTEXT_RUN_MODES[selectedMode].icon}
				label={action.label}
				tooltip={action.tooltip}
				disabledReason={disabledReason}
				isStarting={isStarting}
				onClick={onRun}
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
					{otherModes.map((other) => (
						<DropdownMenuItem key={other} onSelect={() => setMode(other)}>
							{CONTEXT_RUN_MODES[other].icon}
							{CONTEXT_RUN_MODES[other].menuLabel}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	);
}

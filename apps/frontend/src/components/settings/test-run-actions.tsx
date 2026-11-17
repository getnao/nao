import { pluralize } from '@nao/shared';
import { TESTS_FOLDER } from '@nao/shared/test-paths';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FilePen, GitCompareArrows, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import type { ContextRunMode } from '@/hooks/use-test-run-start';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import type { UpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { TestModelPicker } from '@/components/settings/test-model-picker';
import { BranchName, getMainBranch } from '@/components/settings/test-run-labels';
import { getContextChanges } from '@/components/settings/test-run-types';
import { TestUpstreamPicker } from '@/components/settings/test-upstream-picker';
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
import { describeChanges, useContextRunMode, useTestFileRun, useTestRunStart } from '@/hooks/use-test-run-start';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { trpc } from '@/main';

interface ContextRunAction {
	label: ReactNode;
	tooltip: ReactNode;
}

const CONTEXT_RUN_MODE_ICONS: Record<ContextRunMode, ReactNode> = {
	compare: <GitCompareArrows className='size-3.5' />,
	changes: <FilePen className='size-3.5' />,
	production: <Play className='size-3.5' />,
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
	const mainBranch = <BranchName name={getMainBranch(draft)} className='text-current' />;
	const changes = <ChangesName upstream={testRun.upstream} />;

	return (
		<RunActionsRow
			error={testRun.error}
			picker={
				<>
					<TestUpstreamPicker disabled={!!activeRun} />
					<TestModelPicker
						settings={settings}
						testCount={scope.testCount}
						variantCount={testRun.mode === 'compare' ? 2 : 1}
						disabled={!!activeRun}
					/>
				</>
			}
			activeRun={activeRun}
		>
			{testRun.hasContextChanges ? (
				<ContextRunButton
					mainBranch={mainBranch}
					changes={changes}
					actions={{
						compare: {
							label: (
								<>
									Compare {scope.label} with {mainBranch}
								</>
							),
							tooltip: (
								<>
									Runs the tests on {mainBranch} and with {changes}, side by side, to see which ones
									the changes break or fix.
								</>
							),
						},
						changes: {
							label: (
								<>
									Run {scope.label} with {changes}
								</>
							),
							tooltip: <>Runs the tests with {changes} only.</>,
						},
						production: {
							label: (
								<>
									Run {scope.label} on {mainBranch}
								</>
							),
							tooltip: <>Runs the tests on {mainBranch} only.</>,
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
					tooltip={<>Runs the tests on {mainBranch}.</>}
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
	const changes = testRun.upstream ? (
		<ChangesName upstream={testRun.upstream} />
	) : (
		`your ${contextChangeCount} changed ${pluralize('file', contextChangeCount)}`
	);
	const mainBranch = <BranchName name={getMainBranch(draft)} className='text-current' />;

	return (
		<RunActionsRow
			error={testRun.error}
			picker={
				<>
					<TestUpstreamPicker disabled={!!activeRun} />
					<TestModelPicker
						settings={settings}
						testCount={1}
						variantCount={testRun.mode === 'compare' ? 2 : 1}
						disabled={!!activeRun}
					/>
				</>
			}
			activeRun={activeRun}
		>
			{testRun.hasContextChanges ? (
				<ContextRunButton
					mainBranch={mainBranch}
					changes={<ChangesName upstream={testRun.upstream} />}
					actions={{
						compare: {
							label: <>Compare with {mainBranch}</>,
							tooltip: (
								<>
									Runs this test, as it is in the editor, side by side on {mainBranch} and with{' '}
									{changes}.
								</>
							),
						},
						changes: {
							label: (
								<>
									Run with <ChangesName upstream={testRun.upstream} />
								</>
							),
							tooltip: <>Runs this test, as it is in the editor, with {changes} only.</>,
						},
						production: {
							label: <>Run on {mainBranch}</>,
							tooltip: <>Runs this test, as it is in the editor, on {mainBranch} only.</>,
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
					tooltip={<>Runs this test, as it is in the editor, on {mainBranch}.</>}
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
		<div className='flex min-w-0 items-center gap-2'>
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
			size='pill'
			variant='ghost-muted'
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
	label: ReactNode;
	tooltip: ReactNode;
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
		<SimpleTooltip
			content={
				disabledReason ?? (
					<>
						{tooltip} ({getShortcutLabel('run-tests')})
					</>
				)
			}
			side='top'
		>
			<span className='shrink-0'>
				<Button
					type='button'
					size='pill'
					className={className}
					disabled={disabledReason !== null}
					onClick={onClick}
				>
					{isStarting ? <Spinner className='size-3.5' /> : icon}
					<span>{label}</span>
				</Button>
			</span>
		</SimpleTooltip>
	);
}

/**
 * Starts a run on the main branch, with the user's changes, or both side by side. Picking another way to run in the
 * menu makes it the button's action, remembered in this browser.
 */
function ContextRunButton({
	mainBranch,
	changes,
	actions,
	disabledReason,
	isStarting,
	onRun,
}: {
	mainBranch: ReactNode;
	changes: ReactNode;
	actions: Record<ContextRunMode, ContextRunAction>;
	disabledReason: string | null;
	isStarting: boolean;
	onRun: () => void;
}) {
	const [selectedMode, setMode] = useContextRunMode();
	const action = actions[selectedMode];
	const otherModes = (Object.keys(CONTEXT_RUN_MODE_ICONS) as ContextRunMode[]).filter(
		(other) => other !== selectedMode,
	);

	return (
		<span className='flex shrink-0 items-center'>
			<StartButton
				icon={CONTEXT_RUN_MODE_ICONS[selectedMode]}
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
						size='pill'
						className='rounded-l-none border-l border-l-primary-foreground/25 pr-2.5 pl-2'
						disabled={disabledReason !== null}
						aria-label='More ways to run'
					>
						<ChevronDown className='size-3.5' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='text-xs'>
					{otherModes.map((other) => (
						<DropdownMenuItem key={other} onSelect={() => setMode(other)}>
							{CONTEXT_RUN_MODE_ICONS[other]}
							<span>
								<ContextRunMenuLabel mode={other} mainBranch={mainBranch} changes={changes} />
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	);
}

function ContextRunMenuLabel({
	mode,
	mainBranch,
	changes,
}: {
	mode: ContextRunMode;
	mainBranch: ReactNode;
	changes: ReactNode;
}) {
	switch (mode) {
		case 'compare':
			return <>Compare with {mainBranch}</>;
		case 'changes':
			return <>Run with {changes} only</>;
		case 'production':
			return <>Run on {mainBranch} only</>;
	}
}

/** The upstream branch tested, or the user's File Explorer changes. */
function ChangesName({ upstream }: { upstream: UpstreamTestSource | null }) {
	return upstream ? <BranchName name={describeChanges(upstream)} className='text-current' /> : <>your changes</>;
}

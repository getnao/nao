import { pluralize } from '@nao/shared';
import { TESTS_FOLDER } from '@nao/shared/test-paths';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleDashed, History } from 'lucide-react';
import { useState } from 'react';

import type { SuiteRunScope } from '@/components/settings/test-run-actions';
import type { RunFilters } from '@/components/settings/test-run-filter-menu';
import type {
	DraftContext,
	LatestTestOutcome,
	TestDefinition,
	TestModelOutcome,
	TestRunSummary,
	TestSuiteListing,
} from '@/components/settings/test-run-types';
import { DraftContextWarnings, hasDraftContextWarnings } from '@/components/settings/test-draft-comparison';
import { PanelHeader, RecentRunsHeader, RUNS_COLUMN_WIDTH_CLASS } from '@/components/settings/test-drawer-layout';
import { ModelDot } from '@/components/settings/test-model-labels';
import { TestRow } from '@/components/settings/test-row';
import { ALL_RUNS, matchesRunFilters } from '@/components/settings/test-run-filter-menu';
import { getMainBranch, ToneIcon } from '@/components/settings/test-run-labels';
import { describeRunListItem, RunListItem } from '@/components/settings/test-run-list-item';
import { TestRunResults } from '@/components/settings/test-run-results';
import { formatTestModel, getTestModelColorAt, testModelKey } from '@/components/settings/test-run-types';
import { outcomeTone } from '@/components/settings/test-run-verdict';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const MAX_LISTED_RUNS = 10;

/** The tests picked in the suite, which the Run button of the drawer runs. */
interface SuiteSelection {
	selectedPaths: Set<string>;
	onSelectedPathsChange: (paths: Set<string>) => void;
	selectedTags: string[];
	onSelectedTagsChange: (tags: string[]) => void;
}

interface TestSuitePanelProps {
	draft: DraftContext | null;
	runs: TestRunSummary[] | undefined;
	/** The run opened next to the list of runs, or `null` to list the tests. */
	selectedRunId: string | null;
	selection: SuiteSelection;
	onSelectRun: (runId: string | null) => void;
	onOpenTest: (explorerPath: string) => void;
}

export function TestSuitePanel({
	draft,
	runs,
	selectedRunId,
	selection,
	onSelectRun,
	onOpenTest,
}: TestSuitePanelProps) {
	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const runListContext = {
		mainBranch: getMainBranch(draft),
		suiteTestPaths: suite.data?.tests.map((test) => test.path),
	};
	const [runFilters, setRunFilters] = useState<RunFilters>(ALL_RUNS);
	const listedRuns = runs?.filter((run) => matchesRunFilters(run, runFilters)).slice(0, MAX_LISTED_RUNS);
	return (
		<div className='flex h-full min-h-0 flex-col'>
			{draft && hasDraftContextWarnings(draft) && <DraftWarningsNotice draft={draft} />}

			<div className='flex min-h-0 flex-1'>
				<nav
					className={cn('flex shrink-0 flex-col overflow-y-auto border-r text-xs', RUNS_COLUMN_WIDTH_CLASS)}
					aria-label='Test runs'
				>
					<RecentRunsHeader filters={runFilters} onChange={setRunFilters} />
					{runs?.length === 0 && <span className='px-3 py-2 text-muted-foreground'>No run yet.</span>}
					{runs && runs.length > 0 && listedRuns?.length === 0 && (
						<span className='px-3 py-2 text-muted-foreground'>No run matches the filter.</span>
					)}
					{listedRuns && listedRuns.length > 0 && (
						<div className='flex flex-col gap-0.5 p-1'>
							{listedRuns.map((run) => (
								<RunListItem
									key={run.id}
									view={describeRunListItem(run, runListContext)}
									isSelected={selectedRunId === run.id}
									onSelect={() => onSelectRun(run.id)}
								/>
							))}
						</div>
					)}
				</nav>

				<div className='min-w-0 flex-1 overflow-y-auto'>
					{selectedRunId === null ? (
						<SuiteTests
							suite={suite.data}
							isLoading={suite.isLoading}
							selection={selection}
							onOpenTest={onOpenTest}
						/>
					) : (
						<TestRunResults
							key={selectedRunId}
							runId={selectedRunId}
							mainBranch={runListContext.mainBranch}
							onOpenTest={onOpenTest}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

/** What the drawer's Run button runs: the picked tests, else those of the picked tags, else the whole suite. */
export function getSuiteRunScope(tests: TestDefinition[], selection: SuiteSelection): SuiteRunScope {
	if (selection.selectedPaths.size > 0) {
		return {
			paths: [...selection.selectedPaths],
			testCount: selection.selectedPaths.size,
			label: `${selection.selectedPaths.size} selected`,
		};
	}
	const visibleTests = filterByTags(tests, selection.selectedTags);
	if (visibleTests.length < tests.length) {
		return {
			paths: visibleTests.map((test) => test.path),
			testCount: visibleTests.length,
			label: countTests(visibleTests.length),
		};
	}
	return { paths: undefined, testCount: tests.length, label: countTests(tests.length) };
}

function DraftWarningsNotice({ draft }: { draft: DraftContext }) {
	return (
		<div className='flex shrink-0 flex-col gap-1.5 border-b px-3 py-1.5'>
			<DraftContextWarnings draft={draft} />
		</div>
	);
}

function SuiteTests({
	suite,
	isLoading,
	selection,
	onOpenTest,
}: {
	suite: TestSuiteListing | undefined;
	isLoading: boolean;
	selection: SuiteSelection;
	onOpenTest: (explorerPath: string) => void;
}) {
	if (isLoading) {
		return (
			<div className='flex h-full items-center justify-center'>
				<Spinner />
			</div>
		);
	}
	if (!suite) {
		return <Empty className='h-full'>Could not load the tests.</Empty>;
	}
	if (suite.tests.length === 0 && suite.invalidFiles.length === 0) {
		return (
			<Empty className='h-full whitespace-normal'>
				No tests yet. Add YAML files with a <code className='font-mono'>prompt</code> and a reference{' '}
				<code className='font-mono'>sql</code> to the <code className='font-mono'>{TESTS_FOLDER}/</code> folder.
			</Empty>
		);
	}
	const visibleTests = filterByTags(suite.tests, selection.selectedTags);
	return (
		<div className='flex flex-col text-xs'>
			<SuiteTestsHeader tests={suite.tests} visibleTests={visibleTests} selection={selection} />
			<ul className='flex flex-col'>
				{suite.settings.errors.map((error) => (
					<li key={error} className='flex items-start gap-2 border-b px-3 py-2 text-destructive'>
						<CircleAlert className='mt-px size-3.5 shrink-0' />
						<span className='font-mono whitespace-pre-wrap'>nao_config.yaml: {error}</span>
					</li>
				))}
				{suite.invalidFiles.map((file) => (
					<TestRow
						key={file.path}
						icon={<CircleAlert className='size-3.5 shrink-0 text-destructive' />}
						name={file.path}
						path={file.path}
						detail={
							<span className='max-w-80 truncate text-destructive' title={file.error}>
								Invalid: {file.error}
							</span>
						}
						onOpen={onOpenTest}
					/>
				))}
				{visibleTests.map((test) => (
					<SuiteTestRow
						key={test.path}
						test={test}
						outcome={suite.latestOutcomes[test.path]}
						isSelected={selection.selectedPaths.has(test.path)}
						onSelectedChange={(isSelected) => {
							const next = new Set(selection.selectedPaths);
							if (isSelected) {
								next.add(test.path);
							} else {
								next.delete(test.path);
							}
							selection.onSelectedPathsChange(next);
						}}
						onOpen={onOpenTest}
					/>
				))}
			</ul>
		</div>
	);
}

function SuiteTestsHeader({
	tests,
	visibleTests,
	selection,
}: {
	tests: TestDefinition[];
	visibleTests: TestDefinition[];
	selection: SuiteSelection;
}) {
	const tags = [...new Set(tests.flatMap((test) => test.tags))].sort();
	const selectedCount = selection.selectedPaths.size;
	const allSelected = visibleTests.length > 0 && visibleTests.every((test) => selection.selectedPaths.has(test.path));

	const toggleTag = (tag: string) => {
		const selectedTags = selection.selectedTags.includes(tag)
			? selection.selectedTags.filter((selected) => selected !== tag)
			: [...selection.selectedTags, tag];
		selection.onSelectedTagsChange(selectedTags);
		selection.onSelectedPathsChange(new Set());
	};

	return (
		<PanelHeader className='gap-2.5'>
			<Checkbox
				aria-label='Select the shown tests'
				checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
				onCheckedChange={() =>
					selection.onSelectedPathsChange(
						allSelected ? new Set() : new Set(visibleTests.map((test) => test.path)),
					)
				}
			/>
			<span className={cn(selectedCount > 0 && 'font-medium text-foreground')}>
				{selectedCount > 0 ? `${selectedCount} selected` : countTests(visibleTests.length)}
			</span>
			{tags.length > 0 && (
				<div className='flex min-w-0 flex-wrap items-center gap-1' aria-label='Filter by tag'>
					{tags.map((tag) => (
						<Badge
							key={tag}
							variant={selection.selectedTags.includes(tag) ? 'default' : 'outline'}
							className='h-5 text-[11px]'
							asChild
						>
							<button
								type='button'
								aria-pressed={selection.selectedTags.includes(tag)}
								onClick={() => toggleTag(tag)}
								className='cursor-pointer'
							>
								{tag}
							</button>
						</Badge>
					))}
				</div>
			)}
		</PanelHeader>
	);
}

function SuiteTestRow({
	test,
	outcome,
	isSelected,
	onSelectedChange,
	onOpen,
}: {
	test: TestDefinition;
	outcome: LatestTestOutcome | undefined;
	isSelected: boolean;
	onSelectedChange: (isSelected: boolean) => void;
	onOpen: (explorerPath: string) => void;
}) {
	const checkbox = (
		<Checkbox
			aria-label={`Select ${test.name}`}
			checked={isSelected}
			onCheckedChange={(checked) => onSelectedChange(checked === true)}
		/>
	);
	if (!outcome || outcome.totalAttempts === 0) {
		return (
			<TestRow
				leading={checkbox}
				icon={<CircleDashed className='size-3.5 shrink-0 text-muted-foreground' />}
				name={test.name}
				path={test.path}
				detail={<span className='text-muted-foreground'>Never run</span>}
				onOpen={onOpen}
			/>
		);
	}
	return (
		<TestRow
			leading={checkbox}
			icon={
				<ToneIcon
					tone={outcomeTone(outcome.passedAttempts, outcome.totalAttempts)}
					isLabelled
					className={cn(outcome.isOutdated && 'opacity-60')}
				/>
			}
			name={test.name}
			path={test.path}
			detail={
				<span
					className='flex items-center gap-3 text-muted-foreground'
					title={outcome.isOutdated ? 'The test changed after this run' : undefined}
				>
					{outcome.models.length > 1 ? (
						<ModelOutcomes models={outcome.models} />
					) : (
						outcome.totalAttempts > 1 && `${outcome.passedAttempts}/${outcome.totalAttempts} passed`
					)}
					<span className='flex items-center gap-1'>
						{outcome.isOutdated && <History className='size-3 shrink-0' />}
						{getTimeAgo(new Date(outcome.runCreatedAt).getTime()).humanReadable}
					</span>
				</span>
			}
			onOpen={onOpen}
		/>
	);
}

/** The latest outcome of a test on each model of the run that last tried it. */
function ModelOutcomes({ models }: { models: TestModelOutcome[] }) {
	return (
		<span className='flex items-center gap-2.5'>
			{models.map((model) => (
				<span
					key={testModelKey(model)}
					className='flex items-center gap-1'
					title={`${formatTestModel(model)}: ${model.passedAttempts}/${model.totalAttempts} passed`}
				>
					<ModelDot color={getTestModelColorAt(model.colorIndex)} />
					<ToneIcon
						tone={outcomeTone(model.passedAttempts, model.totalAttempts)}
						isLabelled
						className='size-3'
					/>
				</span>
			))}
		</span>
	);
}

function filterByTags(tests: TestDefinition[], tags: string[]): TestDefinition[] {
	if (tags.length === 0) {
		return tests;
	}
	return tests.filter((test) => test.tags.some((tag) => tags.includes(tag)));
}

function countTests(count: number): string {
	return `${count} ${pluralize('test', count)}`;
}

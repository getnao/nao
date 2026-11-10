import { pluralize } from '@nao/shared';
import { TESTS_FOLDER } from '@nao/shared/test-paths';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleDashed, History, Search, User, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { SuiteRunScope } from '@/components/settings/test-run-actions';
import type { RunFilters } from '@/components/settings/test-run-filter-menu';
import type { TestFilters } from '@/components/settings/test-suite-filter-menu';
import type {
	DraftContext,
	LatestTestOutcome,
	TestDefinition,
	TestModelOutcome,
	TestRunSummary,
	TestSuiteListing,
} from '@/components/settings/test-run-types';
import { DraftContextWarnings, hasDraftContextWarnings } from '@/components/settings/test-draft-comparison';
import { PanelHeader, RecentRunsHeader, RunsColumn } from '@/components/settings/test-drawer-layout';
import { ModelDot } from '@/components/settings/test-model-labels';
import { TestRow } from '@/components/settings/test-row';
import { ALL_RUNS, matchesRunFilters } from '@/components/settings/test-run-filter-menu';
import { getMainBranch, ToneIcon } from '@/components/settings/test-run-labels';
import { describeRunListItem, RunListItem } from '@/components/settings/test-run-list-item';
import { TestRunResults } from '@/components/settings/test-run-results';
import {
	ActiveTestFilters,
	matchesTestFilters,
	TestSuiteFilterMenu,
} from '@/components/settings/test-suite-filter-menu';
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
const MAX_ROW_TAGS = 2;

/** The tests picked in the suite, which the Run button of the drawer runs. */
interface SuiteSelection {
	selectedPaths: Set<string>;
	onSelectedPathsChange: (paths: Set<string>) => void;
	filters: TestFilters;
	onFiltersChange: (filters: TestFilters) => void;
	/** Shows only the tests whose name, path, owner or one of whose tags holds it. */
	search: string;
	onSearchChange: (search: string) => void;
}

interface TestSuitePanelProps {
	draft: DraftContext | null;
	runs: TestRunSummary[] | undefined;
	/** The run opened next to the list of runs, or `null` to list the tests. */
	selectedRunId: string | null;
	selection: SuiteSelection;
	onSelectRun: (runId: string | null) => void;
	onOpenTest: (explorerPath: string, runId?: string) => void;
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
				<RunsColumn label='Test runs'>
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
				</RunsColumn>

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
							onOpenTest={(explorerPath) => onOpenTest(explorerPath, selectedRunId)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

/** What the drawer's Run button runs: the picked tests, else the filtered ones, else the whole suite. */
export function getSuiteRunScope(tests: TestDefinition[], selection: SuiteSelection): SuiteRunScope {
	if (selection.selectedPaths.size > 0) {
		return {
			paths: [...selection.selectedPaths],
			testCount: selection.selectedPaths.size,
			label: `${selection.selectedPaths.size} selected`,
		};
	}
	const visibleTests = filterTests(tests, selection);
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
	const visibleTests = filterTests(suite.tests, selection);
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
				{suite.tests.length > 0 && visibleTests.length === 0 && (
					<li className='px-3 py-2 text-muted-foreground'>No test matches the filters.</li>
				)}
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
	const selectedCount = selection.selectedPaths.size;
	const allSelected = visibleTests.length > 0 && visibleTests.every((test) => selection.selectedPaths.has(test.path));

	const changeFilters = (filters: TestFilters) => {
		selection.onFiltersChange(filters);
		selection.onSelectedPathsChange(new Set());
	};

	const changeSearch = (search: string) => {
		selection.onSearchChange(search);
		selection.onSelectedPathsChange(new Set());
	};

	return (
		<PanelHeader className='h-9 flex-nowrap gap-2.5'>
			<Checkbox
				aria-label='Select the shown tests'
				checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
				onCheckedChange={() =>
					selection.onSelectedPathsChange(
						allSelected ? new Set() : new Set(visibleTests.map((test) => test.path)),
					)
				}
			/>
			<span className={cn('shrink-0 whitespace-nowrap', selectedCount > 0 && 'font-medium text-foreground')}>
				{selectedCount > 0 ? `${selectedCount} selected` : countTests(visibleTests.length)}
			</span>
			<TestSuiteFilterMenu tests={tests} filters={selection.filters} onChange={changeFilters} />
			<ActiveTestFilters filters={selection.filters} onChange={changeFilters} />
			<TestSearchInput value={selection.search} onChange={changeSearch} />
		</PanelHeader>
	);
}

function TestSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	return (
		<label className='ml-auto flex h-6 w-56 min-w-36 shrink items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-ring'>
			<Search className='size-3 shrink-0' />
			<input
				type='search'
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						onChange('');
					}
				}}
				placeholder='Search tests, tags or owners'
				aria-label='Search tests'
				className='min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden'
			/>
			{value && (
				<button
					type='button'
					aria-label='Clear the search'
					onClick={() => onChange('')}
					className='flex cursor-pointer items-center hover:text-foreground'
				>
					<X className='size-3' />
				</button>
			)}
		</label>
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
				meta={<TestOwnership test={test} />}
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
			meta={<TestOwnership test={test} />}
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

/** The owner and the first tags of a test, the others counted, so a test with many tags keeps its row readable. */
function TestOwnership({ test }: { test: TestDefinition }) {
	if (!test.owner && test.tags.length === 0) {
		return null;
	}
	const shownTags = test.tags.slice(0, MAX_ROW_TAGS);
	const hiddenTags = test.tags.slice(MAX_ROW_TAGS);
	return (
		<span className='flex shrink-0 items-center gap-1.5'>
			{test.owner && (
				<span className='flex min-w-0 items-center gap-0.5' title={`Owner: ${test.owner}`}>
					<User className='size-3 shrink-0' />
					<span className='max-w-40 truncate'>{test.owner}</span>
				</span>
			)}
			{shownTags.map((tag) => (
				<RowTag key={tag}>{tag}</RowTag>
			))}
			{hiddenTags.length > 0 && <RowTag title={hiddenTags.join(', ')}>+{hiddenTags.length}</RowTag>}
		</span>
	);
}

function RowTag({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<Badge variant='outline' title={title} className='h-4 px-1 text-[10px] font-normal text-muted-foreground'>
			{children}
		</Badge>
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

function filterTests(tests: TestDefinition[], selection: Pick<SuiteSelection, 'filters' | 'search'>) {
	const search = selection.search.trim().toLowerCase();
	return tests.filter((test) => matchesTestFilters(test, selection.filters) && matchesSearch(test, search));
}

function matchesSearch(test: TestDefinition, search: string): boolean {
	if (!search) {
		return true;
	}
	const fields = [test.name, test.path, test.owner ?? '', ...test.tags];
	return fields.some((field) => field.toLowerCase().includes(search));
}

function countTests(count: number): string {
	return `${count} ${pluralize('test', count)}`;
}

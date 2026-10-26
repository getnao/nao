import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { TestDefinition, TestSuiteListing } from '@/components/settings/test-run-types';
import { isActiveRun } from '@/components/settings/test-run-types';
import { TestRunResults } from '@/components/settings/test-run-results';
import { TestRunsTable } from '@/components/settings/test-runs-table';
import { TestsTable } from '@/components/settings/tests-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { requireContextAdminOrAdmin } from '@/lib/route-guards';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/tests')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: (search: Record<string, unknown>): { run: string | undefined } => ({
		run: typeof search.run === 'string' && search.run.length > 0 ? search.run : undefined,
	}),
	component: TestsPage,
});

const PAGE_DESCRIPTION =
	'Check that the agent answers your reference questions correctly. Tests are the YAML files in the tests/ folder of the context and run against the production context.';
const DOCS_URL = 'https://docs.getnao.io/nao-agent/context-engineering/evaluation';
const ACTIVE_RUN_REFETCH_MS = 3000;
const NO_TESTS: TestDefinition[] = [];

function TestsPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const runs = useQuery({
		...trpc.testRun.listRuns.queryOptions(),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const openedRun = useQuery({
		...trpc.testRun.getRun.queryOptions({ runId: search.run ?? '' }),
		enabled: !!search.run,
		refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const activeRun = runs.data?.find(isActiveRun);
	useRefreshOutcomesWhenRunEnds(activeRun?.id);

	const openRun = (runId: string | undefined) => {
		navigate({ search: { run: runId }, replace: true });
	};

	const invalidateRuns = () => {
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.listRuns.queryKey() });
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.getRun.queryKey() });
	};

	const startRun = useMutation(
		trpc.testRun.startRun.mutationOptions({
			onSuccess: (run) => {
				invalidateRuns();
				setSelectedPaths(new Set());
				openRun(run.id);
			},
		}),
	);
	const cancelRun = useMutation(trpc.testRun.cancelRun.mutationOptions({ onSuccess: invalidateRuns }));

	const tests = suite.data?.tests ?? NO_TESTS;
	const visibleTests = useMemo(() => filterByTags(tests, selectedTags), [tests, selectedTags]);
	const runTargets = selectedPaths.size > 0 ? [...selectedPaths] : visibleTests.map((test) => test.path);

	return (
		<SettingsPageWrapper>
			<div className='flex items-start justify-between gap-4'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Tests</h1>
					<p className='text-sm text-muted-foreground'>{PAGE_DESCRIPTION}</p>
				</div>
				<div className='flex flex-col items-end gap-1'>
					<Button
						size='sm'
						onClick={() => startRun.mutate({ paths: runTargets })}
						disabled={!!activeRun || startRun.isPending || runTargets.length === 0}
					>
						{activeRun || startRun.isPending ? <Spinner className='size-4' /> : <Play className='size-4' />}
						{runButtonLabel(!!activeRun, selectedPaths.size, visibleTests.length, tests.length)}
					</Button>
					{suite.data && <RunSettingsSummary settings={suite.data.settings} />}
				</div>
			</div>

			{startRun.error && <ErrorMessage message={startRun.error.message} />}

			{search.run && openedRun.data && (
				<TestRunResults
					run={openedRun.data}
					isCancelling={cancelRun.isPending}
					onCancel={() => cancelRun.mutate({ runId: openedRun.data.id })}
					onClose={() => openRun(undefined)}
				/>
			)}

			<SettingsCard
				title='Tests'
				description={`${tests.length} test${tests.length === 1 ? '' : 's'} in the production context`}
				action={<TagFilter tests={tests} selectedTags={selectedTags} onChange={setSelectedTags} />}
				flush
			>
				<TestSuiteContent
					suite={suite.data}
					isLoading={suite.isLoading}
					error={suite.error?.message}
					visibleTests={visibleTests}
					selectedPaths={selectedPaths}
					onSelectedPathsChange={setSelectedPaths}
					onOpenRun={openRun}
				/>
			</SettingsCard>

			<SettingsCard title='Run history' flush>
				{runs.isLoading ? (
					<Spinner className='m-6 mx-auto' />
				) : (
					<TestRunsTable runs={runs.data ?? []} selectedRunId={search.run} onSelectRun={openRun} />
				)}
			</SettingsCard>
		</SettingsPageWrapper>
	);
}

interface TestSuiteContentProps {
	suite: TestSuiteListing | undefined;
	isLoading: boolean;
	error: string | undefined;
	visibleTests: TestDefinition[];
	selectedPaths: Set<string>;
	onSelectedPathsChange: (paths: Set<string>) => void;
	onOpenRun: (runId: string) => void;
}

function TestSuiteContent({
	suite,
	isLoading,
	error,
	visibleTests,
	selectedPaths,
	onSelectedPathsChange,
	onOpenRun,
}: TestSuiteContentProps) {
	if (isLoading) {
		return <Spinner className='m-6 mx-auto' />;
	}
	if (error || !suite) {
		return <ErrorMessage message={error ?? 'Failed to load the tests.'} />;
	}
	if (suite.tests.length === 0 && suite.invalidFiles.length === 0) {
		return (
			<Empty className='py-6 whitespace-normal'>
				No tests yet. Add YAML files with a <code className='font-mono'>prompt</code> and a reference{' '}
				<code className='font-mono'>sql</code> to the <code className='font-mono'>tests/</code> folder of the
				context.{' '}
				<a href={DOCS_URL} target='_blank' rel='noreferrer' className='underline'>
					Learn more
				</a>
			</Empty>
		);
	}

	return (
		<>
			{suite.invalidFiles.length > 0 && (
				<Callout variant='warning' className='m-4 mb-0'>
					<div className='flex flex-col gap-1'>
						<span className='font-medium'>
							{suite.invalidFiles.length} test file{suite.invalidFiles.length === 1 ? '' : 's'} could not
							be read and will not run:
						</span>
						{suite.invalidFiles.map((file) => (
							<span key={file.path} className='font-mono whitespace-pre-wrap'>
								tests/{file.path}: {file.error}
							</span>
						))}
					</div>
				</Callout>
			)}
			<TestsTable
				tests={visibleTests}
				latestOutcomes={suite.latestOutcomes}
				selectedPaths={selectedPaths}
				onSelectedPathsChange={onSelectedPathsChange}
				onOpenRun={onOpenRun}
			/>
		</>
	);
}

interface TagFilterProps {
	tests: TestDefinition[];
	selectedTags: string[];
	onChange: (tags: string[]) => void;
}

function TagFilter({ tests, selectedTags, onChange }: TagFilterProps) {
	const tags = useMemo(() => [...new Set(tests.flatMap((test) => test.tags))].sort(), [tests]);
	if (tags.length === 0) {
		return null;
	}

	const toggleTag = (tag: string) => {
		onChange(
			selectedTags.includes(tag) ? selectedTags.filter((selected) => selected !== tag) : [...selectedTags, tag],
		);
	};

	return (
		<div className='flex flex-wrap justify-end gap-1'>
			{tags.map((tag) => (
				<Badge key={tag} variant={selectedTags.includes(tag) ? 'default' : 'outline'} asChild>
					<button type='button' onClick={() => toggleTag(tag)} className='cursor-pointer'>
						{tag}
					</button>
				</Badge>
			))}
		</div>
	);
}

function RunSettingsSummary({ settings }: { settings: TestSuiteListing['settings'] }) {
	const models = settings.models?.map((model) => model.modelId).join(', ') ?? 'default model';
	const attempts = settings.attempts > 1 ? ` · ${settings.attempts} attempts per test` : '';
	return (
		<span className='text-xs text-muted-foreground'>
			{models}
			{attempts}
		</span>
	);
}

function useRefreshOutcomesWhenRunEnds(activeRunId: string | undefined) {
	const queryClient = useQueryClient();
	const previousActiveRunId = useRef(activeRunId);

	useEffect(() => {
		if (previousActiveRunId.current && previousActiveRunId.current !== activeRunId) {
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.listTests.queryKey() });
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.getRun.queryKey() });
		}
		previousActiveRunId.current = activeRunId;
	}, [activeRunId, queryClient]);
}

function filterByTags(tests: TestDefinition[], tags: string[]): TestDefinition[] {
	if (tags.length === 0) {
		return tests;
	}
	return tests.filter((test) => test.tags.some((tag) => tags.includes(tag)));
}

function runButtonLabel(isRunning: boolean, selectedCount: number, visibleCount: number, totalCount: number): string {
	if (isRunning) {
		return 'Running…';
	}
	if (selectedCount > 0) {
		return `Run ${selectedCount} selected`;
	}
	return visibleCount === totalCount ? 'Run all tests' : `Run ${visibleCount} tests`;
}

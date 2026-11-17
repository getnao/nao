import { EFFORT_OPTIONS } from '@nao/backend/provider-meta';
import { testModelColorIndex } from '@nao/backend/test-run';
import { isSameModel } from '@nao/shared/types';
import { isInTestsFolder } from '@nao/shared/test-paths';

import type { TestModel } from '@nao/backend/test-run';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { KeyboardEvent } from 'react';

type TestRunOutputs = inferRouterOutputs<TrpcRouter>['testRun'];

export type TestSuiteListing = TestRunOutputs['listTests'];
export type TestDefinition = TestSuiteListing['tests'][number];
export type LatestTestOutcome = TestSuiteListing['latestOutcomes'][string];
export type TestRunSummary = TestRunOutputs['listRuns'][number];
export type TestRunWithResults = TestRunOutputs['getRun'];
/** An attempt of a run as the suite views list it, without the details only the view of a single attempt shows. */
export type TestResultOutcome = TestRunWithResults['results'][number];
type TestComparison = NonNullable<TestRunWithResults['comparison']>;
export type TestComparisonRow = TestComparison['tests'][number];
export type TestComparisonChange = TestComparisonRow['change'];
type DraftContextStatus = TestRunOutputs['getDraftContext'];
export type DraftContext = Extract<DraftContextStatus, { status: 'available' }>;
export type TestHistoryRun = TestRunOutputs['getTestHistory'][number];
export type TestRunResult = TestHistoryRun['results'][number];
export type TestDataDiff = NonNullable<TestRunResult['dataDiff']>;
export type TestDataDiffRow = TestDataDiff['rows'][number];
export type TestFileValidation = TestRunOutputs['validateTestFile'];
export type TestModelSummary = TestRunWithResults['modelSummaries'][number];
export type TestModelStats = TestRunOutputs['getModelStats'][number];
export type TestModelOutcome = LatestTestOutcome['models'][number];
export type ContextVariant = TestRunResult['contextVariant'];
export type VariantOutcome = TestComparison['production'];

export const ACTIVE_RUN_REFETCH_MS = 2_000;

/**
 * Identity colors of the models of a run, in the order of `run.models`, validated together for color vision
 * deficiency. Green and red are left out, as they mean passed and failed; models past the fifth share a gray.
 */
const TEST_MODEL_COLORS = [
	{
		background: 'bg-[#2a78d6] dark:bg-[#3987e5]',
		fill: 'fill-[#2a78d6] dark:fill-[#3987e5]',
		stroke: 'stroke-[#2a78d6] dark:stroke-[#3987e5]',
	},
	{
		background: 'bg-[#eb6834] dark:bg-[#d95926]',
		fill: 'fill-[#eb6834] dark:fill-[#d95926]',
		stroke: 'stroke-[#eb6834] dark:stroke-[#d95926]',
	},
	{
		background: 'bg-[#6250d6] dark:bg-[#9085e9]',
		fill: 'fill-[#6250d6] dark:fill-[#9085e9]',
		stroke: 'stroke-[#6250d6] dark:stroke-[#9085e9]',
	},
	{
		background: 'bg-[#eda100] dark:bg-[#c98500]',
		fill: 'fill-[#eda100] dark:fill-[#c98500]',
		stroke: 'stroke-[#eda100] dark:stroke-[#c98500]',
	},
	{
		background: 'bg-[#e87ba4] dark:bg-[#d55181]',
		fill: 'fill-[#e87ba4] dark:fill-[#d55181]',
		stroke: 'stroke-[#e87ba4] dark:stroke-[#d55181]',
	},
] as const;
const OTHER_MODEL_COLOR = {
	background: 'bg-muted-foreground',
	fill: 'fill-muted-foreground',
	stroke: 'stroke-muted-foreground',
} as const;

export type TestModelColor = (typeof TEST_MODEL_COLORS)[number] | typeof OTHER_MODEL_COLOR;

/** The reasoning efforts of a model share its color, so that they read as one line. */
export function getTestModelColor(models: TestModel[], model: TestModel): TestModelColor {
	return getTestModelColorAt(testModelColorIndex(models, model));
}

export function getTestModelColorAt(index: number): TestModelColor {
	return TEST_MODEL_COLORS[index] ?? OTHER_MODEL_COLOR;
}

export function testModelKey(model: TestModel): string {
	return [model.provider, model.modelId, model.reasoningEffort].filter(Boolean).join(':');
}

/** The models of a run in a few words: the model when there is one, else how many, and whether they ran at every effort. */
export function describeTestModels(models: TestModel[]): string {
	const distinctModels = countDistinctModels(models);
	const label = distinctModels === 1 ? (models[0]?.modelId ?? '') : `${distinctModels} models`;
	const efforts = describeReasoningEfforts(models);
	return efforts ? `${label} · ${efforts}` : label;
}

export function countDistinctModels(models: TestModel[]): number {
	return new Set(models.map((model) => `${model.provider}:${model.modelId}`)).size;
}

/** The reasoning efforts a run set, as "high effort" or "3 efforts", or null when its models ran at their configured one. */
export function describeReasoningEfforts(models: TestModel[]): string | null {
	const efforts = [...new Set(models.flatMap((model) => (model.reasoningEffort ? [model.reasoningEffort] : [])))];
	if (efforts.length === 0) {
		return null;
	}
	return efforts.length === 1 ? `${efforts[0]} effort` : `${efforts.length} efforts`;
}

/** Groups the entries of a run by model, whatever reasoning effort they ran at, in the order the models first appear. */
export function groupByBaseModel<T extends TestModel>(entries: T[]): T[][] {
	const groups: T[][] = [];
	for (const entry of entries) {
		const group = groups.find(([first]) => isSameModel(first, entry));
		if (group) {
			group.push(entry);
		} else {
			groups.push([entry]);
		}
	}
	return groups;
}

/** Orders reasoning efforts from the lowest to the highest, the effort configured for the model first. */
export function reasoningEffortRank(model: Pick<TestModel, 'reasoningEffort'>): number {
	return model.reasoningEffort ? EFFORT_OPTIONS.indexOf(model.reasoningEffort) : -1;
}

/** The model as the run views name it, with the reasoning effort it ran at when the run set one. */
export function formatTestModel(model: TestModel): string {
	return model.reasoningEffort ? `${model.modelId} · ${model.reasoningEffort}` : model.modelId;
}

export function isActiveRun(run: Pick<TestRunSummary, 'status'>): boolean {
	return run.status === 'queued' || run.status === 'running';
}

/** The context a run that is not a comparison ran its tests against. */
export function getSingleRunVariant(run: Pick<TestRunSummary, 'trigger'>): ContextVariant {
	return run.trigger === 'changes' ? 'draft' : 'production';
}

/** The changed files that are context, as edited tests alone answer the same on production and on the draft. */
export function getContextChanges(draft: DraftContext | null): DraftContext['changes'] {
	return draft?.changes.filter((change) => !isInTestsFolder(change.path)) ?? [];
}

export function formatPassRate(passed: number, total: number): string {
	return total === 0 ? '—' : `${Math.round((passed / total) * 100)}%`;
}

export function formatCost(cost: number | null | undefined): string {
	return cost === null || cost === undefined ? '—' : `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

export function formatUnitCost(cost: number | null | undefined): string {
	return cost === null || cost === undefined ? '—' : `$${cost.toFixed(cost < 0.1 ? 3 : 2)}`;
}

export function formatDuration(durationMs: number | null | undefined): string {
	return durationMs === null || durationMs === undefined ? '—' : `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatCount(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return '—';
	}
	return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value % 1 === 0 ? 0 : 1);
}

export function average(values: (number | null | undefined)[]): number | null {
	const recorded = values.filter((value): value is number => typeof value === 'number');
	return recorded.length === 0 ? null : recorded.reduce((sum, value) => sum + value, 0) / recorded.length;
}

/** The results of each test, in the order the tests first appear. */
export function groupResultsByTest(results: TestResultOutcome[]): Map<string, TestResultOutcome[]> {
	const groups = new Map<string, TestResultOutcome[]>();
	for (const result of results) {
		groups.set(result.testPath, [...(groups.get(result.testPath) ?? []), result]);
	}
	return groups;
}

export function getAccuracy(summary: Pick<TestModelSummary, 'passedAttempts' | 'attempts'>): number | null {
	return summary.attempts === 0 ? null : summary.passedAttempts / summary.attempts;
}

export function onEnterOrSpace(activate: () => void) {
	return (event: KeyboardEvent) => {
		if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			activate();
		}
	};
}

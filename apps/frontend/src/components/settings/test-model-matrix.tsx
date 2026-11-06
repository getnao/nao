import { isSameTestModel, testResultModel } from '@nao/backend/test-run';
import { TESTS_FOLDER } from '@nao/shared/test-paths';
import type { ActiveEffort } from '@nao/backend/llm';
import type { TestModel } from '@nao/backend/test-run';

import type { TestResultOutcome, TestRunWithResults } from '@/components/settings/test-run-types';
import { AttemptDots, ModelName } from '@/components/settings/test-model-labels';
import {
	getSingleRunVariant,
	groupByBaseModel,
	groupResultsByTest,
	reasoningEffortRank,
	testModelKey,
} from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

/**
 * Each test against each model of a run, a row per model under the test, with a column per reasoning effort so that the
 * table stays as wide when models run at every effort.
 */
export function TestModelMatrix({
	run,
	testPaths,
	onOpenTest,
}: {
	run: TestRunWithResults;
	testPaths: string[];
	onOpenTest: (testPath: string) => void;
}) {
	const resultsByTest = groupResultsByTest(
		run.results.filter((result) => result.contextVariant === getSingleRunVariant(run)),
	);
	const modelGroups = groupByBaseModel(run.models);
	const efforts = listEffortColumns(run.models);
	return (
		<table className='w-full text-xs'>
			<thead>
				<tr className='border-b text-left text-[11px] text-muted-foreground'>
					<th className='px-3 py-1.5 font-medium'>Test</th>
					<th className='px-3 py-1.5 font-medium whitespace-nowrap'>Model</th>
					{efforts.map((effort) => (
						<th key={effort ?? 'default'} className='w-24 px-3 py-1.5 font-medium'>
							{effort ?? (efforts.length === 1 ? 'Answers' : 'Default')}
						</th>
					))}
					<th aria-hidden className='w-full' />
				</tr>
			</thead>
			<tbody>
				{testPaths.map((testPath) => {
					const results = resultsByTest.get(testPath) ?? [];
					const isDisagreeing = modelsDisagree(run.models.map((model) => filterModelResults(results, model)));
					return modelGroups.map((variants, index) => (
						<tr
							key={`${testPath}:${testModelKey(toBaseModel(variants[0]))}`}
							className={cn(
								index === modelGroups.length - 1 && 'border-b last:border-b-0',
								isDisagreeing && 'bg-amber-500/5',
							)}
						>
							{index === 0 && (
								<td rowSpan={modelGroups.length} className='px-3 py-1.5 align-top'>
									<button
										type='button'
										className='block w-56 cursor-pointer truncate text-left font-medium hover:underline'
										title={`Open ${TESTS_FOLDER}/${testPath}`}
										onClick={() => onOpenTest(testPath)}
									>
										{results.at(0)?.testName ?? testPath}
									</button>
								</td>
							)}
							<td className='px-3 py-1 whitespace-nowrap'>
								<ModelName models={run.models} model={toBaseModel(variants[0])} />
							</td>
							{efforts.map((effort) => {
								const variant = variants.find((model) => (model.reasoningEffort ?? null) === effort);
								return (
									<td key={effort ?? 'default'} className='px-3 py-1 whitespace-nowrap'>
										{variant && (
											<AttemptDots
												results={filterModelResults(results, variant)}
												expected={run.attempts}
											/>
										)}
									</td>
								);
							})}
							<td aria-hidden />
						</tr>
					));
				})}
			</tbody>
		</table>
	);
}

export function listTestsWhereModelsDisagree(run: TestRunWithResults): Set<string> {
	const disagreeing = new Set<string>();
	for (const [testPath, results] of groupResultsByTest(
		run.results.filter((result) => result.contextVariant === getSingleRunVariant(run)),
	)) {
		if (modelsDisagree(run.models.map((model) => filterModelResults(results, model)))) {
			disagreeing.add(testPath);
		}
	}
	return disagreeing;
}

function modelsDisagree(outcomes: Pick<TestResultOutcome, 'passed'>[][]): boolean {
	const passRates = outcomes
		.filter((results) => results.length > 0)
		.map((results) => results.filter((result) => result.passed).length / results.length);
	return new Set(passRates).size > 1;
}

function filterModelResults(results: TestResultOutcome[], model: TestModel): TestResultOutcome[] {
	return results.filter((result) => isSameTestModel(testResultModel(result), model));
}

/** The reasoning efforts the models of a run ran at, from the lowest, the effort configured for each model first. */
function listEffortColumns(models: TestModel[]): (ActiveEffort | null)[] {
	const efforts = new Set(models.map((model) => model.reasoningEffort ?? null));
	return [...efforts].sort(
		(left, right) =>
			reasoningEffortRank({ reasoningEffort: left }) - reasoningEffortRank({ reasoningEffort: right }),
	);
}

function toBaseModel(model: TestModel): TestModel {
	return {
		provider: model.provider,
		modelId: model.modelId,
		...(model.llmConfigId && { llmConfigId: model.llmConfigId }),
	};
}

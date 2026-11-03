import { TESTS_FOLDER } from '@nao/shared/test-paths';
import { isSameModel, resultModel } from '@nao/shared/types';

import type { TestResultOutcome, TestRunWithResults } from '@/components/settings/test-run-types';
import { AttemptDots, ModelName } from '@/components/settings/test-model-labels';
import { getSingleRunVariant, groupResultsByTest, testModelKey } from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

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
	return (
		<table className='w-full text-xs'>
			<thead>
				<tr className='border-b text-left text-[11px] text-muted-foreground'>
					<th className='w-2/5 px-3 py-1.5 font-medium'>Test</th>
					{run.models.map((model) => (
						<th key={testModelKey(model)} className='px-3 py-1.5 font-medium'>
							<ModelName models={run.models} model={model} />
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{testPaths.map((testPath) => {
					const results = resultsByTest.get(testPath) ?? [];
					const outcomes = run.models.map((model) =>
						results.filter((result) => isSameModel(resultModel(result), model)),
					);
					return (
						<tr
							key={testPath}
							className={cn('border-b last:border-b-0', modelsDisagree(outcomes) && 'bg-amber-500/5')}
						>
							<td className='max-w-0 px-3 py-1.5'>
								<button
									type='button'
									className='w-full cursor-pointer truncate text-left font-medium hover:underline'
									title={`Open ${TESTS_FOLDER}/${testPath}`}
									onClick={() => onOpenTest(testPath)}
								>
									{results.at(0)?.testName ?? testPath}
								</button>
							</td>
							{outcomes.map((modelResults, index) => (
								<td key={testModelKey(run.models[index])} className='px-3 py-1.5'>
									<AttemptDots results={modelResults} expected={run.attempts} />
								</td>
							))}
						</tr>
					);
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
		const outcomes = run.models.map((model) => results.filter((result) => isSameModel(resultModel(result), model)));
		if (modelsDisagree(outcomes)) {
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

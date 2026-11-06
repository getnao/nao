import type { TestModel } from '@nao/backend/test-run';

import type { TestModelColor, TestRunResult } from '@/components/settings/test-run-types';
import { formatTestModel, getTestModelColor } from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

export function ModelName({
	models,
	model,
	isBold = false,
}: {
	models: TestModel[];
	model: TestModel;
	isBold?: boolean;
}) {
	return (
		<span className='flex min-w-0 items-center gap-1.5'>
			<ModelDot color={getTestModelColor(models, model)} />
			<span className={cn('truncate', isBold && 'font-medium')}>{formatTestModel(model)}</span>
		</span>
	);
}

export function ModelDot({ color }: { color: TestModelColor }) {
	return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', color.background)} />;
}

export function AttemptDots({
	results,
	expected,
}: {
	results: Pick<TestRunResult, 'id' | 'passed'>[];
	expected: number;
}) {
	const passed = results.filter((result) => result.passed).length;
	return (
		<span className='flex items-center gap-1' aria-label={`${passed} of ${results.length} attempts passed`}>
			<span className='flex gap-0.5'>
				{results.map((result) => (
					<span
						key={result.id}
						className={cn(
							'size-2 rounded-full',
							result.passed ? 'bg-green-600 dark:bg-green-500' : 'bg-destructive',
						)}
					/>
				))}
				{Array.from({ length: Math.max(0, expected - results.length) }, (_, index) => (
					<span key={`pending-${index}`} className='size-2 rounded-full border border-muted-foreground/50' />
				))}
			</span>
			{results.length > 0 && passed < results.length && (
				<span className={cn('tabular-nums', passed === 0 ? 'text-destructive' : 'text-muted-foreground')}>
					{passed}/{results.length}
				</span>
			)}
		</span>
	);
}

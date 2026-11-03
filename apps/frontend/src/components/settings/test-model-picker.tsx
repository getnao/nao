import { getTestRunConcurrency } from '@nao/backend/test-run';
import { pluralize } from '@nao/shared';
import { isSameModel } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Cpu, Minus, Plus } from 'lucide-react';

import type { LlmSelectedModel } from '@nao/shared/types';
import type { TestModelStats } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { formatDuration, formatUnitCost } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MAX_TEST_RUN_ATTEMPTS, MAX_TEST_RUN_MODELS } from '@/hooks/use-test-run-settings';
import { trpc } from '@/main';

interface TestModelPickerProps {
	settings: TestRunSettings;
	testCount: number;
	/** Context variants the next run tries, 2 when it compares the user's changes with production. */
	variantCount: number;
	disabled?: boolean;
}

export function TestModelPicker({ settings, testCount, variantCount, disabled }: TestModelPickerProps) {
	const availableModels = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());
	const stats = useQuery(trpc.testRun.getModelStats.queryOptions());
	const { models, attempts } = settings;

	const toggleModel = (model: LlmSelectedModel) => {
		const isSelected = models.some((selected) => isSameModel(selected, model));
		const nextModels = isSelected
			? models.filter((selected) => !isSameModel(selected, model))
			: [...models, { provider: model.provider, modelId: model.modelId }];
		if (nextModels.length > 0 && nextModels.length <= MAX_TEST_RUN_MODELS) {
			settings.update({ models: nextModels });
		}
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type='button'
					size='sm'
					variant='outline'
					className='h-6 gap-1.5 px-2 text-xs'
					disabled={disabled}
					aria-label='Models to test'
				>
					<Cpu className='size-3.5' />
					{describeSelection(models, attempts)}
					<ChevronDown className='size-3 text-muted-foreground' />
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='w-96 p-0 text-xs'>
				<div className='flex items-center justify-between px-3 pt-3 pb-1.5'>
					<span className='text-sm font-semibold'>Models to test</span>
					{settings.isCustom ? (
						<button
							type='button'
							className='cursor-pointer text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
							onClick={settings.reset}
						>
							Use the project defaults
						</button>
					) : (
						<span className='text-muted-foreground'>Project defaults</span>
					)}
				</div>
				<ul className='flex max-h-64 flex-col overflow-y-auto pb-1'>
					{(availableModels.data ?? []).map((model) => {
						const isSelected = models.some((selected) => isSameModel(selected, model));
						return (
							<li key={`${model.provider}:${model.modelId}`}>
								<label className='flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent/50'>
									<Checkbox checked={isSelected} onCheckedChange={() => toggleModel(model)} />
									<LlmProviderIcon
										provider={model.provider}
										baseUrl={model.baseUrl}
										className='size-3.5'
									/>
									<span className='min-w-0 flex-1 truncate'>{model.name}</span>
									<ModelStatsHint stats={findStats(stats.data, model)} />
								</label>
							</li>
						);
					})}
				</ul>
				<div className='flex items-center justify-between gap-3 border-t px-3 py-2'>
					<span className='flex flex-col'>
						<span>Attempts per test</span>
						<span className='text-muted-foreground'>Several attempts reveal flaky answers.</span>
					</span>
					<AttemptsStepper attempts={attempts} onChange={(next) => settings.update({ attempts: next })} />
				</div>
				<RunEstimate
					models={models}
					stats={stats.data}
					testCount={testCount}
					attempts={attempts}
					variantCount={variantCount}
				/>
			</PopoverContent>
		</Popover>
	);
}

function describeSelection(models: LlmSelectedModel[], attempts: number): string {
	const label = models.length === 1 ? models[0].modelId : `${models.length} models`;
	return attempts > 1 ? `${label} · ×${attempts}` : label;
}

function ModelStatsHint({ stats }: { stats: TestModelStats | undefined }) {
	if (!stats || stats.averageCost === null) {
		return <span className='shrink-0 text-muted-foreground'>no history yet</span>;
	}
	return (
		<span className='shrink-0 text-muted-foreground tabular-nums'>
			{formatUnitCost(stats.averageCost)}/question · {formatDuration(stats.averageDurationMs)}
		</span>
	);
}

function AttemptsStepper({ attempts, onChange }: { attempts: number; onChange: (attempts: number) => void }) {
	return (
		<div className='flex items-center rounded-md border'>
			<Button
				type='button'
				size='icon-sm'
				variant='ghost'
				className='size-6 rounded-r-none'
				aria-label='Fewer attempts'
				disabled={attempts <= 1}
				onClick={() => onChange(attempts - 1)}
			>
				<Minus className='size-3' />
			</Button>
			<span
				className='w-7 border-x text-center leading-6 font-medium tabular-nums'
				aria-label='Attempts per test'
			>
				{attempts}
			</span>
			<Button
				type='button'
				size='icon-sm'
				variant='ghost'
				className='size-6 rounded-l-none'
				aria-label='More attempts'
				disabled={attempts >= MAX_TEST_RUN_ATTEMPTS}
				onClick={() => onChange(attempts + 1)}
			>
				<Plus className='size-3' />
			</Button>
		</div>
	);
}

function RunEstimate({
	models,
	stats,
	testCount,
	attempts,
	variantCount,
}: {
	models: LlmSelectedModel[];
	stats: TestModelStats[] | undefined;
	testCount: number;
	attempts: number;
	variantCount: number;
}) {
	const attemptsPerModel = testCount * attempts * variantCount;
	const attemptCount = attemptsPerModel * models.length;
	const modelStats = models.map((model) => findStats(stats, model));
	const isEstimated = modelStats.every((entry) => entry?.averageCost != null && entry.averageDurationMs != null);
	const cost = modelStats.reduce((sum, entry) => sum + (entry?.averageCost ?? 0) * attemptsPerModel, 0);
	const attemptsInFlightPerModel = getTestRunConcurrency(models.length) / Math.max(models.length, 1);
	const durationMs = Math.max(
		0,
		...modelStats.map((entry) => ((entry?.averageDurationMs ?? 0) * attemptsPerModel) / attemptsInFlightPerModel),
	);
	return (
		<div className='mx-3 mb-3 rounded-md bg-muted/60 px-2.5 py-2'>
			<span className='font-medium'>
				{attemptCount} {pluralize('attempt', attemptCount)}
			</span>
			<span className='text-muted-foreground'>
				{' '}
				= {testCount} {pluralize('test', testCount)} × {models.length} {pluralize('model', models.length)}
				{attempts > 1 && ` × ${attempts}`}
				{variantCount > 1 && ' × 2 contexts'}
			</span>
			<div className='text-muted-foreground'>
				{isEstimated ? (
					<>
						≈ <span className='font-medium text-foreground'>${cost.toFixed(2)}</span> · about{' '}
						{Math.max(1, Math.round(durationMs / 60_000))} min, from the recent runs
					</>
				) : (
					'No estimate: some models have not run yet.'
				)}
			</div>
		</div>
	);
}

function findStats(stats: TestModelStats[] | undefined, model: LlmSelectedModel): TestModelStats | undefined {
	return stats?.find((entry) => isSameModel(entry, model));
}

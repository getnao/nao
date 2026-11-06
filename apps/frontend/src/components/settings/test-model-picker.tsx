import { getModelReasoningEfforts } from '@nao/backend/provider-meta';
import { pluralize } from '@nao/shared';
import { isSameModel } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, Cpu, Minus, Plus } from 'lucide-react';

import type { ActiveEffort, ReasoningEffort } from '@nao/backend/llm';
import type { TestModelDefaultEffort, TestModelSelection } from '@nao/backend/test-run';
import type { LlmSelectedModel } from '@nao/shared/types';
import type { TestModelStats } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { formatUnitCost } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { formatTestSettingsYaml } from '@/lib/test-settings-yaml';
import { cn } from '@/lib/utils';
import {
	countModelRuns,
	countRunEfforts,
	listPickedEfforts,
	MAX_TEST_RUN_ATTEMPTS,
	MAX_TEST_RUN_MODELS,
	MAX_TEST_RUN_THREADS,
} from '@/hooks/use-test-run-settings';
import { trpc } from '@/main';

interface TestModelPickerProps {
	settings: TestRunSettings;
	testCount: number;
	/** Context variants the next run tries, 2 when it compares the user's changes with the main branch. */
	variantCount: number;
	disabled?: boolean;
}

export function TestModelPicker({ settings, testCount, variantCount, disabled }: TestModelPickerProps) {
	const availableModels = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());
	const stats = useQuery(trpc.testRun.getModelStats.queryOptions());
	const defaultEfforts = useQuery(trpc.testRun.getDefaultReasoningEfforts.queryOptions());
	const { models, attempts, threads } = settings;

	const toggleModel = (model: LlmSelectedModel) => {
		const isSelected = models.some((selected) => isSameModel(selected, model));
		const nextModels = isSelected
			? models.filter((selected) => !isSameModel(selected, model))
			: [...models, { provider: model.provider, modelId: model.modelId }];
		if (nextModels.length > 0 && nextModels.length <= MAX_TEST_RUN_MODELS) {
			settings.update({ models: nextModels });
		}
	};

	const setReasoningEfforts = (model: TestModelSelection, reasoningEfforts: ActiveEffort[]) => {
		settings.update({
			models: models.map((selected) =>
				isSameModel(selected, model) ? { ...selected, reasoningEfforts } : selected,
			),
		});
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
			<PopoverContent align='end' className='w-96 p-0 text-xs' onInteractOutside={keepOpenInsideMenus}>
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
						const selected = models.find((candidate) => isSameModel(candidate, model));
						const isSelected = selected !== undefined;
						return (
							<li
								key={`${model.provider}:${model.modelId}`}
								className='flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50'
							>
								<label className='flex min-w-0 flex-1 cursor-pointer items-center gap-2'>
									<Checkbox checked={isSelected} onCheckedChange={() => toggleModel(model)} />
									<LlmProviderIcon
										provider={model.provider}
										baseUrl={model.baseUrl}
										className='size-3.5'
									/>
									<span className='min-w-0 flex-1 truncate'>{model.name}</span>
								</label>
								{selected && (
									<ReasoningEffortBars
										model={selected}
										defaultEffort={findDefaultEffort(defaultEfforts.data, selected)}
										onChange={(reasoningEfforts) => setReasoningEfforts(selected, reasoningEfforts)}
									/>
								)}
								<ModelCostHint stats={findStats(stats.data, model)} />
							</li>
						);
					})}
				</ul>
				<div className='flex items-center justify-between gap-3 border-t px-3 py-2'>
					<span className='flex flex-col'>
						<span>Times to ask each test</span>
						<span className='text-muted-foreground'>Several answers reveal flaky tests.</span>
					</span>
					<NumberStepper
						label='Times to ask each test'
						value={attempts}
						max={MAX_TEST_RUN_ATTEMPTS}
						onChange={(next) => settings.update({ attempts: next })}
					/>
				</div>
				<div className='flex items-center justify-between gap-3 border-t px-3 py-2'>
					<span className='flex flex-col'>
						<span>Threads</span>
						<span className='text-muted-foreground'>Answers generated at the same time.</span>
					</span>
					<NumberStepper
						label='Threads'
						value={threads}
						max={MAX_TEST_RUN_THREADS}
						onChange={(next) => settings.update({ threads: next })}
					/>
				</div>
				<RunEstimate
					models={models}
					stats={stats.data}
					testCount={testCount}
					attempts={attempts}
					threads={threads}
					variantCount={variantCount}
				/>
				<CopyAsConfigButton settings={settings} />
			</PopoverContent>
		</Popover>
	);
}

/**
 * The effort menus portal out of the popover and come from another copy of Radix, so the popover would take a click in
 * them for one outside and close.
 */
function keepOpenInsideMenus(event: Event) {
	if (event.target instanceof Element && event.target.closest('[data-slot="dropdown-menu-content"]')) {
		event.preventDefault();
	}
}

function describeSelection(models: TestModelSelection[], attempts: number): string {
	const modelLabel = models.length === 1 ? models[0].modelId : `${models.length} models`;
	const runCount = countModelRuns(models);
	const label = runCount > models.length ? `${modelLabel} · ${runCount} runs` : modelLabel;
	return attempts > 1 ? `${label} · ×${attempts}` : label;
}

/**
 * A bar per reasoning effort a picked model supports, from the lowest, lit for the efforts it runs at, opening the
 * choice of these efforts: the one of the model settings, or one or more to run the model once per effort.
 */
function ReasoningEffortBars({
	model,
	defaultEffort,
	onChange,
}: {
	model: TestModelSelection;
	defaultEffort: ReasoningEffort | null;
	onChange: (reasoningEfforts: ActiveEffort[]) => void;
}) {
	const efforts = getModelReasoningEfforts(model.provider, model.modelId);
	if (efforts.length === 0) {
		return null;
	}
	const picked = listPickedEfforts(model);
	const isPicked = picked.length > 0;
	const togglePicked = (effort: ActiveEffort) =>
		onChange(efforts.filter((candidate) => (candidate === effort) !== picked.includes(candidate)));
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					aria-label={`Reasoning efforts of ${model.modelId}`}
					className={cn(
						'flex w-20 shrink-0 cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
						isPicked ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent',
					)}
				>
					<span aria-hidden className='flex h-3 items-end gap-0.5'>
						{efforts.map((effort, index) => (
							<span
								key={effort}
								className={cn(
									'w-[3px] rounded-[1px]',
									isPicked
										? picked.includes(effort)
											? 'bg-primary'
											: 'bg-primary/25'
										: effort === defaultEffort
											? 'bg-foreground'
											: 'bg-muted-foreground/35',
								)}
								style={{ height: `${30 + (70 * index) / Math.max(efforts.length - 1, 1)}%` }}
							/>
						))}
					</span>
					{describePickedEfforts(picked, efforts, defaultEffort)}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-48'>
				<DropdownMenuLabel>Reasoning efforts to run</DropdownMenuLabel>
				<DropdownMenuCheckboxItem
					className='text-xs'
					checked={!isPicked}
					onSelect={(event) => event.preventDefault()}
					onCheckedChange={() => onChange([])}
				>
					Model settings
					<span className='text-muted-foreground'>{defaultEffort ?? 'provider default'}</span>
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					className='text-xs'
					checked={picked.length === efforts.length}
					onSelect={(event) => event.preventDefault()}
					onCheckedChange={(checked) => onChange(checked ? efforts : [])}
				>
					All {efforts.length} efforts
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				{efforts.map((effort) => (
					<DropdownMenuCheckboxItem
						key={effort}
						className='text-xs'
						checked={picked.includes(effort)}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={() => togglePicked(effort)}
					>
						{effort}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function describePickedEfforts(
	picked: ActiveEffort[],
	efforts: ActiveEffort[],
	defaultEffort: ReasoningEffort | null,
): string {
	if (picked.length === 0) {
		return defaultEffort ?? 'default';
	}
	if (picked.length === efforts.length) {
		return 'all';
	}
	return picked.length === 1 ? picked[0] : `${picked.length} efforts`;
}

function ModelCostHint({ stats }: { stats: TestModelStats | undefined }) {
	if (!stats || stats.averageCost === null) {
		return <span className='min-w-24 shrink-0 text-right text-muted-foreground'>no history yet</span>;
	}
	return (
		<SimpleTooltip
			content={`Average cost of one answer with this model, over its ${stats.attempts} ${pluralize('answer', stats.attempts)} of the last 30 days.`}
		>
			<span className='min-w-24 shrink-0 cursor-help text-right text-muted-foreground tabular-nums'>
				{formatUnitCost(stats.averageCost)}/question
			</span>
		</SimpleTooltip>
	);
}

interface NumberStepperProps {
	label: string;
	value: number;
	max: number;
	onChange: (value: number) => void;
}

function NumberStepper({ label, value, max, onChange }: NumberStepperProps) {
	return (
		<div className='flex items-center rounded-md border'>
			<Button
				type='button'
				size='icon-sm'
				variant='ghost'
				className='size-6 rounded-r-none'
				aria-label={`Decrease ${label.toLowerCase()}`}
				disabled={value <= 1}
				onClick={() => onChange(value - 1)}
			>
				<Minus className='size-3' />
			</Button>
			<span className='w-7 border-x text-center leading-6 font-medium tabular-nums' aria-label={label}>
				{value}
			</span>
			<Button
				type='button'
				size='icon-sm'
				variant='ghost'
				className='size-6 rounded-l-none'
				aria-label={`Increase ${label.toLowerCase()}`}
				disabled={value >= max}
				onClick={() => onChange(value + 1)}
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
	threads,
	variantCount,
}: {
	models: TestModelSelection[];
	stats: TestModelStats[] | undefined;
	testCount: number;
	attempts: number;
	threads: number;
	variantCount: number;
}) {
	const attemptsPerModelRun = testCount * attempts * variantCount;
	const modelRunCount = countModelRuns(models);
	const attemptCount = attemptsPerModelRun * modelRunCount;
	const modelStats = models.map((model) => findStats(stats, model));
	const isEstimated =
		modelStats.length > 0 &&
		modelStats.every((entry) => entry?.averageCost != null && entry.averageDurationMs != null);
	const averageCosts = modelStats.map((entry) => entry?.averageCost);
	const averageDurations = modelStats.map((entry) => entry?.averageDurationMs);
	const cost = sumOverModelRuns(models, averageCosts, attemptsPerModelRun);
	const longestAttemptMs = Math.max(0, ...averageDurations.map((duration) => duration ?? 0));
	const durationMs = Math.max(
		sumOverModelRuns(models, averageDurations, attemptsPerModelRun) / Math.max(threads, 1),
		longestAttemptMs,
	);
	return (
		<div className='mx-3 mb-1 rounded-md bg-muted/60 px-2.5 py-2'>
			<span className='font-medium'>
				{attemptCount} {pluralize('answer', attemptCount)}
			</span>
			<span className='text-muted-foreground'>
				{' '}
				= {testCount} {pluralize('test', testCount)} × {models.length} {pluralize('model', models.length)}
				{modelRunCount > models.length && ` (${modelRunCount} with their efforts)`}
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

/** Copies the selection as the `test` block of nao_config.yaml, to make it the project defaults through review. */
function CopyAsConfigButton({ settings }: { settings: TestRunSettings }) {
	const { isCopied, copy } = useCopyToClipboard();
	return (
		<div className='flex justify-end px-3 pb-2'>
			<button
				type='button'
				className='flex cursor-pointer items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
				disabled={settings.models.length === 0}
				onClick={() => copy(formatTestSettingsYaml(settings))}
			>
				{isCopied ? <Check className='size-3' /> : <Copy className='size-3' />}
				{isCopied ? 'Copied' : 'Copy as nao_config.yaml'}
			</button>
		</div>
	);
}

function findDefaultEffort(
	defaultEfforts: TestModelDefaultEffort[] | undefined,
	model: LlmSelectedModel,
): ReasoningEffort | null {
	return defaultEfforts?.find((entry) => isSameModel(entry, model))?.reasoningEffort ?? null;
}

/** Totals a per-attempt average of each picked model over all the attempts it runs, once per effort picked. */
function sumOverModelRuns(
	models: TestModelSelection[],
	averages: (number | null | undefined)[],
	attemptsPerModelRun: number,
): number {
	return models.reduce(
		(sum, model, index) => sum + (averages[index] ?? 0) * attemptsPerModelRun * countRunEfforts(model),
		0,
	);
}

function findStats(stats: TestModelStats[] | undefined, model: LlmSelectedModel): TestModelStats | undefined {
	return stats?.find((entry) => isSameModel(entry, model));
}

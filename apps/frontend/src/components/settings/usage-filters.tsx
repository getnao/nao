import { useState } from 'react';
import { CheckIcon, ChevronDownIcon, Radio, ThumbsUp, Users, Wrench } from 'lucide-react';
import { CHAT_REPLAY_FEEDBACK_STATES, CHAT_REPLAY_TOOL_STATES, providerLabel } from '@nao/shared/types';
import { USAGE_PERIOD_LIMITS, USAGE_SOURCES } from '@nao/backend/usage';
import type {
	Granularity,
	UsagePeriodMode,
	UsagePeriodPreference,
	UsagePeriodUnit,
	UsageSource,
} from '@nao/backend/usage';
import type {
	ChatReplayFeedbackState,
	ChatReplayToolState,
	LlmProvider,
	ProjectChatReplayFacets,
} from '@nao/shared/types';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const periodOptions: { value: UsagePeriodMode; label: string }[] = [
	{ value: '24h', label: 'Last 24 hours' },
	{ value: '15d', label: 'Last 15 days' },
	{ value: '6m', label: 'Last 6 months' },
	{ value: 'custom', label: 'Custom…' },
];

export const dateFormats: Record<Granularity, string> = {
	hour: 'MMM d, HH:00',
	day: 'MMM d',
	month: 'MMM yyyy',
};

interface UsageFiltersProps {
	showUsageControls?: boolean;
	provider: LlmProvider | 'all';
	onProviderChange: (value: LlmProvider | 'all') => void;
	periodPreference: UsagePeriodPreference;
	onPeriodPreferenceChange: (value: UsagePeriodPreference) => void;
	availableProviders: LlmProvider[] | undefined;
	chatFacets: ProjectChatReplayFacets | undefined;
	selectedUserNames: string[] | undefined;
	onSelectedUserNamesChange: (value: string[] | undefined) => void;
	selectedSources: UsageSource[] | undefined;
	onSelectedSourcesChange: (value: UsageSource[] | undefined) => void;
}

export function UsageFilters({
	showUsageControls = true,
	provider,
	onProviderChange,
	periodPreference,
	onPeriodPreferenceChange,
	availableProviders,
	chatFacets,
	selectedUserNames,
	onSelectedUserNamesChange,
	selectedSources,
	onSelectedSourcesChange,
}: UsageFiltersProps) {
	const userOptions = (chatFacets?.userNames ?? []).map((name) => ({
		value: name,
		label: name,
		count: chatFacets?.userNameCounts[name],
	}));
	const sourceOptions = USAGE_SOURCES.map((value) => ({
		value,
		label: sourceLabels[value],
	}));

	return (
		<div className='flex flex-wrap items-center gap-2'>
			{showUsageControls && (
				<>
					<Select value={provider} onValueChange={(v) => onProviderChange(v as LlmProvider | 'all')}>
						<SelectTrigger className='w-36'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>All providers</SelectItem>
							{availableProviders?.map((p) => (
								<SelectItem key={p} value={p}>
									{providerLabel(p)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<UsagePeriodFilter value={periodPreference} onChange={onPeriodPreferenceChange} />
				</>
			)}

			<MultiSelectFilter
				label='Source'
				icon={Radio}
				options={sourceOptions}
				selectedValues={selectedSources}
				onChange={onSelectedSourcesChange}
			/>
			<MultiSelectFilter
				label='Users'
				icon={Users}
				options={userOptions}
				selectedValues={selectedUserNames}
				onChange={onSelectedUserNamesChange}
			/>
		</div>
	);
}

function UsagePeriodFilter({
	value,
	onChange,
}: {
	value: UsagePeriodPreference;
	onChange: (value: UsagePeriodPreference) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [showCustomForm, setShowCustomForm] = useState(false);
	const [draftValue, setDraftValue] = useState(String(value.customPeriod.value));
	const [draftUnit, setDraftUnit] = useState<UsagePeriodUnit>(value.customPeriod.unit);
	const parsedValue = Number(draftValue);
	const maxValue = USAGE_PERIOD_LIMITS[draftUnit];
	const isValid = Number.isInteger(parsedValue) && parsedValue >= 1 && parsedValue <= maxValue;

	const openCustomPeriod = () => {
		setDraftValue(String(value.customPeriod.value));
		setDraftUnit(value.customPeriod.unit);
		setShowCustomForm(true);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		setIsOpen(nextOpen);
		if (!nextOpen) {
			setShowCustomForm(false);
		}
	};

	const selectPreset = (mode: Exclude<UsagePeriodMode, 'custom'>) => {
		onChange({ ...value, mode });
		handleOpenChange(false);
	};

	const applyCustomPeriod = () => {
		if (!isValid) {
			return;
		}

		onChange({
			mode: 'custom',
			customPeriod: { value: parsedValue, unit: draftUnit },
		});
		handleOpenChange(false);
	};

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					type='button'
					variant='outline'
					size='sm'
					className='h-8 w-40 justify-between px-2.5 font-normal'
				>
					<span className='truncate'>{formatPeriodPreference(value)}</span>
					<ChevronDownIcon className='size-4 shrink-0 text-muted-foreground' />
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className={showCustomForm ? 'w-72' : 'w-40 p-1'}>
				{showCustomForm ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							applyCustomPeriod();
						}}
					>
						<div className='mb-3 text-sm font-medium'>Custom period</div>
						<div className='flex gap-2'>
							<Input
								type='number'
								min={1}
								max={maxValue}
								step={1}
								value={draftValue}
								aria-label='Period value'
								onChange={(event) => setDraftValue(event.target.value)}
								autoFocus
							/>
							<Select value={draftUnit} onValueChange={(unit) => setDraftUnit(unit as UsagePeriodUnit)}>
								<SelectTrigger className='w-28'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='hour'>Hours</SelectItem>
									<SelectItem value='day'>Days</SelectItem>
									<SelectItem value='month'>Months</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className={cn('mt-1.5 text-xs text-muted-foreground', !isValid && 'text-destructive')}>
							Enter 1–{maxValue} {formatPeriodUnit(draftUnit, maxValue)}
						</div>
						<div className='mt-4 flex justify-end gap-2'>
							<Button type='button' variant='ghost' size='sm' onClick={() => handleOpenChange(false)}>
								Cancel
							</Button>
							<Button type='submit' size='sm' disabled={!isValid}>
								Apply
							</Button>
						</div>
					</form>
				) : (
					<div className='flex flex-col'>
						{periodOptions.map((option) => {
							const isSelected = value.mode === option.value;

							return (
								<button
									key={option.value}
									type='button'
									className='flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground'
									onClick={() => {
										if (option.value === 'custom') {
											openCustomPeriod();
										} else {
											selectPreset(option.value);
										}
									}}
								>
									<span className='flex size-4 items-center justify-center'>
										{isSelected && <CheckIcon className='size-4' />}
									</span>
									{option.label}
								</button>
							);
						})}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

type ReplayFiltersProps = {
	chatFacets: ProjectChatReplayFacets | undefined;
	selectedFeedbackStates: ChatReplayFeedbackState[] | undefined;
	onSelectedFeedbackStatesChange: (value: ChatReplayFeedbackState[] | undefined) => void;
	selectedToolStates: ChatReplayToolState[] | undefined;
	onSelectedToolStatesChange: (value: ChatReplayToolState[] | undefined) => void;
};

function formatPeriodPreference(preference: UsagePeriodPreference): string {
	if (preference.mode !== 'custom') {
		return periodOptions.find((option) => option.value === preference.mode)?.label ?? 'Period';
	}

	const { value, unit } = preference.customPeriod;
	return `Last ${value} ${formatPeriodUnit(unit, value)}`;
}

function formatPeriodUnit(unit: UsagePeriodUnit, value: number): string {
	return value === 1 ? unit : `${unit}s`;
}

export function ReplayFilters({
	chatFacets,
	selectedFeedbackStates,
	onSelectedFeedbackStatesChange,
	selectedToolStates,
	onSelectedToolStatesChange,
}: ReplayFiltersProps) {
	const toolStateOptions = CHAT_REPLAY_TOOL_STATES.map((value) => ({
		value,
		label: toolStateLabels[value],
		count: chatFacets?.toolState[value] ?? 0,
	})).filter((option) => option.count > 0);
	const feedbackOptions = CHAT_REPLAY_FEEDBACK_STATES.map((value) => ({
		value,
		label: feedbackStateLabels[value],
	}));

	return (
		<div className='flex flex-wrap items-center gap-2'>
			<MultiSelectFilter
				label='Votes'
				icon={ThumbsUp}
				options={feedbackOptions}
				selectedValues={selectedFeedbackStates}
				onChange={onSelectedFeedbackStatesChange}
			/>
			<MultiSelectFilter
				label='Tool state'
				icon={Wrench}
				options={toolStateOptions}
				selectedValues={selectedToolStates}
				onChange={onSelectedToolStatesChange}
			/>
		</div>
	);
}

type FilterOption<T extends string> = {
	value: T;
	label: string;
	count?: number;
};

type MultiSelectFilterProps<T extends string> = {
	label: string;
	icon: LucideIcon;
	options: FilterOption<T>[];
	selectedValues: T[] | undefined;
	onChange: (value: T[] | undefined) => void;
};

const toolStateLabels: Record<ChatReplayToolState, string> = {
	noToolsUsed: 'No tools used',
	toolsNoErrors: 'Tools, no errors',
	toolsWithErrors: 'Tools with errors',
};

const feedbackStateLabels: Record<ChatReplayFeedbackState, string> = {
	noVotes: 'No votes',
	upvotes: 'Upvotes',
	downvotes: 'Downvotes',
};

const sourceLabels: Record<UsageSource, string> = {
	web: 'Web',
	slack: 'Slack',
	teams: 'Teams',
	telegram: 'Telegram',
	mattermost: 'Mattermost',
	whatsapp: 'WhatsApp',
	admin: 'Admin mode',
	mcp: 'MCP',
	contextRecommendations: 'Context recommendations',
};

function sameValues<T extends string>(a: T[], b: T[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const setA = new Set(a);
	return b.every((value) => setA.has(value));
}

function MultiSelectFilter<T extends string>({
	label,
	icon: Icon,
	options,
	selectedValues,
	onChange,
}: MultiSelectFilterProps<T>) {
	const allValues = options.map((option) => option.value);
	const committedValues = selectedValues ?? allValues;
	const hasPartialSelection = selectedValues !== undefined && selectedValues.length < allValues.length;

	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<T[]>(committedValues);
	const isDirty = !sameValues(draft, committedValues);

	const handleOpenChange = (next: boolean) => {
		if (next) {
			setDraft(selectedValues ?? allValues);
		}
		setOpen(next);
	};

	const toggleValue = (value: T) => {
		setDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
	};

	const applyDraft = () => {
		onChange(draft.length === 0 || draft.length === allValues.length ? undefined : draft);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant='ghost'
					size='sm'
					disabled={options.length === 0}
					className={cn(hasPartialSelection && 'text-primary')}
				>
					<Icon className='size-4' />
					{label}
					{hasPartialSelection && (
						<Badge variant='secondary' className='h-4 px-1 text-xs'>
							{committedValues.length}
						</Badge>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-56 p-0'>
				<Command>
					<CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
					<div className='flex items-center justify-between border-b px-2 py-1'>
						<button
							type='button'
							className='text-xs text-muted-foreground hover:text-foreground'
							onClick={() => setDraft(allValues)}
						>
							Select all
						</button>
						<button
							type='button'
							className='text-xs text-muted-foreground hover:text-foreground'
							onClick={() => setDraft([])}
						>
							Deselect all
						</button>
					</div>
					<CommandList className='max-h-64 overflow-y-auto'>
						<CommandEmpty className='py-4 text-center text-xs text-muted-foreground'>
							No matches
						</CommandEmpty>
						{options.map((option) => (
							<CommandItem
								key={option.value}
								value={option.label}
								onSelect={() => toggleValue(option.value)}
							>
								<span className='flex size-4 items-center justify-center'>
									{draft.includes(option.value) && <CheckIcon className='size-4' />}
								</span>
								<span className='flex-1 truncate'>{option.label}</span>
								{typeof option.count === 'number' && (
									<Badge variant='secondary' className='h-4 px-1 text-xs'>
										{option.count}
									</Badge>
								)}
							</CommandItem>
						))}
					</CommandList>
					<div className='flex justify-end border-t p-2'>
						<Button size='sm' disabled={!isDirty} onClick={applyDraft}>
							Apply
						</Button>
					</div>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

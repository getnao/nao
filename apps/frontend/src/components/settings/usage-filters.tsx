import { useState } from 'react';
import { CheckIcon, Radio, ThumbsUp, Users, Wrench } from 'lucide-react';
import { CHAT_REPLAY_FEEDBACK_STATES, CHAT_REPLAY_TOOL_STATES, providerLabel } from '@nao/shared/types';
import { USAGE_SOURCES } from '@nao/backend/usage';
import type { UsagePeriodEntry, UsagePeriodEntryInput, UsagePeriodPreference, UsageSource } from '@nao/backend/usage';
import type {
	ChatReplayFeedbackState,
	ChatReplayToolState,
	LlmProvider,
	ProjectChatReplayFacets,
} from '@nao/shared/types';
import type { LucideIcon } from 'lucide-react';
import { UsagePeriodFilter } from '@/components/settings/usage-period-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface UsageFiltersProps {
	showUsageControls?: boolean;
	provider: LlmProvider | 'all';
	onProviderChange: (value: LlmProvider | 'all') => void;
	periodPreference: UsagePeriodPreference;
	onPeriodPreferenceChange: (value: UsagePeriodPreference) => void | Promise<void>;
	periodEntries: UsagePeriodEntry[];
	isPeriodLoading?: boolean;
	periodError?: string;
	onRetryPeriod?: () => void;
	onCreatePeriodEntry: (value: UsagePeriodEntryInput) => void | Promise<void>;
	onUpdatePeriodEntry: (value: UsagePeriodEntry) => void | Promise<void>;
	onDeletePeriodEntry: (id: string) => void | Promise<void>;
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
	periodEntries,
	isPeriodLoading,
	periodError,
	onRetryPeriod,
	onCreatePeriodEntry,
	onUpdatePeriodEntry,
	onDeletePeriodEntry,
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
					<UsagePeriodFilter
						value={periodPreference}
						entries={periodEntries}
						isLoading={isPeriodLoading}
						error={periodError}
						onRetry={onRetryPeriod}
						onChange={onPeriodPreferenceChange}
						onCreateEntry={onCreatePeriodEntry}
						onUpdateEntry={onUpdatePeriodEntry}
						onDeleteEntry={onDeletePeriodEntry}
					/>
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

type ReplayFiltersProps = {
	chatFacets: ProjectChatReplayFacets | undefined;
	selectedFeedbackStates: ChatReplayFeedbackState[] | undefined;
	onSelectedFeedbackStatesChange: (value: ChatReplayFeedbackState[] | undefined) => void;
	selectedToolStates: ChatReplayToolState[] | undefined;
	onSelectedToolStatesChange: (value: ChatReplayToolState[] | undefined) => void;
};

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

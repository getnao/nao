import { Radio, ThumbsUp, Users, Wrench } from 'lucide-react';
import { CHAT_REPLAY_FEEDBACK_STATES, CHAT_REPLAY_TOOL_STATES, providerLabel } from '@nao/shared/types';
import { USAGE_SOURCES } from '@nao/backend/usage';
import type { Granularity, UsageSource } from '@nao/backend/usage';
import type {
	ChatReplayFeedbackState,
	ChatReplayToolState,
	LlmProvider,
	ProjectChatReplayFacets,
} from '@nao/shared/types';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type UsagePeriod = '24h' | '15d' | '6m';

const periodOptions: { value: UsagePeriod; label: string; granularity: Granularity }[] = [
	{ value: '24h', label: 'Last 24 hours', granularity: 'hour' },
	{ value: '15d', label: 'Last 15 days', granularity: 'day' },
	{ value: '6m', label: 'Last 6 months', granularity: 'month' },
];

const periodByGranularity: Record<Granularity, UsagePeriod> = {
	hour: '24h',
	day: '15d',
	month: '6m',
};

export const dateFormats: Record<Granularity, string> = {
	hour: 'MMM d, HH:00',
	day: 'MMM d',
	month: 'MMM yyyy',
};

interface UsageFiltersProps {
	showUsageControls?: boolean;
	provider: LlmProvider | 'all';
	onProviderChange: (value: LlmProvider | 'all') => void;
	granularity: Granularity;
	onGranularityChange: (value: Granularity) => void;
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
	granularity,
	onGranularityChange,
	availableProviders,
	chatFacets,
	selectedUserNames,
	onSelectedUserNamesChange,
	selectedSources,
	onSelectedSourcesChange,
}: UsageFiltersProps) {
	const period = periodByGranularity[granularity];
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
					<Select
						value={period}
						onValueChange={(value) => {
							const option = periodOptions.find((o) => o.value === value);
							if (option) {
								onGranularityChange(option.granularity);
							}
						}}
					>
						<SelectTrigger className='w-40'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{periodOptions.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
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
	whatsapp: 'WhatsApp',
	admin: 'Admin mode',
	mcp: 'MCP',
	contextRecommendations: 'Context recommendations',
};

function MultiSelectFilter<T extends string>({
	label,
	icon: Icon,
	options,
	selectedValues,
	onChange,
}: MultiSelectFilterProps<T>) {
	const allValues = options.map((option) => option.value);
	const currentValues = selectedValues ?? allValues;
	const hasPartialSelection = selectedValues !== undefined && selectedValues.length < allValues.length;

	const updateSelection = (next: T[]) => {
		onChange(next.length === 0 || next.length === allValues.length ? undefined : next);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
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
							{currentValues.length}
						</Badge>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='w-56 max-h-64 overflow-y-auto'>
				<div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
					{label}
				</div>
				<DropdownMenuSeparator />
				{options.map((option) => (
					<DropdownMenuCheckboxItem
						key={option.value}
						checked={currentValues.includes(option.value)}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) => {
							if (!selectedValues) {
								updateSelection([option.value]);
								return;
							}

							const next = checked
								? Array.from(new Set([...currentValues, option.value]))
								: currentValues.filter((value) => value !== option.value);
							updateSelection(next);
						}}
					>
						<div className='flex w-full items-center justify-between gap-2'>
							<span className='truncate'>{option.label}</span>
							{typeof option.count === 'number' && (
								<Badge variant='secondary' className='h-4 px-1 text-xs'>
									{option.count}
								</Badge>
							)}
						</div>
					</DropdownMenuCheckboxItem>
				))}
				{hasPartialSelection && (
					<>
						<DropdownMenuSeparator />
						<button
							type='button'
							className='w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground'
							onClick={() => onChange(undefined)}
						>
							Show all
						</button>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

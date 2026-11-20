import { ThumbsUp, Trash2 } from 'lucide-react';
import type { AutomationFeedbackTrigger, FeedbackSource, FeedbackVote } from '@nao/shared/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type FeedbackSelectOption<T extends string> = {
	value: string;
	label: string;
	selection: T[];
	requiresChatAccess?: boolean;
};

const VOTE_OPTIONS: FeedbackSelectOption<FeedbackVote>[] = [
	{ value: 'any', label: 'Any vote', selection: ['up', 'down'] },
	{ value: 'up', label: 'Thumbs up', selection: ['up'] },
	{ value: 'down', label: 'Thumbs down', selection: ['down'] },
];

const SOURCE_OPTIONS: FeedbackSelectOption<FeedbackSource>[] = [
	{ value: 'any', label: 'Chats & stories', selection: ['chat', 'story'], requiresChatAccess: true },
	{ value: 'chat', label: 'Chats', selection: ['chat'], requiresChatAccess: true },
	{ value: 'story', label: 'Stories', selection: ['story'] },
];

export function FeedbackTriggerRow({
	trigger,
	canUseChatSource,
	onChange,
	onRemove,
	disabled,
}: {
	trigger: AutomationFeedbackTrigger;
	canUseChatSource: boolean;
	onChange: (trigger: AutomationFeedbackTrigger) => void;
	onRemove: () => void;
	disabled: boolean;
}) {
	return (
		<div className='grid gap-1.5 rounded-lg px-2 py-1.5'>
			<div className='flex items-center justify-between gap-3'>
				<div className='flex min-w-0 items-center gap-2'>
					<ThumbsUp className='size-4 shrink-0 text-muted-foreground' />
					<span className='text-sm font-medium'>On feedback</span>
				</div>
				<div className='flex items-center gap-1'>
					<FeedbackSelect
						ariaLabel='Feedback votes'
						options={VOTE_OPTIONS}
						selection={trigger.votes}
						onChange={(votes) => onChange({ ...trigger, votes })}
						disabled={disabled}
						canUseChatSource={canUseChatSource}
					/>
					<span className='text-sm text-muted-foreground'>on</span>
					<FeedbackSelect
						ariaLabel='Feedback sources'
						options={SOURCE_OPTIONS}
						selection={trigger.sources}
						onChange={(sources) => onChange({ ...trigger, sources })}
						disabled={disabled}
						canUseChatSource={canUseChatSource}
					/>
					<button
						type='button'
						onClick={onRemove}
						disabled={disabled}
						aria-label='Remove feedback trigger'
						className='inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
					>
						<Trash2 className='size-3.5' />
					</button>
				</div>
			</div>
			{!canUseChatSource && (
				<p className='text-xs text-muted-foreground'>
					Only admins and context admins can run automations on chat feedback.
				</p>
			)}
		</div>
	);
}

export function buildDefaultFeedbackTrigger(canUseChatSource: boolean): AutomationFeedbackTrigger {
	return {
		enabled: true,
		votes: ['down'],
		sources: canUseChatSource ? ['chat', 'story'] : ['story'],
	};
}

function FeedbackSelect<T extends string>({
	ariaLabel,
	options,
	selection,
	onChange,
	disabled,
	canUseChatSource,
}: {
	ariaLabel: string;
	options: FeedbackSelectOption<T>[];
	selection: T[];
	onChange: (selection: T[]) => void;
	disabled: boolean;
	canUseChatSource: boolean;
}) {
	const selectedOption = options.find((option) => isSameSelection(option.selection, selection)) ?? options[0];

	function handleValueChange(value: string) {
		const option = options.find((item) => item.value === value);
		if (option) {
			onChange(option.selection);
		}
	}

	return (
		<Select value={selectedOption.value} onValueChange={handleValueChange} disabled={disabled}>
			<SelectTrigger
				variant='ghost'
				size='sm'
				aria-label={ariaLabel}
				className='min-w-0 max-w-40 justify-end px-2 text-right'
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						disabled={option.requiresChatAccess && !canUseChatSource}
					>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function isSameSelection<T extends string>(left: T[], right: T[]): boolean {
	return left.length === right.length && left.every((value) => right.includes(value));
}

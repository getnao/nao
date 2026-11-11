import { useId, useRef, useState } from 'react';
import { CircleAlert, Hash, X } from 'lucide-react';
import {
	getInvalidSlackChannels,
	getSlackChannelError,
	hasSlackChannelSeparator,
	mergeSlackChannels,
	parseSlackChannels,
	SLACK_CHANNEL_EXAMPLE,
	splitSlackChannelDraft,
} from '@nao/shared/slack-channels';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { NakedInput } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type SlackChannelsInputProps = {
	channels: string[];
	saveError: string | null;
	disabled: boolean;
	onChange: (channels: string[]) => void;
};

export function SlackChannelsInput({ channels, saveError, disabled, onChange }: SlackChannelsInputProps) {
	const [draft, setDraft] = useState('');
	const [isDraftAppended, setIsDraftAppended] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const feedbackId = useId();
	const tokens = isDraftAppended && channels.at(-1) === draft.trim() ? channels.slice(0, -1) : channels;
	const feedbackChannels = saveError ? channels : tokens;
	const invalidChannels = getInvalidSlackChannels(feedbackChannels);

	/** A new draft channel is appended to `channels` so a save shortcut pressed mid-typing keeps it. */
	function update(nextTokens: string[], nextDraft: string) {
		const draftChannel = nextDraft.trim();
		const appendsDraft = draftChannel !== '' && !nextTokens.includes(draftChannel);
		setDraft(nextDraft);
		setIsDraftAppended(appendsDraft);
		onChange(appendsDraft ? [...nextTokens, draftChannel] : nextTokens);
	}

	function commitDraft() {
		setDraft('');
		setIsDraftAppended(false);
	}

	function handleDraftChange(text: string) {
		const { channels: completedChannels, remainder } = splitSlackChannelDraft(text);
		update(mergeSlackChannels(tokens, completedChannels), remainder);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Enter' && draft.trim()) {
			event.preventDefault();
			commitDraft();
			return;
		}
		if (event.key === 'Backspace' && draft === '' && tokens.length > 0) {
			event.preventDefault();
			update(tokens.slice(0, -1), '');
		}
	}

	function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
		const pasted = event.clipboardData.getData('text');
		if (!hasSlackChannelSeparator(pasted)) {
			return;
		}
		event.preventDefault();
		update(mergeSlackChannels(tokens, parseSlackChannels(`${draft},${pasted}`)), '');
	}

	function removeChannel(channel: string) {
		update(
			tokens.filter((item) => item !== channel),
			draft,
		);
	}

	function editChannel(channel: string) {
		const remainingTokens = tokens.filter((item) => item !== channel);
		update(mergeSlackChannels(remainingTokens, parseSlackChannels(draft)), channel);
		requestAnimationFrame(() => inputRef.current?.focus());
	}

	return (
		<div className='grid gap-1.5'>
			<div
				onClick={() => inputRef.current?.focus()}
				aria-invalid={Boolean(saveError)}
				className={cn(
					'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs transition-[color,box-shadow]',
					'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
					saveError && 'border-destructive ring-1 ring-destructive/20',
					disabled && 'pointer-events-none opacity-50',
				)}
			>
				{tokens.map((channel) => (
					<SlackChannelToken
						key={channel}
						channel={channel}
						error={getSlackChannelError(channel)}
						disabled={disabled}
						onEdit={() => editChannel(channel)}
						onRemove={() => removeChannel(channel)}
					/>
				))}
				<NakedInput
					ref={inputRef}
					value={draft}
					disabled={disabled}
					aria-label='Slack channels'
					aria-describedby={feedbackId}
					placeholder={tokens.length === 0 ? `Add channels, comma separated: ${SLACK_CHANNEL_EXAMPLE}` : ''}
					className='h-6 min-w-32 flex-1 px-1 text-sm placeholder:text-muted-foreground'
					onChange={(event) => handleDraftChange(event.target.value)}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					onBlur={commitDraft}
				/>
			</div>
			<SlackChannelsFeedback
				id={feedbackId}
				channels={feedbackChannels}
				invalidChannels={invalidChannels}
				saveError={saveError}
			/>
		</div>
	);
}

function SlackChannelToken({
	channel,
	error,
	disabled,
	onEdit,
	onRemove,
}: {
	channel: string;
	error: string | null;
	disabled: boolean;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const token = (
		<span
			className={cn(
				'inline-flex h-6 max-w-full items-center gap-1 rounded-md border pl-1.5 pr-0.5 text-xs',
				error
					? 'border-destructive/40 bg-destructive/10 text-destructive'
					: 'border-border bg-muted/60 text-foreground',
			)}
		>
			{error ? (
				<CircleAlert className='size-3 shrink-0' />
			) : (
				!channel.startsWith('#') && <Hash className='size-3 shrink-0 text-muted-foreground' />
			)}
			<button
				type='button'
				onClick={(event) => {
					event.stopPropagation();
					onEdit();
				}}
				disabled={disabled}
				aria-label={`Edit Slack channel ${channel}`}
				className='truncate font-mono'
			>
				{channel}
			</button>
			<button
				type='button'
				onClick={(event) => {
					event.stopPropagation();
					onRemove();
				}}
				disabled={disabled}
				aria-label={`Remove Slack channel ${channel}`}
				className='inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-70 transition-opacity hover:bg-background/60 hover:opacity-100'
			>
				<X className='size-3' />
			</button>
		</span>
	);

	if (!error) {
		return token;
	}

	return (
		<Tooltip delayDuration={150}>
			<TooltipTrigger asChild>{token}</TooltipTrigger>
			<TooltipContent>{error} Click to edit.</TooltipContent>
		</Tooltip>
	);
}

function SlackChannelsFeedback({
	id,
	channels,
	invalidChannels,
	saveError,
}: {
	id: string;
	channels: string[];
	invalidChannels: string[];
	saveError: string | null;
}) {
	const validCount = channels.length - invalidChannels.length;

	return (
		<div id={id} className='grid gap-1 text-xs'>
			{invalidChannels.length > 0 && (
				<ul className='grid gap-0.5 text-destructive'>
					{invalidChannels.map((channel) => (
						<li key={channel} className='flex items-start gap-1.5'>
							<CircleAlert className='mt-0.5 size-3 shrink-0' />
							<span>
								<span className='font-mono'>{channel}</span>: {getSlackChannelError(channel)}
							</span>
						</li>
					))}
				</ul>
			)}
			{saveError && <p className='font-medium text-destructive'>{saveError}</p>}
			<p className='text-muted-foreground'>{getDeliverySummary(validCount, invalidChannels.length)}</p>
		</div>
	);
}

function getDeliverySummary(validCount: number, invalidCount: number): string {
	if (validCount === 0 && invalidCount === 0) {
		return 'Separate several channels with commas. The message is posted to each one.';
	}
	const channelNoun = validCount === 1 ? 'channel' : 'channels';
	if (invalidCount === 0) {
		return `Each run posts to ${validCount} ${channelNoun}.`;
	}
	return `${validCount} valid ${channelNoun}. Click a red entry to edit it.`;
}

import { useState } from 'react';
import { ArrowUpRight, UserRound } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import type { StoryVersionChange, StoryVersionVia } from '@nao/shared/types';

import { RotateCwFadingClock } from '@/components/icons/rotate-cw-fading-clock';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOpenStoryChat } from '@/hooks/use-open-story-chat';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

export interface StoryVersionEntry {
	createdAt: string | Date;
	change?: StoryVersionChange | null;
}

export interface StoryVersionNavProps {
	storyId?: string | null;
	currentVersion: number;
	versions: StoryVersionEntry[];
	onSelectVersion: (version: number) => void;
	/** Opens a quick question beside the story; without it, quick questions open on their own page like other chats. */
	onOpenQuickQuestion?: (chatId: string) => void;
}

type NumberedVersion = StoryVersionEntry & { version: number };

const VERSION_DATE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
};

const VERSION_TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

const VERSION_DAY_FORMAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

const VERSION_LABEL_CLASS_NAME = 'h-6 shrink-0 gap-1 rounded-full px-2 text-xs font-normal tabular-nums';

const VIA_LABELS: Record<StoryVersionVia, string> = {
	original_chat: 'Original chat',
	quick_question: 'Quick question',
	chat: 'Another chat',
	agent: 'nao agent',
	editor: 'Manual edit',
	mcp: 'MCP',
	copy: 'Copied',
};

export function StoryVersionNav({
	storyId,
	currentVersion,
	versions,
	onSelectVersion,
	onOpenQuickQuestion,
}: StoryVersionNavProps) {
	const [isOpen, setIsOpen] = useState(false);
	const currentVersionDate = versions[currentVersion - 1]?.createdAt;

	if (versions.length <= 1) {
		return currentVersionDate ? (
			<span
				className={cn(
					'inline-flex items-center whitespace-nowrap text-muted-foreground',
					VERSION_LABEL_CLASS_NAME,
				)}
				title={formatVersionDate(currentVersionDate)}
			>
				{formatCompactVersionDate(currentVersionDate)}
			</span>
		) : null;
	}

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost-muted'
					size='sm'
					className={cn('text-foreground', VERSION_LABEL_CLASS_NAME)}
					aria-label='Version history'
					title={currentVersionDate ? formatVersionDate(currentVersionDate) : undefined}
				>
					<RotateCwFadingClock className='size-3.5' strokeWidth={2.25} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='center' className='max-h-96 w-80 overflow-y-auto'>
				<VersionHistory
					storyId={storyId}
					currentVersion={currentVersion}
					versions={versions}
					onSelectVersion={onSelectVersion}
					onOpenQuickQuestion={onOpenQuickQuestion}
					onClose={() => setIsOpen(false)}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function describeViewedVersion(versionDate: string | Date | null | undefined, currentVersion: number): string {
	return versionDate
		? `Viewing the version from ${formatVersionDate(versionDate)}`
		: `Viewing version ${currentVersion}`;
}

function VersionHistory({
	storyId,
	currentVersion,
	versions,
	onSelectVersion,
	onOpenQuickQuestion,
	onClose,
}: StoryVersionNavProps & { onClose: () => void }) {
	const { data: session } = useSession();
	const { openChat } = useOpenStoryChat(storyId ?? null);
	const days = groupByDay(versions.map((entry, index) => ({ ...entry, version: index + 1 })).reverse());

	return (
		<DropdownMenuRadioGroup
			value={String(currentVersion)}
			onValueChange={(value) => onSelectVersion(Number(value))}
		>
			{days.map((day, index) => (
				<DropdownMenuGroup key={day.label}>
					<DropdownMenuLabel
						className={cn('pb-0.5 text-[11px] uppercase tracking-wide', index > 0 && 'pt-2.5')}
					>
						{day.label}
					</DropdownMenuLabel>
					{day.versions.map((entry) => (
						<VersionItem
							key={entry.version}
							entry={entry}
							viewerId={session?.user.id}
							onOpenChat={(chatId) => {
								onClose();
								if (onOpenQuickQuestion && entry.change?.via === 'quick_question') {
									onOpenQuickQuestion(chatId);
									return;
								}
								void openChat(chatId);
							}}
						/>
					))}
				</DropdownMenuGroup>
			))}
		</DropdownMenuRadioGroup>
	);
}

function VersionItem({
	entry,
	viewerId,
	onOpenChat,
}: {
	entry: NumberedVersion;
	viewerId: string | undefined;
	onOpenChat: (chatId: string) => void;
}) {
	const { change } = entry;
	const chat = change?.chat ?? null;

	return (
		<DropdownMenuRadioItem
			value={String(entry.version)}
			indicator='check'
			onSelect={(event) => event.preventDefault()}
			className={cn(
				'group gap-2 py-1.5 pr-8 text-xs',
				chat && 'data-[highlighted]:[&>span:first-child]:invisible',
			)}
		>
			<VersionAuthorAvatar author={change?.author ?? null} />
			<VersionDescription change={change ?? null} viewerId={viewerId} />
			<span className='relative shrink-0 tabular-nums text-muted-foreground'>
				<span className={cn(chat && 'group-data-[highlighted]:invisible')}>
					{formatVersionTime(entry.createdAt)}
				</span>
				{chat && <OpenChatButton onOpen={() => onOpenChat(chat.id)} />}
			</span>
		</DropdownMenuRadioItem>
	);
}

/** Versions saved before their author was recorded only say how they were made. */
function VersionDescription({ change, viewerId }: { change: StoryVersionChange | null; viewerId: string | undefined }) {
	if (!change?.author) {
		return <span className='min-w-0 flex-1 truncate font-medium'>{describeVia(change)}</span>;
	}
	return (
		<span className='flex min-w-0 flex-1 items-center gap-1.5'>
			<span className='shrink-0 font-medium'>{describeAuthor(change.author, viewerId)}</span>
			<span className='truncate text-muted-foreground'>{describeVia(change)}</span>
		</span>
	);
}

function OpenChatButton({ onOpen }: { onOpen: () => void }) {
	const keepFromRow = (event: SyntheticEvent) => event.stopPropagation();
	return (
		<button
			type='button'
			className='absolute -inset-y-0.5 -right-6.5 -left-1 hidden items-center justify-between rounded-md pr-0.5 pl-1 text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-xs group-data-[highlighted]:flex'
			onPointerDown={keepFromRow}
			onPointerUp={keepFromRow}
			onClick={(event) => {
				event.stopPropagation();
				onOpen();
			}}
		>
			<span>Open chat</span>
			<ArrowUpRight className='size-3.5 text-current' />
		</button>
	);
}

function VersionAuthorAvatar({ author }: { author: StoryVersionChange['author'] }) {
	if (!author) {
		return (
			<span className='flex size-4 shrink-0 items-center justify-center rounded-full bg-muted'>
				<UserRound className='size-2.5' />
			</span>
		);
	}
	return <Avatar username={author.name} size='sm' className='size-4 shrink-0 text-[8px]' />;
}

function describeAuthor(author: { id: string; name: string }, viewerId: string | undefined): string {
	return author.id === viewerId ? 'You' : author.name;
}

function describeVia(change: StoryVersionChange | null): string {
	const label = VIA_LABELS[change?.via ?? 'agent'];
	return change?.chat?.title || label;
}

function groupByDay(versions: NumberedVersion[]): { label: string; versions: NumberedVersion[] }[] {
	const days: { label: string; versions: NumberedVersion[] }[] = [];
	for (const entry of versions) {
		const label = formatVersionDay(entry.createdAt);
		const day = days.at(-1);
		if (day?.label === label) {
			day.versions.push(entry);
		} else {
			days.push({ label, versions: [entry] });
		}
	}
	return days;
}

function formatVersionDay(date: string | Date): string {
	const versionDate = new Date(date);
	const today = new Date();
	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
	if (versionDate.toDateString() === today.toDateString()) {
		return 'Today';
	}
	if (versionDate.toDateString() === yesterday.toDateString()) {
		return 'Yesterday';
	}
	const isThisYear = versionDate.getFullYear() === today.getFullYear();
	return versionDate.toLocaleDateString(undefined, {
		...VERSION_DAY_FORMAT,
		...(!isThisYear && { year: 'numeric' }),
	});
}

function formatVersionTime(date: string | Date): string {
	return new Date(date).toLocaleTimeString(undefined, VERSION_TIME_FORMAT);
}

function formatVersionDate(date: string | Date): string {
	return new Date(date).toLocaleString(undefined, VERSION_DATE_FORMAT);
}

function formatCompactVersionDate(date: string | Date): string {
	const versionDate = new Date(date);
	const isToday = versionDate.toDateString() === new Date().toDateString();
	return versionDate.toLocaleString(undefined, isToday ? VERSION_TIME_FORMAT : VERSION_DAY_FORMAT);
}

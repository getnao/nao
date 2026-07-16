import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessageSquareIcon, MessageSquarePlusIcon, MoonIcon, SunIcon, UserIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@/components/ui/command';
import { useTheme } from '@/contexts/theme.provider';
import { useRegisterCommandMenuCallback } from '@/contexts/command-menu-callback';
import { useSearchChatsQuery } from '@/queries/use-search-chats-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePermissions } from '@/hooks/use-permissions';
import { TextShimmer } from '@/components/ui/text-shimmer';

type CommandConfig = {
	id: string;
	label: string;
	keywords?: string[];
	icon: LucideIcon;
	action: () => void;
	shortcut?: string;
	group: string;
	visible?: boolean;
};

export function CommandMenu() {
	const [open, setOpen] = useState(false);
	const [searchValue, setSearchValue] = useState('');
	const debouncedSearch = useDebouncedValue(searchValue, 300);
	const navigate = useNavigate();
	const { theme, setTheme } = useTheme();
	const { canStartNewChat } = usePermissions();

	const toggleOpen = useCallback(() => setOpen((prev) => !prev), []);
	useRegisterCommandMenuCallback(toggleOpen, [toggleOpen]);

	const { data: searchResults, isFetching: isSearching } = useSearchChatsQuery(debouncedSearch, {
		enabled: open && debouncedSearch.length >= 2,
	});

	const isSearchMode = searchValue.length >= 2;
	const hasSearchResults = isSearchMode && searchResults && searchResults.length > 0;
	const isPendingSearch = isSearchMode && (searchValue !== debouncedSearch || isSearching);

	const commands: CommandConfig[] = useMemo(
		() => [
			{
				id: 'new-chat',
				label: 'New Chat',
				keywords: ['start chat', 'new conversation'],
				icon: MessageSquarePlusIcon,
				action: () => navigate({ to: '/' }),
				shortcut: '⇧⌘O',
				group: 'Jump to',
				visible: canStartNewChat,
			},
			{
				id: 'open-settings',
				label: 'Open Account Settings',
				keywords: ['account', 'settings', 'preferences'],
				icon: UserIcon,
				action: () => navigate({ to: '/settings/account' }),
				group: 'Jump to',
			},
			{
				id: 'switch-mode',
				label: `Switch ${theme === 'light' ? 'Dark' : 'Light'} Mode`,
				keywords: ['switch light mode', 'switch dark mode', 'light mode', 'dark mode', 'theme', 'appearance'],
				icon: theme === 'light' ? MoonIcon : SunIcon,
				action: () => {
					setTheme(theme === 'light' ? 'dark' : 'light');
				},
				group: 'Actions',
			},
		],
		[navigate, theme, setTheme, canStartNewChat],
	);

	const visibleCommands = useMemo(() => commands.filter((cmd) => cmd.visible ?? true), [commands]);
	const filteredCommands = useMemo(
		() => visibleCommands.filter((cmd) => matchesCommand(cmd, searchValue)),
		[visibleCommands, searchValue],
	);
	const displayedCommands = isSearchMode ? filteredCommands : visibleCommands;
	const jumpToCommands = displayedCommands.filter((cmd) => cmd.group === 'Jump to');
	const actionCommands = displayedCommands.filter((cmd) => cmd.group === 'Actions');

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	const handleOpenChange = useCallback((isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setSearchValue('');
		}
	}, []);

	const runCommand = useCallback((command: () => void) => {
		setOpen(false);
		setSearchValue('');
		command();
	}, []);

	const openChat = useCallback(
		(chatId: string) => {
			navigate({ to: '/$chatId', params: { chatId } });
		},
		[navigate],
	);

	const showNoResults =
		!hasSearchResults &&
		actionCommands.length === 0 &&
		jumpToCommands.length === 0 &&
		!isPendingSearch &&
		isSearchMode;

	return (
		<CommandDialog open={open} onOpenChange={handleOpenChange} shouldFilter={false} loop>
			<CommandInput
				placeholder='Type a command or search conversations...'
				value={searchValue}
				onValueChange={setSearchValue}
			/>
			<CommandList>
				{showNoResults && <CommandEmpty>No results found.</CommandEmpty>}

				{jumpToCommands.length > 0 && (
					<CommandGroup heading='Jump to'>
						{jumpToCommands.map((command) => (
							<CommandItem
								key={command.id}
								value={command.id}
								onSelect={() => runCommand(command.action)}
							>
								<command.icon />
								<span>{command.label}</span>
								{command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}

				{hasSearchResults ? (
					<CommandGroup heading='Search results'>
						{searchResults.map((chat) => (
							<CommandItem
								key={chat.id}
								value={`search-${chat.id}`}
								onSelect={() => runCommand(() => openChat(chat.id))}
							>
								<MessageSquareIcon />
								<div className='flex flex-col gap-0.5 overflow-hidden'>
									<span className='truncate'>{highlightMatch(chat.title, debouncedSearch)}</span>
									{chat.matchedText && (
										<span className='text-muted-foreground truncate text-xs'>
											...
											{highlightMatch(
												truncateMatchedText(chat.matchedText, debouncedSearch),
												debouncedSearch,
											)}
											...
										</span>
									)}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				) : isPendingSearch ? (
					<div className='px-4 py-3'>
						<TextShimmer text='Searching deeper...' />
					</div>
				) : null}

				{actionCommands.length > 0 && (
					<CommandGroup heading='Actions'>
						{actionCommands.map((command) => (
							<CommandItem
								key={command.id}
								value={command.id}
								onSelect={() => runCommand(command.action)}
							>
								<command.icon />
								<span>{command.label}</span>
								{command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	);
}

function matchesCommand(command: CommandConfig, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return true;
	}
	const searchableText = [command.label, command.id, ...(command.keywords ?? [])].join(' ').toLowerCase();
	return searchableText.includes(normalizedQuery);
}

function highlightMatch(text: string, query: string) {
	if (!query) {
		return text;
	}

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const index = lowerText.indexOf(lowerQuery);

	if (index === -1) {
		return text;
	}

	const before = text.slice(0, index);
	const match = text.slice(index, index + query.length);
	const after = text.slice(index + query.length);

	return (
		<>
			{before}
			<span className='font-semibold text-foreground'>{match}</span>
			{after}
		</>
	);
}

function truncateMatchedText(text: string, query: string, contextLength = 30): string {
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const index = lowerText.indexOf(lowerQuery);

	if (index === -1) {
		return text.slice(0, contextLength * 2);
	}

	const start = Math.max(0, index - contextLength);
	const end = Math.min(text.length, index + query.length + contextLength);

	return text.slice(start, end);
}

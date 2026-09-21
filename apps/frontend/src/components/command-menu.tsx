import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
	BookOpenIcon,
	KeyboardIcon,
	MessageSquareIcon,
	MessageSquarePlusIcon,
	MoonIcon,
	SettingsIcon,
	SunIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { SettingsSearchEntry } from '@/components/settings-search-index';

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
import { useSettingsSearch, useSettingsSuggestions } from '@/hooks/use-settings-search';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { invalidateStoriesCaches } from '@/lib/stories-cache';

type CommandConfig = {
	id: string;
	label: string;
	keywords?: string[];
	icon: LucideIcon;
	action: () => void;
	shortcut?: string;
	group: string;
	visible?: boolean;
	keepOpen?: boolean;
};

export function CommandMenu({ onOpenKeyboardShortcuts }: { onOpenKeyboardShortcuts: () => void }) {
	const [open, setOpen] = useState(false);
	const [searchValue, setSearchValue] = useState('');
	const debouncedSearch = useDebouncedValue(searchValue, 300);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { theme, setTheme } = useTheme();
	const { canStartNewChat } = usePermissions();
	const isSettingsMode = searchValue.startsWith('/');
	const settingsQuery = searchValue.slice(1);
	const settingsResults = useSettingsSearch(isSettingsMode ? settingsQuery : '');
	const settingsSuggestions = useSettingsSuggestions();
	const showSettingsSuggestions = isSettingsMode && settingsQuery.length < 2;
	const displayedSettingsEntries = showSettingsSuggestions ? settingsSuggestions : settingsResults;

	const toggleOpen = useCallback(() => setOpen((prev) => !prev), []);
	useRegisterCommandMenuCallback(toggleOpen, [toggleOpen]);

	const { data: searchResults, isFetching: isSearching } = useSearchChatsQuery(debouncedSearch, {
		enabled: open && !isSettingsMode && !debouncedSearch.startsWith('/') && debouncedSearch.length >= 2,
	});

	const isSearchMode = !isSettingsMode && searchValue.length >= 2;
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
				shortcut: getShortcutLabel('new-chat'),
				group: 'Jump to',
				visible: canStartNewChat,
			},
			{
				id: 'go-to-stories',
				label: 'Go to Stories',
				keywords: ['stories'],
				icon: BookOpenIcon,
				action: () => {
					invalidateStoriesCaches(queryClient);
					navigate({ to: '/stories', search: { folderId: null } });
				},
				shortcut: getShortcutLabel('go-to-stories'),
				group: 'Jump to',
			},
			{
				id: 'search-settings',
				label: 'Search settings',
				keywords: ['settings', 'preferences'],
				icon: SettingsIcon,
				action: () => setSearchValue('/'),
				shortcut: '/',
				group: 'Actions',
				visible: searchValue.length === 0,
				keepOpen: true,
			},
			{
				id: 'keyboard-help',
				label: 'Keyboard shortcuts',
				keywords: ['hotkeys', 'key bindings'],
				icon: KeyboardIcon,
				action: onOpenKeyboardShortcuts,
				shortcut: getShortcutLabel('keyboard-help'),
				group: 'Actions',
			},
			{
				id: 'switch-mode',
				label: `Switch ${theme === 'light' ? 'Dark' : 'Light'} Mode`,
				keywords: ['switch light mode', 'switch dark mode', 'light mode', 'dark mode', 'theme', 'appearance'],
				icon: theme === 'light' ? MoonIcon : SunIcon,
				action: () => {
					setTheme(theme === 'light' ? 'dark' : 'light');
				},
				shortcut: getShortcutLabel('toggle-theme'),
				group: 'Actions',
			},
		],
		[navigate, queryClient, theme, setTheme, canStartNewChat, onOpenKeyboardShortcuts, searchValue],
	);

	const visibleCommands = useMemo(() => commands.filter((cmd) => cmd.visible ?? true), [commands]);
	const filteredCommands = useMemo(() => {
		if (isSettingsMode) {
			return [];
		}

		return visibleCommands.filter((cmd) => matchesCommand(cmd, searchValue));
	}, [isSettingsMode, searchValue, visibleCommands]);
	const displayedCommands = isSettingsMode ? [] : isSearchMode ? filteredCommands : visibleCommands;
	const jumpToCommands = displayedCommands.filter((cmd) => cmd.group === 'Jump to');
	const actionCommands = displayedCommands.filter((cmd) => cmd.group === 'Actions');

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
	const showNoSettingsResults = isSettingsMode && settingsQuery.length >= 2 && settingsResults.length === 0;

	return (
		<CommandDialog open={open} onOpenChange={handleOpenChange} shouldFilter={false} loop>
			<CommandInput
				placeholder={isSettingsMode ? 'Search settings...' : 'Type a command or search conversations...'}
				value={searchValue}
				onValueChange={setSearchValue}
			/>
			<CommandList>
				{showNoResults && <CommandEmpty>No results found.</CommandEmpty>}
				{showNoSettingsResults && <CommandEmpty>No results found.</CommandEmpty>}

				{isSettingsMode && displayedSettingsEntries.length > 0 && (
					<CommandGroup heading='Settings'>
						{displayedSettingsEntries.map((entry) => (
							<SettingsCommandItem
								key={`${entry.page}-${entry.section ?? ''}`}
								entry={entry}
								isSuggestion={showSettingsSuggestions}
								onSelect={() =>
									runCommand(() =>
										navigate({
											to: entry.page,
											search: entry.search,
										}),
									)
								}
							/>
						))}
					</CommandGroup>
				)}

				{!isSettingsMode && jumpToCommands.length > 0 && (
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

				{!isSettingsMode && actionCommands.length > 0 && (
					<CommandGroup heading='Actions'>
						{actionCommands.map((command) => (
							<CommandItem
								key={command.id}
								value={command.id}
								onSelect={() => (command.keepOpen ? command.action() : runCommand(command.action))}
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

function SettingsCommandItem({
	entry,
	isSuggestion,
	onSelect,
}: {
	entry: SettingsSearchEntry;
	isSuggestion: boolean;
	onSelect: () => void;
}) {
	return (
		<CommandItem value={`settings-${entry.page}-${entry.section ?? ''}`} onSelect={onSelect}>
			<SettingsIcon />
			<div className='flex flex-col gap-0.5 overflow-hidden'>
				<span className='truncate'>{isSuggestion ? entry.pageLabel : entry.title}</span>
				{!isSuggestion && (
					<span className='text-muted-foreground truncate text-xs'>
						{entry.pageLabel}
						{entry.section ? ` · ${entry.section}` : ''}
					</span>
				)}
			</div>
		</CommandItem>
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

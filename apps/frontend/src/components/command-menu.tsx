import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
	CodeIcon,
	CreditCardIcon,
	MessageSquareIcon,
	MessageSquarePlusIcon,
	MoonIcon,
	SettingsIcon,
	SunIcon,
	UserIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
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
import { trpc } from '@/main';
import { useSearchChatsQuery } from '@/queries/use-search-chats-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { TextShimmer } from '@/components/ui/text-shimmer';

type CommandConfig = {
	id: string;
	label: string;
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
	const project = useQuery(trpc.project.getCurrent.queryOptions());

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
				icon: MessageSquarePlusIcon,
				action: () => navigate({ to: '/' }),
				shortcut: '⇧⌘O',
				group: 'Jump to',
			},
			{
				id: 'open-settings',
				label: 'Open General Settings',
				icon: UserIcon,
				action: () => navigate({ to: '/settings/general' }),
				group: 'Actions',
			},
			{
				id: 'open-project-settings',
				label: 'Open Project Settings',
				icon: SettingsIcon,
				action: () => navigate({ to: '/settings/project' }),
				group: 'Actions',
			},
			{
				id: 'open-llm-provider-settings',
				label: 'Open LLM Provider Settings',
				icon: CodeIcon,
				action: () => navigate({ to: '/settings/project/models' }),
				group: 'Jump to',
				visible: project.data?.userRole === 'admin',
			},
			{
				id: 'open-usage',
				label: 'Usage & Costs',
				icon: CreditCardIcon,
				action: () => navigate({ to: '/settings/usage' }),
				group: 'Actions',
				visible: project.data?.userRole === 'admin',
			},
			{
				id: 'switch-mode',
				label: `Switch ${theme === 'light' ? 'Dark' : 'Light'} Mode`,
				icon: theme === 'light' ? MoonIcon : SunIcon,
				action: () => {
					setTheme(theme === 'light' ? 'dark' : 'light');
				},
				group: 'Actions',
			},
		],
		[navigate, theme, setTheme, project.data?.userRole],
	);

	const jumpToCommands = useMemo(() => commands.filter((cmd) => cmd.group === 'Jump to'), [commands]);
	const actionCommands = useMemo(() => commands.filter((cmd) => cmd.group === 'Actions'), [commands]);

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

	const visibleActions = actionCommands.filter((cmd) => cmd.visible ?? true);
	const showNoResults = !hasSearchResults && !isPendingSearch && isSearchMode;

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
								<span>
									{command.label}
									{isSearchMode && (
										<span className='text-muted-foreground'> &ldquo;{searchValue}&rdquo;</span>
									)}
								</span>
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

				{!isSearchMode && visibleActions.length > 0 && (
					<CommandGroup heading='Actions'>
						{visibleActions.map((command) => (
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

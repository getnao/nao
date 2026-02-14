import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
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
import { trpc } from '@/main';
import { useSearchChatsQuery } from '@/queries/use-search-chats-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

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

	const { data: searchResults, isFetching: isSearching } = useSearchChatsQuery(debouncedSearch, {
		enabled: open && debouncedSearch.length >= 2,
	});

	const isSearchMode = searchValue.length >= 2;
	const hasConversationResults = isSearchMode && searchResults && searchResults.length > 0;
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
				label: 'Open Profile',
				icon: UserIcon,
				action: () => navigate({ to: '/settings/profile' }),
				group: 'Jump to',
			},
			{
				id: 'open-project-settings',
				label: 'Open Project Settings',
				icon: SettingsIcon,
				action: () => navigate({ to: '/settings/project' }),
				group: 'Jump to',
			},
			{
				id: 'open-project-settings',
				label: 'Usage & Costs',
				icon: CreditCardIcon,
				action: () => navigate({ to: '/settings/usage' }),
				group: 'Jump to',
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

	const filteredCommands = useMemo(() => {
		if (!searchValue) {
			return commands;
		}
		const lowerSearch = searchValue.toLowerCase();
		return commands.filter((cmd) => cmd.label.toLowerCase().includes(lowerSearch));
	}, [commands, searchValue]);

	const groupedCommands = useMemo(() => {
		const groups = new Map<string, CommandConfig[]>();
		for (const command of filteredCommands) {
			const group = groups.get(command.group) ?? [];
			group.push(command);
			groups.set(command.group, group);
		}
		return groups;
	}, [filteredCommands]);

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

	return (
		<CommandDialog open={open} onOpenChange={handleOpenChange} shouldFilter={false} loop>
			<CommandInput
				placeholder='Type a command or search conversations...'
				value={searchValue}
				onValueChange={setSearchValue}
			/>
			<CommandList>
				{filteredCommands.length === 0 && !hasConversationResults && !isPendingSearch && (
					<CommandEmpty>No results found.</CommandEmpty>
				)}
				{isPendingSearch && !hasConversationResults && (
					<div className='py-6 text-center text-sm text-muted-foreground'>Searching...</div>
				)}
				{Array.from(groupedCommands.entries()).map(([group, items]) => (
					<CommandGroup key={group} heading={group}>
						{items
							.filter((command) => command.visible ?? true)
							.map((command) => (
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
				))}
				{hasConversationResults && (
					<CommandGroup heading='Conversations'>
						{searchResults.map((chat) => (
							<CommandItem
								key={chat.id}
								value={`conversation-${chat.id}`}
								onSelect={() => runCommand(() => openChat(chat.id))}
							>
								<MessageSquareIcon />
								<div className='flex flex-col gap-0.5 overflow-hidden'>
									<span className='truncate'>{chat.title}</span>
									{chat.matchedText && (
										<span className='text-muted-foreground truncate text-xs'>
											...{truncateMatchedText(chat.matchedText, debouncedSearch)}...
										</span>
									)}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
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

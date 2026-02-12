import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CreditCardIcon, MessageSquarePlusIcon, MoonIcon, SettingsIcon, SunIcon, UserIcon } from 'lucide-react';
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
	const navigate = useNavigate();
	const { theme, setTheme } = useTheme();
	const project = useQuery(trpc.project.getCurrent.queryOptions());

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

	const groupedCommands = useMemo(() => {
		const groups = new Map<string, CommandConfig[]>();
		for (const command of commands) {
			const group = groups.get(command.group) ?? [];
			group.push(command);
			groups.set(command.group, group);
		}
		return groups;
	}, [commands]);

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

	const runCommand = useCallback((command: () => void) => {
		setOpen(false);
		command();
	}, []);

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder='Type a command or search...' />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>
				{Array.from(groupedCommands.entries()).map(([group, items]) => (
					<CommandGroup key={group} heading={group}>
						{items
							.filter((command) => command.visible ?? true)
							.map((command) => (
								<CommandItem key={command.id} onSelect={() => runCommand(command.action)}>
									<command.icon />
									<span>{command.label}</span>
									{command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
								</CommandItem>
							))}
					</CommandGroup>
				))}
			</CommandList>
		</CommandDialog>
	);
}

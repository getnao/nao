import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BotIcon, ExternalLink, InboxIcon, LayoutGrid, PlusIcon, SearchIcon } from 'lucide-react';
import { getMenuEntryLabel } from '@nao/shared/sidebar-menu';
import type { BuiltInMenuEntry, BuiltInMenuEntryId, CustomMenuEntry, SidebarMenuEntry } from '@nao/shared/sidebar-menu';
import type { LucideIcon } from 'lucide-react';

import { LucideIconByName } from '@/components/lucide-icon-by-name';
import { NewChatDropTarget } from '@/components/new-chat-drop-target';
import { Button } from '@/components/ui/button';
import StoryIcon from '@/components/ui/story-icon';
import { useCommandMenuCallback } from '@/contexts/command-menu-callback';
import { useSidebar } from '@/contexts/sidebar';
import { useSidebarMenu } from '@/hooks/use-sidebar-menu';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { invalidateStoriesCaches } from '@/lib/stories-cache';
import { cn, hideIf } from '@/lib/utils';

export const STORY_MENU_ICON = StoryIcon as unknown as LucideIcon;

export const BUILT_IN_MENU_ICONS: Record<BuiltInMenuEntryId, LucideIcon> = {
	'new-chat': PlusIcon,
	'search-chats': SearchIcon,
	stories: STORY_MENU_ICON,
	inbox: InboxIcon,
	automations: BotIcon,
};

export const CUSTOM_MENU_ICONS: Record<CustomMenuEntry['type'], LucideIcon> = {
	story: STORY_MENU_ICON,
	'stories-page': LayoutGrid,
	link: ExternalLink,
};

const BUILT_IN_MENU_SHORTCUTS: Partial<Record<BuiltInMenuEntryId, Parameters<typeof getShortcutLabel>[0]>> = {
	'new-chat': 'new-chat',
	'search-chats': 'command-menu',
	stories: 'go-to-stories',
};

export interface SidebarMenuAccess {
	canCreateChat: boolean;
	canSeeAutomations: boolean;
	hasInboxActivity: boolean;
}

export function SidebarMenuNav({
	isCollapsed,
	hasProject,
	access,
}: {
	isCollapsed: boolean;
	hasProject: boolean;
	access: SidebarMenuAccess;
}) {
	const { entries } = useSidebarMenu(hasProject);
	const openEntry = useOpenMenuEntry();

	return <SidebarMenuList entries={entries} access={access} isCollapsed={isCollapsed} onOpenEntry={openEntry} />;
}

/** Without `onOpenEntry` the menu is an inert preview, as shown in the menu settings. */
export function SidebarMenuList({
	entries,
	access,
	isCollapsed,
	onOpenEntry,
}: {
	entries: SidebarMenuEntry[];
	access: SidebarMenuAccess;
	isCollapsed: boolean;
	onOpenEntry?: (entry: SidebarMenuEntry) => void;
}) {
	return (
		<div className='py-4'>
			{entries.map((entry) =>
				entry.type === 'built-in' ? (
					<BuiltInMenuButton
						key={entry.id}
						entry={entry}
						access={access}
						isCollapsed={isCollapsed}
						isPreview={!onOpenEntry}
						onClick={() => onOpenEntry?.(entry)}
					/>
				) : (
					<SidebarMenuButton
						key={entry.id}
						icon={CUSTOM_MENU_ICONS[entry.type]}
						iconName={entry.icon}
						label={entry.label}
						shortcut=''
						isCollapsed={isCollapsed}
						onClick={() => onOpenEntry?.(entry)}
					/>
				),
			)}
		</div>
	);
}

function BuiltInMenuButton({
	entry,
	access,
	isCollapsed,
	isPreview,
	onClick,
}: {
	entry: BuiltInMenuEntry;
	access: SidebarMenuAccess;
	isCollapsed: boolean;
	isPreview: boolean;
	onClick: () => void;
}) {
	if (entry.hidden || !canSeeBuiltInEntry(entry.id, access)) {
		return null;
	}

	const shortcut = BUILT_IN_MENU_SHORTCUTS[entry.id];
	const button = (
		<SidebarMenuButton
			icon={BUILT_IN_MENU_ICONS[entry.id]}
			iconName={entry.icon}
			label={getMenuEntryLabel(entry)}
			shortcut={shortcut ? getShortcutLabel(shortcut) : ''}
			isCollapsed={isCollapsed}
			onClick={onClick}
			indicator={entry.id === 'inbox' && access.hasInboxActivity}
		/>
	);

	return entry.id === 'new-chat' && !isPreview ? <NewChatDropTarget>{button}</NewChatDropTarget> : button;
}

function SidebarMenuButton({
	icon,
	iconName = null,
	label,
	shortcut,
	isCollapsed,
	onClick,
	indicator = false,
}: {
	icon: LucideIcon;
	iconName?: string | null;
	label: string;
	shortcut: string;
	isCollapsed: boolean;
	onClick: () => void;
	indicator?: boolean;
}) {
	return (
		<Button
			variant='ghost'
			className={cn(
				'w-full justify-start relative group shadow-none transition-[padding,height,background-color] duration-300 p-[10px_!important] gap-4',
				isCollapsed ? 'h-9' : '',
			)}
			onClick={onClick}
		>
			<span className='relative flex items-center'>
				<LucideIconByName name={iconName} fallback={icon} className='size-4' />
				{indicator && (
					<span
						aria-hidden
						className='absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar'
					/>
				)}
			</span>
			<div
				className={cn(
					'flex min-w-0 items-center transition-[opacity,visibility] duration-300',
					hideIf(isCollapsed),
				)}
			>
				<span className='truncate'>{label}</span>
				<kbd className='group-hover:opacity-100 opacity-0 absolute right-3 text-[10px] text-muted-foreground font-sans transition-opacity hidden md:inline'>
					{shortcut}
				</kbd>
			</div>
		</Button>
	);
}

function canSeeBuiltInEntry(id: BuiltInMenuEntryId, access: SidebarMenuAccess): boolean {
	switch (id) {
		case 'new-chat':
			return access.canCreateChat;
		case 'automations':
			return access.canSeeAutomations;
		default:
			return true;
	}
}

function useOpenMenuEntry() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { fire: openCommandMenu } = useCommandMenuCallback();
	const { isMobile, closeMobile } = useSidebar();

	return (entry: SidebarMenuEntry) => {
		openEntry(entry);
		if (isMobile) {
			closeMobile();
		}
	};

	function openEntry(entry: SidebarMenuEntry) {
		switch (entry.type) {
			case 'built-in':
				return openBuiltInEntry(entry.id);
			case 'story':
				return navigate({ to: '/stories/$storyId', params: { storyId: entry.storyId } });
			case 'stories-page':
				invalidateStoriesCaches(queryClient);
				return navigate({ to: '/stories', search: { folderId: entry.filters.folderId, view: entry.id } });
			case 'link':
				return window.open(entry.url, '_blank', 'noopener,noreferrer');
		}
	}

	function openBuiltInEntry(id: BuiltInMenuEntryId) {
		switch (id) {
			case 'new-chat':
				return navigate({ to: '/' });
			case 'search-chats':
				return openCommandMenu();
			case 'stories':
				invalidateStoriesCaches(queryClient);
				return navigate({ to: '/stories', search: { folderId: null, view: undefined } });
			case 'inbox':
				return navigate({ to: '/inbox' });
			case 'automations':
				return navigate({ to: '/automations' });
		}
	}
}

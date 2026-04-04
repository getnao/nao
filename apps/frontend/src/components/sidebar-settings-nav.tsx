import { Link } from '@tanstack/react-router';
import { cn, hideIf } from '@/lib/utils';

interface NavItem {
	label: string;
	to: string;
	visible?: boolean;
}

const settingsNavItems: NavItem[] = [
	{
		label: 'General',
		to: '/settings/general',
		visible: undefined,
	},
	{
		label: 'Memory',
		to: '/settings/memory',
		visible: undefined,
	},
	{
		label: 'Project',
		to: '/settings/project',
		visible: undefined,
	},
	{
		label: 'Usage & costs',
		to: '/settings/usage',
		visible: true,
	},
	{
		label: 'Chats Replay',
		to: '/settings/chats-replay',
		visible: true,
	},
	{
		label: 'Logs',
		to: '/settings/logs',
		visible: true,
	},
	{
		label: 'File Explorer',
		to: '/settings/context-explorer',
		visible: true,
	},
];

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
	isAdmin: boolean;
}

export function SidebarSettingsNav({ isCollapsed, isAdmin }: SidebarSettingsNavProps) {
	const navItems = settingsNavItems.filter((item) => (item.visible === undefined ? true : item.visible === isAdmin));

	return (
		<nav className={cn('flex flex-col gap-1 px-2', hideIf(isCollapsed))}>
			{navItems.map((item) => {
				return (
					<Link
						key={item.to}
						to={item.to}
						className={cn(
							'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap',
						)}
						activeProps={{
							className: cn('bg-sidebar-accent text-foreground font-medium'),
						}}
						inactiveProps={{
							className: cn('hover:bg-sidebar-accent hover:text-foreground'),
						}}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

import { Link } from '@tanstack/react-router';
import { cn, hideIf } from '@/lib/utils';

const settingsNavItems = [
	{
		label: 'General',
		to: '/settings/general',
	},
	{
		label: 'Memory',
		to: '/settings/memory',
	},
	{
		label: 'Project',
		to: '/settings/project',
	},
	{
		label: 'Usage & costs',
		to: '/settings/usage',
	},
] as const;

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
}

export function SidebarSettingsNav({ isCollapsed }: SidebarSettingsNavProps) {
	return (
		<nav className={cn('flex flex-col gap-1 px-2', hideIf(isCollapsed))}>
			{settingsNavItems.map((item) => {
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

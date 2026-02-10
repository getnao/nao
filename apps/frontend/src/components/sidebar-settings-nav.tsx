import { Link, useMatchRoute } from '@tanstack/react-router';
import { cn, hideIf } from '@/lib/utils';

const settingsNavItems = [
	{
		label: 'Profile',
		to: '/settings/profile',
	},
	{
		label: 'Project',
		to: '/settings/project',
	},
	{
		label: 'Usage & costs',
		to: '/settings/usage',
	},
	{
		label: 'Appearance',
		to: '/settings/appearance',
	},
] as const;

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
}

export function SidebarSettingsNav({ isCollapsed }: SidebarSettingsNavProps) {
	const matchRoute = useMatchRoute();

	return (
		<nav className={cn('flex flex-col gap-1 px-2', hideIf(isCollapsed))}>
			{settingsNavItems.map((item) => {
				const isActive = matchRoute({ to: item.to });

				return (
					<Link
						key={item.to}
						to={item.to}
						className={cn(
							'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors',
							isActive
								? 'bg-sidebar-accent text-foreground font-medium'
								: 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
						)}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

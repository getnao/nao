import { Link, useLocation } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

interface NavItem {
	to: string;
	label: string;
}

const navItems: NavItem[] = [
	{ to: '/settings/project', label: 'Project' },
	{ to: '/settings/project/models', label: 'Models' },
	{ to: '/settings/project/agent', label: 'Agent' },
	{ to: '/settings/project/mcp-servers', label: 'MCP Servers' },
	{ to: '/settings/project/slack', label: 'Slack' },
	{ to: '/settings/project/team', label: 'Team' },
];

export function SettingsProjectNav() {
	return (
		<nav className='flex flex-col gap-1 sticky top-8 h-fit min-w-[140px]'>
			{navItems.map((item) => {
				return (
					<Link
						key={item.to}
						to={item.to}
						className={cn('text-left px-3 py-1 text-sm rounded-md transition-colors')}
						activeOptions={{ exact: true }}
						activeProps={{
							className: cn('text-foreground font-medium bg-accent'),
						}}
						inactiveProps={{
							className: cn('text-muted-foreground hover:text-foreground hover:bg-accent/50'),
						}}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

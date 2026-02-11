import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

export const projectSettingsTabs = ['project', 'models', 'agent', 'mcp-servers', 'slack', 'team'] as const;
export type ProjectSettingsTab = (typeof projectSettingsTabs)[number];

interface NavItem {
	id: ProjectSettingsTab;
	label: string;
}

const navItems: NavItem[] = [
	{ id: 'project', label: 'Project' },
	{ id: 'models', label: 'Models' },
	{ id: 'agent', label: 'Agent' },
	{ id: 'mcp-servers', label: 'MCP Servers' },
	{ id: 'slack', label: 'Slack' },
	{ id: 'team', label: 'Team' },
];

interface SettingsProjectNavProps {
	activeTab: ProjectSettingsTab;
}

export function SettingsProjectNav({ activeTab }: SettingsProjectNavProps) {
	return (
		<nav className='flex flex-col gap-1 sticky top-8 h-fit min-w-[140px]'>
			{navItems.map((item) => (
				<Link
					key={item.id}
					to='/settings/project'
					search={{ tab: item.id === 'project' ? undefined : item.id }}
					className={cn(
						'text-left px-3 py-1.5 text-sm rounded-md transition-colors',
						activeTab === item.id
							? 'text-foreground font-medium bg-accent'
							: 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
					)}
				>
					{item.label}
				</Link>
			))}
		</nav>
	);
}

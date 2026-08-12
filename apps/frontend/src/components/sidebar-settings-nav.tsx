import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Folder, Search, X } from 'lucide-react';

import type { ProjectOption } from '@/components/project-selector';

import { ProjectSelector } from '@/components/project-selector';
import { Badge } from '@/components/ui/badge';
import { useSettingsSearch } from '@/hooks/use-settings-search';
import { cn, hideIf } from '@/lib/utils';

interface NavContext {
	isAdmin: boolean;
	isContextAdmin: boolean;
	isCloud: boolean;
	hasLicense: boolean;
	isViewer: boolean;
	isInMultipleProjects: boolean;
}

interface NavItem {
	label: string;
	to?: string;
	search?: { admin?: boolean };
	visible?: (ctx: NavContext) => boolean;
	disabled?: (ctx: NavContext) => boolean;
	type?: 'divider' | 'item';
	badge?: string;
	badgeVariant?: 'new' | 'enterprise';
}

const settingsNavItems: NavItem[] = [
	{
		label: 'Settings',
		type: 'divider',
	},
	{
		label: 'Account',
		to: '/settings/account',
	},
	{
		label: 'Organization',
		to: '/settings/organization',
		visible: ({ isViewer }) => !isViewer,
	},
	{
		label: 'Project',
		to: '/settings/project',
		visible: ({ isViewer, isInMultipleProjects }) => !isViewer || isInMultipleProjects,
	},
	{
		label: 'Git',
		to: '/settings/git',
		visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
	},
	{
		label: 'MCP Endpoint',
		to: '/settings/mcp-endpoint',
		visible: ({ isViewer }) => !isViewer,
	},
	{
		label: 'Storage',
		to: '/settings/storage',
		visible: ({ isViewer, isCloud }) => !isViewer && !isCloud,
	},
	{
		label: 'Observability',
		type: 'divider',
		visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
	},
	{
		label: 'Chat with nao data',
		to: '/',
		search: { admin: true },
		visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
	},
	{
		label: 'Usage, costs & replay',
		to: '/settings/usage',
		visible: ({ isAdmin }) => isAdmin,
	},
	{
		label: 'Chats replay',
		to: '/settings/usage',
		visible: ({ isAdmin, isContextAdmin }) => !isAdmin && isContextAdmin,
	},
	{
		label: 'Server logs',
		to: '/settings/logs',
		visible: ({ isAdmin, isCloud }) => isAdmin && !isCloud,
	},
	{
		label: 'Context',
		type: 'divider',
		visible: ({ isViewer }) => !isViewer,
	},
	{
		label: 'Recommendations',
		to: '/settings/recommendations',
		visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
		badge: 'Beta',
		badgeVariant: 'new',
	},
	{
		label: 'File Explorer',
		to: '/settings/context-explorer',
		visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
	},
	{
		label: 'Memory',
		to: '/settings/memory',
		visible: ({ isViewer }) => !isViewer,
	},
	{
		label: 'Enterprise',
		type: 'divider',
		visible: ({ isAdmin, isCloud }) => isAdmin && !isCloud,
	},
	{
		label: 'License',
		to: '/settings/enterprise',
		visible: ({ isAdmin, isCloud, hasLicense }) => isAdmin && !isCloud && hasLicense,
	},
	{
		label: 'White-label',
		to: '/settings/white-label',
		visible: ({ isAdmin, isCloud }) => isAdmin && !isCloud,
	},
];

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
	isAdmin: boolean;
	isContextAdmin: boolean;
	isViewer: boolean;
	isCloud: boolean;
	hasLicense: boolean;
	projects: ProjectOption[];
	currentProjectId?: string;
	onProjectChange: (projectId: string) => void;
}

export function SidebarSettingsNav({
	isCollapsed,
	isAdmin,
	isContextAdmin,
	isViewer,
	isCloud,
	hasLicense,
	projects,
	currentProjectId,
	onProjectChange,
}: SidebarSettingsNavProps) {
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState('');

	const navItems = settingsNavItems.filter(
		(item) =>
			item.visible?.({
				isAdmin,
				isContextAdmin,
				isCloud,
				isViewer,
				isInMultipleProjects: projects.length > 1,
				hasLicense,
			}) ?? true,
	);
	const canSwitchProjects = projects.length > 1 && !!currentProjectId;

	useEffect(() => {
		const handleSlashKey = (e: KeyboardEvent) => {
			if (e.key !== '/' || isCollapsed || isViewer) {
				return;
			}
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
				return;
			}
			e.preventDefault();
			inputRef.current?.focus();
		};
		document.addEventListener('keydown', handleSlashKey);
		return () => document.removeEventListener('keydown', handleSlashKey);
	}, [isCollapsed, isViewer]);

	const results = useSettingsSearch(query);

	const isSearching = query.length >= 2;

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			setQuery('');
			inputRef.current?.blur();
		} else if (e.key === 'Enter' && results.length > 0) {
			setQuery('');
			navigate({ to: results[0].page });
		}
	};

	return (
		<div className={cn('flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto', hideIf(isCollapsed))}>
			{!isViewer && (
				<div className='px-2 pt-2'>
					<div className='relative'>
						<Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none' />
						<input
							ref={inputRef}
							type='text'
							placeholder='Search settings...'
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={handleKeyDown}
							className={cn(
								'w-full rounded-lg border border-input bg-transparent py-1.5 pl-8 pr-8 text-sm',
								'placeholder:text-muted-foreground',
								'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
							)}
						/>
						{query ? (
							<button
								type='button'
								onClick={() => {
									setQuery('');
									inputRef.current?.focus();
								}}
								className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
							>
								<X className='size-3.5' />
							</button>
						) : (
							<kbd className='absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] font-mono text-muted-foreground border border-border rounded px-1'>
								/
							</kbd>
						)}
					</div>
				</div>
			)}

			{isSearching && !isViewer ? (
				<div className='flex flex-col gap-0.5 px-2 pt-1'>
					{results.length === 0 ? (
						<div className='px-3 py-4 text-xs text-muted-foreground text-center'>No results found</div>
					) : (
						results.map((result) => (
							<Link
								key={result.page + result.title}
								to={result.page}
								onClick={() => setQuery('')}
								className={cn(
									'flex flex-col gap-0.5 px-3 py-2 text-sm rounded-md transition-colors',
									'hover:bg-sidebar-accent hover:text-foreground',
								)}
							>
								<span className='font-medium truncate'>{result.title}</span>
								<span className='text-xs text-muted-foreground truncate'>
									{result.pageLabel}
									{result.section ? ` · ${result.section}` : ''}
								</span>
							</Link>
						))
					)}
				</div>
			) : (
				<nav className='flex flex-col gap-1 px-2'>
					{navItems.map((item) => {
						if (item.type === 'divider') {
							return (
								<div
									key={item.label}
									className='uppercase text-xs font-medium text-muted-foreground px-3 pt-4'
								>
									{item.label}
								</div>
							);
						}

						const isProjectItem = item.to === '/settings/project';
						const isDisabled =
							item.disabled?.({
								isAdmin,
								isContextAdmin,
								isCloud,
								isViewer,
								isInMultipleProjects: projects.length > 1,
								hasLicense,
							}) ?? false;

						const badge = item.badge ? (
							<Badge
								variant='ghost'
								className={cn(
									'ml-auto h-4 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide',
									item.badgeVariant === 'enterprise'
										? 'bg-primary/10 text-primary'
										: 'bg-secondary text-secondary-foreground',
								)}
							>
								{item.badge}
							</Badge>
						) : null;

						return (
							<div key={item.to} className='flex flex-col'>
								{isDisabled ? (
									<span
										className='flex items-center gap-2 px-3 py-2 text-sm rounded-md whitespace-nowrap cursor-not-allowed'
										aria-disabled='true'
									>
										{item.label}
										{badge}
									</span>
								) : item.search ? (
									<Link
										to='/'
										search={item.search}
										className={cn(
											'flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap',
										)}
										activeProps={{
											className: cn('bg-sidebar-accent text-foreground font-medium'),
										}}
										inactiveProps={{
											className: cn('hover:bg-sidebar-accent hover:text-foreground'),
										}}
									>
										{item.label}
										{badge}
									</Link>
								) : (
									<Link
										to={item.to}
										className={cn(
											'flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap',
										)}
										activeProps={{
											className: cn('bg-sidebar-accent text-foreground font-medium'),
										}}
										inactiveProps={{
											className: cn('hover:bg-sidebar-accent hover:text-foreground'),
										}}
									>
										{item.label}
										{badge}
									</Link>
								)}
								{isProjectItem && canSwitchProjects && currentProjectId && (
									<ProjectSwitcherSubItem
										projects={projects}
										currentProjectId={currentProjectId}
										onChange={onProjectChange}
									/>
								)}
							</div>
						);
					})}
				</nav>
			)}
		</div>
	);
}

function ProjectSwitcherSubItem({
	projects,
	currentProjectId,
	onChange,
}: {
	projects: ProjectOption[];
	currentProjectId: string;
	onChange: (projectId: string) => void;
}) {
	return (
		<div className='ml-3 mt-1 pl-3 border-l border-sidebar-border'>
			<div className='px-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground'>Switch project</div>
			<ProjectSelector
				projects={projects}
				currentProjectId={currentProjectId}
				onChange={onChange}
				triggerVariant='ghost'
				triggerIcon={<Folder className='size-3.5 shrink-0' />}
				triggerClassName={cn(
					'w-full h-auto py-1.5 px-2 text-sm rounded-md',
					'bg-sidebar-accent/40 hover:bg-sidebar-accent hover:text-foreground',
				)}
			/>
		</div>
	);
}

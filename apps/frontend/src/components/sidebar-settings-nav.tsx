import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { useSettingsSearch } from '@/hooks/use-settings-search';
import { cn, hideIf } from '@/lib/utils';

interface NavContext {
	isAdmin: boolean;
	isContextAdmin: boolean;
	isCloud: boolean;
	isViewer: boolean;
}

interface NavItem {
	label: string;
	to?: string;
	search?: { admin?: boolean };
	visible?: (ctx: NavContext) => boolean;
	exact?: boolean;
	badge?: string;
	badgeVariant?: 'new' | 'enterprise';
	leavesSettings?: boolean;
}

interface NavGroup {
	label: string;
	items: NavItem[];
}

const settingsNavGroups: NavGroup[] = [
	{
		label: 'Project',
		items: [
			{
				label: 'Project Settings & Budget',
				to: '/settings/project',
				visible: ({ isViewer }) => !isViewer,
				exact: true,
			},
			{
				label: 'Team',
				to: '/settings/project/team',
				visible: ({ isViewer }) => !isViewer,
			},
			{
				label: 'Agent',
				to: '/settings/project/agent',
				visible: ({ isViewer }) => !isViewer,
			},
			{
				label: 'Integrations & MCP',
				to: '/settings/project/integrations',
				visible: ({ isViewer }) => !isViewer,
			},
			{
				label: 'Appearance',
				to: '/settings/appearance',
				visible: ({ isViewer }) => !isViewer,
			},
		],
	},
	{
		label: 'Context',
		items: [
			{
				label: 'Git',
				to: '/settings/git',
				visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
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
		],
	},
	{
		label: 'Observability',
		items: [
			{
				label: 'Chat with nao data',
				to: '/',
				search: { admin: true },
				visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
				exact: true,
				leavesSettings: true,
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
		],
	},
	{
		label: 'Organization',
		items: [
			{
				label: 'Organization Settings',
				to: '/settings/organization',
				visible: ({ isViewer }) => !isViewer,
				exact: true,
			},
			{
				label: 'Members',
				to: '/settings/organization/members',
				visible: ({ isViewer }) => !isViewer,
				exact: true,
			},
			{
				label: 'Storage',
				to: '/settings/storage',
				visible: ({ isViewer, isCloud }) => !isViewer && !isCloud,
			},
			{
				label: 'Enterprise',
				to: '/settings/enterprise',
				visible: ({ isViewer, isCloud }) => !isViewer && !isCloud,
			},
		],
	},
];

const navRowClassName =
	'flex items-center gap-2 rounded-md transition-colors whitespace-nowrap px-2 py-[5px] text-[13px] leading-5';

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
	isAdmin: boolean;
	isContextAdmin: boolean;
	isViewer: boolean;
	isCloud: boolean;
}

export function SidebarSettingsNav({
	isCollapsed,
	isAdmin,
	isContextAdmin,
	isViewer,
	isCloud,
}: SidebarSettingsNavProps) {
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState('');
	const [isSearchFocused, setIsSearchFocused] = useState(false);

	const navContext = {
		isAdmin,
		isContextAdmin,
		isCloud,
		isViewer,
	};
	const navGroups = settingsNavGroups
		.map((group) => ({
			...group,
			items: group.items.filter((item) => item.visible?.(navContext) ?? true),
		}))
		.filter((group) => group.items.length > 0);

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
			navigate({ to: results[0].page, search: results[0].search });
		}
	};

	const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
		if (!e.currentTarget.readOnly) {
			return;
		}
		e.preventDefault();
		e.currentTarget.readOnly = false;
		e.currentTarget.focus();
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
							name='settings-search'
							autoComplete='off'
							placeholder='Search settings...'
							value={query}
							readOnly={!isSearchFocused}
							onPointerDown={handlePointerDown}
							onFocus={() => setIsSearchFocused(true)}
							onBlur={() => setIsSearchFocused(false)}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={handleKeyDown}
							className={cn(
								'w-full rounded-md border border-input bg-transparent py-1 pl-8 pr-8 text-[13px] leading-5',
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

			<div className='flex-1 min-h-0 overflow-y-auto'>
				{isSearching && !isViewer ? (
					<div className='flex flex-col gap-px px-2 pt-1'>
						{results.length === 0 ? (
							<div className='px-2 py-4 text-xs text-muted-foreground text-center'>No results found</div>
						) : (
							results.map((result) => (
								<Link
									key={result.page + result.title}
									to={result.page}
									search={result.search}
									onClick={() => setQuery('')}
									className={cn(
										'flex flex-col gap-px px-2 py-1 text-[13px] leading-5 rounded-md transition-colors',
										'hover:bg-sidebar-accent hover:text-foreground',
									)}
								>
									<span className='font-medium truncate'>{result.title}</span>
									<span className='text-[11px] leading-4 text-muted-foreground truncate'>
										{result.pageLabel}
										{result.section ? ` · ${result.section}` : ''}
									</span>
								</Link>
							))
						)}
					</div>
				) : (
					<nav className='flex flex-col px-2 gap-1'>
						{navGroups.map((group) => (
							<Fragment key={group.label}>
								<div className='px-2 pt-4 pb-0.5 text-[11px] leading-4 font-medium uppercase tracking-wide text-muted-foreground'>
									{group.label}
								</div>
								{group.items.map((item) => {
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
									const leavesSettingsIndicator = item.leavesSettings ? (
										<>
											<ArrowUpRight
												aria-hidden='true'
												className={cn('size-3.5 text-muted-foreground', !badge && 'ml-auto')}
											/>
											<span className='sr-only'>Opens a chat outside settings</span>
										</>
									) : null;

									return (
										<div key={`${item.to}-${item.label}`} className='flex flex-col'>
											{item.search ? (
												<Link
													to='/'
													search={item.search}
													activeOptions={item.exact ? { exact: true } : undefined}
													className={navRowClassName}
													activeProps={{
														className: cn('bg-sidebar-accent text-foreground font-medium'),
													}}
													inactiveProps={{
														className: cn('hover:bg-sidebar-accent hover:text-foreground'),
													}}
												>
													{item.label}
													{badge}
													{leavesSettingsIndicator}
												</Link>
											) : (
												<Link
													to={item.to}
													activeOptions={item.exact ? { exact: true } : undefined}
													className={navRowClassName}
													activeProps={{
														className: cn('bg-sidebar-accent text-foreground font-medium'),
													}}
													inactiveProps={{
														className: cn('hover:bg-sidebar-accent hover:text-foreground'),
													}}
												>
													{item.label}
													{badge}
													{leavesSettingsIndicator}
												</Link>
											)}
										</div>
									);
								})}
							</Fragment>
						))}
					</nav>
				)}
			</div>
		</div>
	);
}

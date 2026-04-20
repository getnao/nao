import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import Fuse from 'fuse.js';
import { Folder, Search, X } from 'lucide-react';

import type { FuseResult } from 'fuse.js';
import type { ProjectOption } from '@/components/project-selector';
import type { SettingsSearchEntry } from '@/components/settings-search-index';

import { ProjectSelector } from '@/components/project-selector';
import { settingsSearchIndex } from '@/components/settings-search-index';
import { cn, hideIf } from '@/lib/utils';

interface NavContext {
	isAdmin: boolean;
	isCloud: boolean;
}

interface NavItem {
	label: string;
	to?: string;
	visible?: (ctx: NavContext) => boolean;
	type?: 'divider' | 'item';
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
	},
	{
		label: 'Project',
		to: '/settings/project',
	},
	{
		label: 'Observability',
		type: 'divider',
		visible: ({ isAdmin }) => isAdmin,
	},
	{
		label: 'Usage & costs',
		to: '/settings/usage',
		visible: ({ isAdmin }) => isAdmin,
	},
	{
		label: 'Chats Replay',
		to: '/settings/chats-replay',
		visible: ({ isAdmin }) => isAdmin,
	},
	{
		label: 'Logs',
		to: '/settings/logs',
		visible: ({ isAdmin, isCloud }) => isAdmin && !isCloud,
	},
	{
		label: 'Context',
		type: 'divider',
	},
	{
		label: 'Memory',
		to: '/settings/memory',
	},
	{
		label: 'File Explorer',
		to: '/settings/context-explorer',
		visible: ({ isAdmin }) => isAdmin,
	},
];

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
	isAdmin: boolean;
	isCloud: boolean;
	projects: ProjectOption[];
	currentProjectId?: string;
	onProjectChange: (projectId: string) => void;
}

function dedupeByPage(results: FuseResult<SettingsSearchEntry>[]) {
	const seen = new Set<string>();
	return results.filter((r) => {
		if (seen.has(r.item.page)) {
			return false;
		}
		seen.add(r.item.page);
		return true;
	});
}

export function SidebarSettingsNav({
	isCollapsed,
	isAdmin,
	isCloud,
	projects,
	currentProjectId,
	onProjectChange,
}: SidebarSettingsNavProps) {
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState('');

	const navItems = settingsNavItems.filter((item) => item.visible?.({ isAdmin, isCloud }) ?? true);
	const canSwitchProjects = projects.length > 1 && !!currentProjectId;

	useEffect(() => {
		const handleSlashKey = (e: KeyboardEvent) => {
			if (e.key !== '/' || isCollapsed) {
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
	}, [isCollapsed]);

	const fuse = useMemo(() => {
		const entries = settingsSearchIndex.filter((e) => (!e.adminOnly || isAdmin) && (!e.cloudHidden || !isCloud));
		return new Fuse(entries, {
			keys: [
				{ name: 'title', weight: 0.4 },
				{ name: 'pageLabel', weight: 0.25 },
				{ name: 'description', weight: 0.2 },
				{ name: 'keywords', weight: 0.15 },
			],
			threshold: 0.4,
			includeScore: true,
		});
	}, [isAdmin, isCloud]);

	const results = useMemo(() => {
		if (query.length < 2) {
			return [];
		}
		return dedupeByPage(fuse.search(query, { limit: 8 }));
	}, [query, fuse]);

	const isSearching = query.length >= 2;

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			setQuery('');
			inputRef.current?.blur();
		} else if (e.key === 'Enter' && results.length > 0) {
			setQuery('');
			navigate({ to: results[0].item.page });
		}
	};

	return (
		<div className={cn('flex flex-col gap-1', hideIf(isCollapsed))}>
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

			{isSearching ? (
				<div className='flex flex-col gap-0.5 px-2 pt-1'>
					{results.length === 0 ? (
						<div className='px-3 py-4 text-xs text-muted-foreground text-center'>No results found</div>
					) : (
						results.map((result) => (
							<Link
								key={result.item.page + result.item.title}
								to={result.item.page}
								onClick={() => setQuery('')}
								className={cn(
									'flex flex-col gap-0.5 px-3 py-2 text-sm rounded-md transition-colors',
									'hover:bg-sidebar-accent hover:text-foreground',
								)}
							>
								<span className='font-medium truncate'>{result.item.title}</span>
								<span className='text-xs text-muted-foreground truncate'>
									{result.item.pageLabel}
									{result.item.section ? ` · ${result.item.section}` : ''}
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

						return (
							<div key={item.to} className='flex flex-col'>
								<Link
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

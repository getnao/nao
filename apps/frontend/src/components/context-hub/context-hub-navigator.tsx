import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Plus, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ContextHubSectionStyle } from '@/components/context-hub/context-hub-section-icon';
import type { ContextHubDoc, ContextHubTable, ContextHubTableFolder } from '@/lib/context-hub';
import { CONTEXT_HUB_SECTION_STYLES } from '@/components/context-hub/context-hub-section-icon';
import { Button } from '@/components/ui/button';
import { CONTEXT_HUB_DOC_SECTIONS, formatTableLocation } from '@/lib/context-hub';
import { getTreeNodePadding } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';

interface NavigatorItem {
	path: string;
	title: string;
	subtitle: string | null;
	tooltip: string;
	isSelected: boolean;
}

interface ContextHubNavigatorProps {
	tableFolders: ContextHubTableFolder[];
	docs: ContextHubDoc[];
	search: string;
	selectedPath: string | null;
	onSearchChange: (search: string) => void;
	onOpenFile: (path: string) => void;
	onNewSkill: () => void;
}

/** Indents an item under its section's label: past the section's chevron, icon tile and their gaps. */
const ITEM_PADDING_LEFT = getTreeNodePadding(0) + 44;
/** Hangs a folder's chevron to the left so its icon lines up with the items next to it. */
const FOLDER_PADDING_LEFT = ITEM_PADDING_LEFT - 18;
const FOLDER_ITEM_PADDING_LEFT = ITEM_PADDING_LEFT + 20;

/** The Context tab of the doc view: every table and doc the agent knows, by section like folders, with one search. */
export function ContextHubNavigator({
	tableFolders,
	docs,
	search,
	selectedPath,
	onSearchChange,
	onOpenFile,
	onNewSkill,
}: ContextHubNavigatorProps) {
	const isSearching = search.trim().length > 0;
	const tableCount = tableFolders.reduce((count, folder) => count + folder.tables.length, 0);

	return (
		<div className='flex h-full flex-col'>
			<div className='flex h-10 shrink-0 items-center border-b px-2'>
				<NavigatorSearch search={search} onSearchChange={onSearchChange} />
			</div>
			<nav aria-label='Context' className='flex-1 overflow-auto p-2'>
				<NavigatorSection
					label='Tables'
					sectionStyle={CONTEXT_HUB_SECTION_STYLES.tables}
					count={tableCount}
					hasSelectedItem={tableFolders.some((folder) => hasSelectedTable(folder.tables, selectedPath))}
					isSearching={isSearching}
					emptyMessage='Tables appear once your databases are synced.'
				>
					{tableFolders.map((folder) =>
						folder.label === null ? (
							<NavigatorItems
								key='tables'
								items={folder.tables.map((table) => toTableItem(table, selectedPath))}
								sectionStyle={CONTEXT_HUB_SECTION_STYLES.tables}
								paddingLeft={ITEM_PADDING_LEFT}
								onOpenFile={onOpenFile}
							/>
						) : (
							<NavigatorFolder
								key={folder.label}
								label={folder.label}
								items={folder.tables.map((table) => toTableItem(table, selectedPath))}
								isSearching={isSearching}
								onOpenFile={onOpenFile}
							/>
						),
					)}
				</NavigatorSection>
				{CONTEXT_HUB_DOC_SECTIONS.map((section) => {
					const items = docs
						.filter((doc) => doc.section === section.key)
						.map((doc) => toDocItem(doc, selectedPath));
					const sectionStyle = CONTEXT_HUB_SECTION_STYLES[section.key];
					return (
						<NavigatorSection
							key={section.key}
							label={section.label}
							sectionStyle={sectionStyle}
							count={items.length}
							hasSelectedItem={items.some((item) => item.isSelected)}
							isSearching={isSearching}
							emptyMessage={section.key === 'skills' ? 'No skills yet.' : null}
							action={
								section.key === 'skills' && (
									<Button variant='ghost' size='icon-xs' aria-label='New skill' onClick={onNewSkill}>
										<Plus />
									</Button>
								)
							}
						>
							<NavigatorItems
								items={items}
								sectionStyle={sectionStyle}
								paddingLeft={ITEM_PADDING_LEFT}
								onOpenFile={onOpenFile}
							/>
						</NavigatorSection>
					);
				})}
				{isSearching && tableCount === 0 && docs.length === 0 && (
					<p className='px-3 py-4 text-center text-xs text-muted-foreground'>No matching tables or docs.</p>
				)}
			</nav>
		</div>
	);
}

function NavigatorSearch({ search, onSearchChange }: { search: string; onSearchChange: (search: string) => void }) {
	return (
		<div className='flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted/60 pr-1 pl-2.5 text-muted-foreground transition-colors focus-within:bg-background focus-within:ring-1 focus-within:ring-ring'>
			<Search className='size-3.5 shrink-0' />
			<input
				type='text'
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape' && search) {
						event.preventDefault();
						onSearchChange('');
					}
				}}
				placeholder='Search tables and docs'
				aria-label='Search tables and docs'
				className='h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground'
			/>
			{search && (
				<button
					type='button'
					aria-label='Clear search'
					onClick={() => onSearchChange('')}
					className='flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-muted hover:text-foreground'
				>
					<X className='size-3' />
				</button>
			)}
		</div>
	);
}

function NavigatorSection({
	label,
	sectionStyle,
	count,
	hasSelectedItem,
	isSearching,
	emptyMessage,
	action,
	children,
}: {
	label: string;
	sectionStyle: ContextHubSectionStyle;
	count: number;
	hasSelectedItem: boolean;
	isSearching: boolean;
	/** Shown when the section is empty outside a search; without it, an empty section is hidden. */
	emptyMessage: string | null;
	action?: ReactNode;
	children: ReactNode;
}) {
	const [isOpen, toggle] = useCollapsible(hasSelectedItem, isSearching);

	if (count === 0 && (isSearching || !emptyMessage)) {
		return null;
	}

	return (
		<section className='mb-0.5'>
			<div className='group flex h-7 items-center rounded-md pr-1 text-[13px] font-medium text-foreground/85 hover:bg-muted/60 hover:text-foreground'>
				<button
					type='button'
					aria-expanded={isOpen}
					className='flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left'
					style={{ paddingLeft: getTreeNodePadding(0) }}
					onClick={toggle}
				>
					<DisclosureChevron isOpen={isOpen} />
					<SectionIcon sectionStyle={sectionStyle} />
					<span className='truncate'>{label}</span>
				</button>
				{action}
				<ItemCount count={count} />
			</div>
			{isOpen && count === 0 && (
				<p className='py-1 text-xs text-muted-foreground' style={{ paddingLeft: ITEM_PADDING_LEFT }}>
					{emptyMessage}
				</p>
			)}
			{isOpen && children}
		</section>
	);
}

/** A schema, or a connection and schema, holding its tables when the tables live in more than one place. */
function NavigatorFolder({
	label,
	items,
	isSearching,
	onOpenFile,
}: {
	label: string;
	items: NavigatorItem[];
	isSearching: boolean;
	onOpenFile: (path: string) => void;
}) {
	const [isOpen, toggle] = useCollapsible(
		items.some((item) => item.isSelected),
		isSearching,
	);

	return (
		<div>
			<div className='flex h-7 items-center rounded-md pr-1 text-[13px] text-foreground/80 hover:bg-muted/60 hover:text-foreground'>
				<button
					type='button'
					aria-expanded={isOpen}
					title={label}
					className='flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left'
					style={{ paddingLeft: FOLDER_PADDING_LEFT }}
					onClick={toggle}
				>
					<DisclosureChevron isOpen={isOpen} />
					<Folder className='size-3.5 shrink-0 text-muted-foreground' />
					<span className='ml-0.5 truncate'>{label}</span>
				</button>
				<ItemCount count={items.length} />
			</div>
			{isOpen && (
				<NavigatorItems
					items={items}
					sectionStyle={CONTEXT_HUB_SECTION_STYLES.tables}
					paddingLeft={FOLDER_ITEM_PADDING_LEFT}
					onOpenFile={onOpenFile}
				/>
			)}
		</div>
	);
}

function NavigatorItems({
	items,
	sectionStyle,
	paddingLeft,
	onOpenFile,
}: {
	items: NavigatorItem[];
	sectionStyle: ContextHubSectionStyle;
	paddingLeft: number;
	onOpenFile: (path: string) => void;
}) {
	const Icon = sectionStyle.icon;

	return items.map((item) => (
		<button
			key={item.path}
			type='button'
			aria-current={item.isSelected ? 'page' : undefined}
			title={item.tooltip}
			className={cn(
				'flex h-7 w-full cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors',
				item.isSelected
					? 'bg-muted font-medium text-foreground'
					: 'text-foreground/75 hover:bg-muted/60 hover:text-foreground',
			)}
			style={{ paddingLeft }}
			onClick={() => onOpenFile(item.path)}
		>
			<Icon className={cn('size-3.5 shrink-0 opacity-80', sectionStyle.iconClassName)} />
			<span className='truncate'>{item.title}</span>
			{item.subtitle && (
				<span className='min-w-0 truncate text-xs font-normal text-muted-foreground'>{item.subtitle}</span>
			)}
		</button>
	));
}

function SectionIcon({ sectionStyle }: { sectionStyle: ContextHubSectionStyle }) {
	const Icon = sectionStyle.icon;

	return (
		<span
			className={cn('flex size-5 shrink-0 items-center justify-center rounded-[5px]', sectionStyle.tileClassName)}
		>
			<Icon className={cn('size-3.5', sectionStyle.iconClassName)} />
		</span>
	);
}

function DisclosureChevron({ isOpen }: { isOpen: boolean }) {
	return (
		<ChevronRight
			className={cn('size-3 shrink-0 text-muted-foreground/70 transition-transform', isOpen && 'rotate-90')}
		/>
	);
}

function ItemCount({ count }: { count: number }) {
	return <span className='shrink-0 px-1 text-[11px] font-normal tabular-nums text-muted-foreground/70'>{count}</span>;
}

/** Starts collapsed, and opens itself while searching or when it holds the open page. */
function useCollapsible(hasSelectedItem: boolean, isSearching: boolean): [boolean, () => void] {
	const [isExpanded, setIsExpanded] = useState(hasSelectedItem);
	const isOpen = isSearching || isExpanded;

	useEffect(() => {
		if (hasSelectedItem) {
			setIsExpanded(true);
		}
	}, [hasSelectedItem]);

	return [isOpen, () => setIsExpanded(!isOpen)];
}

function hasSelectedTable(tables: ContextHubTable[], selectedPath: string | null): boolean {
	return tables.some((table) => table.files.some((file) => file.path === selectedPath));
}

function toTableItem(table: ContextHubTable, selectedPath: string | null): NavigatorItem {
	const location = formatTableLocation(table);
	return {
		path: table.files[0].path,
		title: table.table,
		subtitle: null,
		tooltip: location ? `${table.table} · ${location}` : table.table,
		isSelected: hasSelectedTable([table], selectedPath),
	};
}

function toDocItem(doc: ContextHubDoc, selectedPath: string | null): NavigatorItem {
	return {
		path: doc.path,
		title: doc.title,
		subtitle: doc.folder,
		tooltip: doc.folder ? `${doc.title} · ${doc.folder}` : doc.title,
		isSelected: doc.path === selectedPath,
	};
}

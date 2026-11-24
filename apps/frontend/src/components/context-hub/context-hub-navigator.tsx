import { TESTS_FOLDER, toExplorerTestPath } from '@nao/shared/test-paths';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, Hammer, Inbox, Plus, Search, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { ContextHubSectionStyle } from '@/components/context-hub/context-hub-section-icon';
import type { SkillPage } from '@/components/context-hub/context-hub-skill-page';
import type { PersonalSkill, ShareRequest } from '@/components/personal-skills';
import type { TestDefinition } from '@/components/settings/test-run-types';
import type { ContextHubDoc, ContextHubTable, ContextHubTableFolder } from '@/lib/context-hub';
import { CONTEXT_HUB_SECTION_STYLES, TESTS_SECTION_STYLE } from '@/components/context-hub/context-hub-section-icon';
import { isSameSkillPage } from '@/components/context-hub/context-hub-skill-page';
import { PERSONAL_ICON_CLASS_NAME } from '@/components/personal-skills';
import { Button } from '@/components/ui/button';
import { CONTEXT_HUB_DOC_SECTIONS, formatTableLocation } from '@/lib/context-hub';
import { getTreeNodePadding } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

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
	/** The tests matching the search, once loaded. */
	tests: TestDefinition[] | undefined;
	search: string;
	/** The open file, the explorer path of the open test, or the tests folder while all the tests are shown. */
	selectedPath: string | null;
	onSearchChange: (search: string) => void;
	onOpenFile: (path: string) => void;
	onOpenTests: () => void;
	onOpenTest: (explorerPath: string) => void;
	onNewSkill: () => void;
	skillPage: SkillPage | null;
	onOpenSkillPage: (page: SkillPage) => void;
}

const ALL_TESTS_PATH = `/${TESTS_FOLDER}`;

/** Indents an item under its section's label: past the section's chevron, icon tile and their gaps. */
const ITEM_PADDING_LEFT = getTreeNodePadding(0) + 44;
/** Hangs a folder's chevron to the left so its icon lines up with the items next to it. */
const FOLDER_PADDING_LEFT = ITEM_PADDING_LEFT - 18;
const FOLDER_ITEM_PADDING_LEFT = ITEM_PADDING_LEFT + 20;
/** Every row of the tree keeps the same small gap to the next, so two highlighted rows never touch. */
const ROW_LIST_CLASS_NAME = 'flex flex-col gap-0.5';

/** The Context tab of the doc view: every table and doc the agent knows, by section like folders, with one search. */
export function ContextHubNavigator({
	tableFolders,
	docs,
	tests,
	search,
	selectedPath,
	onSearchChange,
	onOpenFile,
	onOpenTests,
	onOpenTest,
	onNewSkill,
	skillPage,
	onOpenSkillPage,
}: ContextHubNavigatorProps) {
	const isSearching = search.trim().length > 0;
	const virtualSkills = useVirtualSkills(search, true);
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
					const isSkills = section.key === 'skills';
					return (
						<NavigatorSection
							key={section.key}
							label={section.label}
							sectionStyle={sectionStyle}
							count={items.length + (isSkills ? virtualSkills.personal.length : 0)}
							hasSelectedItem={items.some((item) => item.isSelected) || (isSkills && skillPage !== null)}
							onExpand={isSkills ? () => onOpenSkillPage({ type: 'all' }) : undefined}
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
							{isSkills && !isSearching && (
								<VirtualSkillRow
									page={{ type: 'all' }}
									label='All skills'
									icon={<Hammer className={cn('size-3.5 shrink-0', sectionStyle.iconClassName)} />}
									selectedPage={skillPage}
									onOpen={onOpenSkillPage}
								/>
							)}
							<NavigatorItems
								items={items}
								sectionStyle={sectionStyle}
								paddingLeft={ITEM_PADDING_LEFT}
								onOpenFile={onOpenFile}
							/>
							{isSkills && (
								<VirtualSkillGroups
									skills={virtualSkills}
									selectedPage={skillPage}
									onOpen={onOpenSkillPage}
								/>
							)}
						</NavigatorSection>
					);
				})}
				{tests && (
					<TestsSection
						tests={tests}
						selectedPath={selectedPath}
						isSearching={isSearching}
						onOpenTests={onOpenTests}
						onOpenTest={onOpenTest}
					/>
				)}
				{isSearching && tableCount === 0 && docs.length === 0 && !tests?.length && (
					<p className='px-3 py-4 text-center text-xs text-muted-foreground'>
						No matching tables, docs or tests.
					</p>
				)}
			</nav>
		</div>
	);
}

/** The Context Hub of members whose groups grant personal skills: the skills alone, with no file behind them. */
export function ContextHubSkillsNavigator({
	skillPage,
	onOpenSkillPage,
	onNewSkill,
}: {
	skillPage: SkillPage;
	onOpenSkillPage: (page: SkillPage) => void;
	onNewSkill: () => void;
}) {
	const virtualSkills = useVirtualSkills('', false);
	const sectionStyle = CONTEXT_HUB_SECTION_STYLES.skills;

	return (
		<nav aria-label='Context' className='flex-1 overflow-auto p-2'>
			<NavigatorSection
				label='Skills'
				sectionStyle={sectionStyle}
				count={virtualSkills.personal.length}
				hasSelectedItem
				isSearching={false}
				emptyMessage='No personal skills yet.'
				action={
					<Button variant='ghost' size='icon-xs' aria-label='New skill' onClick={onNewSkill}>
						<Plus />
					</Button>
				}
			>
				<VirtualSkillRow
					page={{ type: 'all' }}
					label='All skills'
					icon={<Hammer className={cn('size-3.5 shrink-0', sectionStyle.iconClassName)} />}
					selectedPage={skillPage}
					onOpen={onOpenSkillPage}
				/>
				<VirtualSkillGroups skills={virtualSkills} selectedPage={skillPage} onOpen={onOpenSkillPage} />
			</NavigatorSection>
		</nav>
	);
}

/** All the tests first, as the drawer of the file tree shows them, then one item per test. Opening it shows them all. */
function TestsSection({
	tests,
	selectedPath,
	isSearching,
	onOpenTests,
	onOpenTest,
}: {
	tests: TestDefinition[];
	selectedPath: string | null;
	isSearching: boolean;
	onOpenTests: () => void;
	onOpenTest: (explorerPath: string) => void;
}) {
	const items = tests.map((test) => toTestItem(test, selectedPath));
	const allTestsItem = {
		path: ALL_TESTS_PATH,
		title: 'All tests',
		subtitle: null,
		tooltip: 'All the tests and their runs',
		isSelected: selectedPath === ALL_TESTS_PATH,
	};

	return (
		<NavigatorSection
			label='Tests'
			sectionStyle={TESTS_SECTION_STYLE}
			count={items.length}
			hasSelectedItem={allTestsItem.isSelected || items.some((item) => item.isSelected)}
			isSearching={isSearching}
			emptyMessage='No tests yet.'
			onExpand={onOpenTests}
		>
			{items.length > 0 && (
				<NavigatorItems
					items={[allTestsItem, ...items]}
					sectionStyle={TESTS_SECTION_STYLE}
					paddingLeft={ITEM_PADDING_LEFT}
					onOpenFile={(path) => (path === ALL_TESTS_PATH ? onOpenTests() : onOpenTest(path))}
				/>
			)}
		</NavigatorSection>
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
				placeholder='Search tables, docs and tests'
				aria-label='Search tables, docs and tests'
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
	onExpand,
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
	/** Called when the header opens the section, not when it closes it. */
	onExpand?: () => void;
	children: ReactNode;
}) {
	const [isOpen, toggle] = useCollapsible(hasSelectedItem, isSearching);

	const toggleSection = () => {
		toggle();
		if (!isOpen) {
			onExpand?.();
		}
	};

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
					onClick={toggleSection}
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
			{isOpen && <div className={ROW_LIST_CLASS_NAME}>{children}</div>}
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
		<div className={ROW_LIST_CLASS_NAME}>
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

/** Personal skills and share requests live in nao, not in the context files, so they are listed apart from the files. */
function VirtualSkillGroups({
	skills,
	selectedPage,
	onOpen,
}: {
	skills: VirtualSkills;
	selectedPage: SkillPage | null;
	onOpen: (page: SkillPage) => void;
}) {
	return (
		<>
			{skills.personal.length > 0 && <VirtualGroupLabel label='Mine' count={skills.personal.length} />}
			{skills.personal.map((skill) => (
				<VirtualSkillRow
					key={skill.name}
					page={{ type: 'personal', name: skill.name }}
					label={skill.name}
					icon={<User className={cn('size-3.5 shrink-0', PERSONAL_ICON_CLASS_NAME)} />}
					selectedPage={selectedPage}
					onOpen={onOpen}
				/>
			))}
			{skills.requests.length > 0 && <VirtualGroupLabel label='Share requests' count={skills.requests.length} />}
			{skills.requests.map((request) => (
				<VirtualSkillRow
					key={request.id}
					page={{ type: 'request', id: request.id }}
					label={request.name}
					icon={<Inbox className='size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />}
					selectedPage={selectedPage}
					onOpen={onOpen}
				/>
			))}
		</>
	);
}

function VirtualGroupLabel({ label, count }: { label: string; count: number }) {
	return (
		<p
			className='flex items-center gap-1.5 pt-2 pr-2 pb-1 text-xs font-medium text-muted-foreground'
			style={{ paddingLeft: ITEM_PADDING_LEFT }}
			title='Stored in nao, not in the context files'
		>
			{label}
			<span className='ml-auto tabular-nums'>{count}</span>
		</p>
	);
}

function VirtualSkillRow({
	page,
	label,
	icon,
	selectedPage,
	onOpen,
}: {
	page: SkillPage;
	label: string;
	icon: ReactNode;
	selectedPage: SkillPage | null;
	onOpen: (page: SkillPage) => void;
}) {
	const isSelected = isSameSkillPage(selectedPage, page);

	return (
		<button
			type='button'
			aria-current={isSelected ? 'page' : undefined}
			title={label}
			className={cn(
				'flex h-7 w-full cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors',
				isSelected
					? 'bg-muted font-medium text-foreground'
					: 'text-foreground/75 hover:bg-muted/60 hover:text-foreground',
			)}
			style={{ paddingLeft: ITEM_PADDING_LEFT }}
			onClick={() => onOpen(page)}
		>
			{icon}
			<span className='truncate'>{label}</span>
		</button>
	);
}

interface VirtualSkills {
	personal: PersonalSkill[];
	requests: ShareRequest[];
}

function useVirtualSkills(search: string, canReviewShares: boolean): VirtualSkills {
	const personal = useQuery(trpc.skill.listPersonal.queryOptions());
	const requests = useQuery({ ...trpc.skill.listShareRequests.queryOptions(), enabled: canReviewShares });
	const query = search.trim().toLowerCase();
	const matches = (name: string) => !query || name.toLowerCase().includes(query);
	return {
		personal: (personal.data ?? []).filter((skill) => matches(skill.name)),
		requests: (requests.data ?? []).filter((request) => matches(request.name)),
	};
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

function toTestItem(test: TestDefinition, selectedPath: string | null): NavigatorItem {
	const explorerPath = toExplorerTestPath(test.path);
	return {
		path: explorerPath,
		title: test.name,
		subtitle: null,
		tooltip: `${test.name} · ${TESTS_FOLDER}/${test.path}`,
		isSelected: explorerPath === selectedPath,
	};
}

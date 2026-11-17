import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import type {
	ContextHubContent,
	ContextHubDoc,
	ContextHubDocSection,
	ContextHubItem,
	ContextHubSection,
} from '@/lib/context-hub';
import { ContextHubSectionIcon } from '@/components/context-hub/context-hub-section-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useOpenRecommendationsByFile } from '@/hooks/use-context-recommendations';
import { useSession } from '@/lib/auth-client';
import { CONTEXT_HUB_DOC_SECTIONS, findContextHubItem, toThumbnailLines } from '@/lib/context-hub';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface FileSummary {
	path: string;
	title: string | null;
	description: string | null;
	owner: string | null;
	excerpt: string;
}

interface ListedFile {
	item: ContextHubItem;
	detail: string;
	title?: string;
}

const LIST_LIMIT = 10;
const THUMBNAIL_LIMIT = 12;
const RULES_DESCRIPTION =
	'The main orchestrator. The agent reads it at the start of every conversation: it sets how to answer and points to the tables, docs and skills to read for each topic.';
const BROWSED_SECTIONS: ReadonlyArray<Exclude<ContextHubDocSection, 'rules'>> = ['docs', 'metrics', 'skills'];
const SECTION_NOUNS: Record<Exclude<ContextHubDocSection, 'rules'>, string> = {
	docs: 'doc',
	metrics: 'metric',
	skills: 'skill',
};

/** What the doc view shows before a file is opened: where to start, what the agent uses and what changed. */
export function ContextHubOverview({
	content,
	onOpenFile,
	onNewSkill,
}: {
	content: ContextHubContent;
	onOpenFile: (path: string) => void;
	onNewSkill: () => void;
}) {
	const summaries = useQuery(trpc.contextExplorer.getFileSummaries.queryOptions());
	const summariesByPath = useMemo(
		() => new Map((summaries.data ?? []).map((summary) => [summary.path, summary])),
		[summaries.data],
	);
	const mostRead = useMostReadFiles(content);
	const rules = content.docs.find((doc) => doc.section === 'rules');

	return (
		<div className='h-full overflow-y-auto'>
			<div className='mx-auto flex w-full max-w-5xl flex-col gap-10 px-8 py-8'>
				<OverviewHeader content={content} />
				{rules && (
					<RulesCard
						summary={summariesByPath.get(rules.path)}
						readCount={mostRead.readCounts.get(rules.path)}
						onOpen={() => onOpenFile(rules.path)}
					/>
				)}
				<div className='grid gap-x-10 gap-y-8 lg:grid-cols-2'>
					<FileList
						title='Most read by the agent'
						meta='Last 30 days'
						files={mostRead.files}
						isLoading={mostRead.isLoading}
						emptyMessage='The agent has not read any of these files in the last 30 days.'
						onOpenFile={onOpenFile}
					/>
					<RecentChanges content={content} onOpenFile={onOpenFile} />
					<OwnedFiles
						content={content}
						summaries={summaries.data}
						isLoading={summaries.isLoading}
						onOpenFile={onOpenFile}
					/>
					<SuggestedChanges content={content} onOpenFile={onOpenFile} />
				</div>
				{BROWSED_SECTIONS.map((section) => (
					<ThumbnailSection
						key={section}
						section={section}
						docs={content.docs.filter((doc) => doc.section === section)}
						summariesByPath={summariesByPath}
						onOpenFile={onOpenFile}
						onNewSkill={section === 'skills' ? onNewSkill : undefined}
					/>
				))}
			</div>
		</div>
	);
}

function OverviewHeader({ content }: { content: ContextHubContent }) {
	const counts = [
		formatCount(content.tables.length, 'table'),
		...BROWSED_SECTIONS.map((section) =>
			formatCount(content.docs.filter((doc) => doc.section === section).length, SECTION_NOUNS[section]),
		),
	];

	return (
		<header className='flex flex-col gap-1'>
			<h1 className='text-lg font-semibold tracking-tight'>Overview</h1>
			<p className='text-sm text-muted-foreground'>{counts.join(' · ')}</p>
		</header>
	);
}

function RulesCard({
	summary,
	readCount,
	onOpen,
}: {
	summary: FileSummary | undefined;
	readCount: number | undefined;
	onOpen: () => void;
}) {
	return (
		<button
			type='button'
			onClick={onOpen}
			className='group flex cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-foreground/20'
		>
			<div className='hidden w-64 shrink-0 border-r bg-muted/40 p-4 sm:block'>
				<FileThumbnail excerpt={summary?.excerpt} className='h-36' />
			</div>
			<div className='flex min-w-0 flex-1 flex-col gap-2 p-5'>
				<div className='flex items-center gap-2'>
					<ContextHubSectionIcon section='rules' />
					<span className='text-xs font-medium text-muted-foreground'>Start here</span>
				</div>
				<h2 className='text-sm font-semibold'>RULES.md</h2>
				<p className='max-w-xl text-sm text-muted-foreground'>{RULES_DESCRIPTION}</p>
				<div className='mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground'>
					{readCount !== undefined && <span>{formatCount(readCount, 'read')} in the last 30 days</span>}
					<span className='ml-auto flex items-center gap-1 text-foreground/80 group-hover:text-foreground'>
						Open
						<ArrowRight className='size-3.5' />
					</span>
				</div>
			</div>
		</button>
	);
}

function RecentChanges({ content, onOpenFile }: { content: ContextHubContent; onOpenFile: (path: string) => void }) {
	const recentChanges = useQuery(trpc.contextExplorer.getRecentChanges.queryOptions());
	const changes = recentChanges.data?.changes;
	if (changes === null) {
		return null;
	}

	const files = (changes ?? []).flatMap((change): ListedFile[] => {
		const item = findContextHubItem(content, change.path);
		return item
			? [
					{
						item,
						detail: formatRelativeDate(new Date(change.changedAt)),
						title: `${change.message} — ${change.author}`,
					},
				]
			: [];
	});

	return (
		<FileList
			title='Recently changed'
			meta='From Git'
			files={files.slice(0, LIST_LIMIT)}
			isLoading={recentChanges.isLoading}
			emptyMessage='No recent change to these files.'
			onOpenFile={onOpenFile}
		/>
	);
}

function OwnedFiles({
	content,
	summaries,
	isLoading,
	onOpenFile,
}: {
	content: ContextHubContent;
	summaries: FileSummary[] | undefined;
	isLoading: boolean;
	onOpenFile: (path: string) => void;
}) {
	const email = useSession().data?.user.email.toLowerCase();
	const files = (summaries ?? []).flatMap((summary): ListedFile[] => {
		const item = email && summary.owner?.toLowerCase() === email ? findContextHubItem(content, summary.path) : null;
		return item ? [{ item, detail: getSectionLabel(item.section) }] : [];
	});

	return (
		<FileList
			title='Owned by you'
			meta={files.length > 0 ? formatCount(files.length, 'file') : undefined}
			files={files.slice(0, LIST_LIMIT)}
			isLoading={isLoading}
			emptyMessage='Files whose header names you as owner show here.'
			onOpenFile={onOpenFile}
		/>
	);
}

/** The files nao recommends changing, from what went wrong in real chats. */
function SuggestedChanges({ content, onOpenFile }: { content: ContextHubContent; onOpenFile: (path: string) => void }) {
	const { isEnabled, isLoading, recommendationsByFile } = useOpenRecommendationsByFile();
	if (!isEnabled) {
		return null;
	}

	const files = [...recommendationsByFile].flatMap(([path, recommendations]): ListedFile[] => {
		const item = findContextHubItem(content, path);
		return item
			? [
					{
						item,
						detail: formatCount(recommendations.length, 'suggestion'),
						title: recommendations.map((recommendation) => recommendation.title).join('\n'),
					},
				]
			: [];
	});

	return (
		<FileList
			title='Suggested by nao'
			meta='From real chats'
			files={files.slice(0, LIST_LIMIT)}
			isLoading={isLoading}
			emptyMessage='No open recommendation changes these files.'
			onOpenFile={onOpenFile}
		/>
	);
}

function FileList({
	title,
	meta,
	files,
	isLoading,
	emptyMessage,
	onOpenFile,
}: {
	title: string;
	meta?: string;
	files: ListedFile[];
	isLoading: boolean;
	emptyMessage: string;
	onOpenFile: (path: string) => void;
}) {
	return (
		<section className='flex min-w-0 flex-col gap-2'>
			<SectionHeading title={title} meta={meta} />
			{isLoading ? (
				<div className='flex flex-col gap-2 py-1'>
					{[0, 1, 2].map((index) => (
						<Skeleton key={index} className='h-6 w-full' />
					))}
				</div>
			) : files.length === 0 ? (
				<p className='py-2 text-xs text-muted-foreground'>{emptyMessage}</p>
			) : (
				<ul className='-mx-2 flex flex-col'>
					{files.map((file) => (
						<li key={file.item.path}>
							<button
								type='button'
								title={file.title}
								onClick={() => onOpenFile(file.item.path)}
								className='flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-muted/60'
							>
								<ContextHubSectionIcon section={file.item.section} className='size-4.5' />
								<span className='truncate'>{file.item.title}</span>
								{file.item.subtitle && (
									<span className='min-w-0 truncate text-xs text-muted-foreground'>
										{file.item.subtitle}
									</span>
								)}
								<span className='ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground'>
									{file.detail}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function ThumbnailSection({
	section,
	docs,
	summariesByPath,
	onOpenFile,
	onNewSkill,
}: {
	section: Exclude<ContextHubDocSection, 'rules'>;
	docs: ContextHubDoc[];
	summariesByPath: Map<string, FileSummary>;
	onOpenFile: (path: string) => void;
	onNewSkill?: () => void;
}) {
	if (docs.length === 0 && !onNewSkill) {
		return null;
	}

	return (
		<section className='flex flex-col gap-3'>
			<SectionHeading title={getSectionLabel(section)} />
			<div className='grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-4'>
				{docs.slice(0, THUMBNAIL_LIMIT).map((doc) => (
					<ThumbnailCard
						key={doc.path}
						title={summariesByPath.get(doc.path)?.title ?? doc.title}
						subtitle={doc.folder}
						excerpt={summariesByPath.get(doc.path)?.excerpt}
						onOpen={() => onOpenFile(doc.path)}
					/>
				))}
				{onNewSkill && (
					<button
						type='button'
						onClick={onNewSkill}
						className='flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground'
					>
						<Plus className='size-4' />
						New skill
					</button>
				)}
			</div>
		</section>
	);
}

function ThumbnailCard({
	title,
	subtitle,
	excerpt,
	onOpen,
}: {
	title: string;
	subtitle: string | null;
	excerpt: string | undefined;
	onOpen: () => void;
}) {
	return (
		<button type='button' onClick={onOpen} className='group flex min-w-0 cursor-pointer flex-col gap-2 text-left'>
			<FileThumbnail
				excerpt={excerpt}
				className='h-28 rounded-md border transition-colors group-hover:border-foreground/25'
			/>
			<div className='min-w-0 px-0.5'>
				<p className='truncate text-[13px]'>{title}</p>
				{subtitle && <p className='truncate text-xs text-muted-foreground'>{subtitle}</p>}
			</div>
		</button>
	);
}

/** A page-like preview of the start of a file, fading out at the bottom. */
function FileThumbnail({ excerpt, className }: { excerpt: string | undefined; className?: string }) {
	const lines = useMemo(() => (excerpt === undefined ? null : toThumbnailLines(excerpt)), [excerpt]);

	return (
		<div className={cn('relative overflow-hidden bg-background px-3 py-2.5', className)} aria-hidden='true'>
			{lines === null ? (
				<div className='flex flex-col gap-1.5'>
					<Skeleton className='h-2 w-2/3' />
					<Skeleton className='h-1.5 w-full' />
					<Skeleton className='h-1.5 w-5/6' />
				</div>
			) : (
				<div className='flex flex-col gap-0.5'>
					{lines.map((line, index) => (
						<p
							key={index}
							className={cn(
								'truncate',
								line.isHeading
									? 'pt-0.5 text-[9px] font-semibold text-foreground/80'
									: 'text-[8px] leading-[1.45] text-muted-foreground',
							)}
						>
							{line.text}
						</p>
					))}
				</div>
			)}
			<div className='pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background' />
		</div>
	);
}

function SectionHeading({ title, meta }: { title: string; meta?: ReactNode }) {
	return (
		<div className='flex items-baseline justify-between gap-3 border-b pb-2'>
			<h2 className='text-[13px] font-medium'>{title}</h2>
			{meta && <span className='text-xs text-muted-foreground'>{meta}</span>}
		</div>
	);
}

/** RULES.md is left out of the list: the agent reads it in every conversation, so its count shows on its own card. */
function useMostReadFiles(content: ContextHubContent) {
	const mostRead = useQuery(trpc.contextExplorer.getMostReadFiles.queryOptions());
	return useMemo(() => {
		const readFiles = mostRead.data?.files ?? [];
		const files = readFiles.flatMap((file): ListedFile[] => {
			const item = findContextHubItem(content, file.path);
			return item && item.section !== 'rules' ? [{ item, detail: formatCount(file.readCount, 'read') }] : [];
		});
		return {
			files: files.slice(0, LIST_LIMIT),
			readCounts: new Map(readFiles.map((file) => [file.path, file.readCount])),
			isLoading: mostRead.isLoading,
		};
	}, [content, mostRead.data, mostRead.isLoading]);
}

function getSectionLabel(section: ContextHubSection): string {
	return CONTEXT_HUB_DOC_SECTIONS.find((docSection) => docSection.key === section)?.label ?? 'Tables';
}

function formatCount(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

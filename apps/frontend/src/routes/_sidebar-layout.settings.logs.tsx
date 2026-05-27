import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, Terminal } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { LogLevel, LogSource } from '@nao/backend/log';

import type { LogsDateRange } from '@/components/settings/logs-date-range-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { LogsDateRangeFilter } from '@/components/settings/logs-date-range-filter';
import { cn } from '@/lib/utils';
import { trpc, trpcClient } from '@/main';

import { requireAdminNonCloud } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/logs')({
	beforeLoad: requireAdminNonCloud,
	component: LogsPage,
});

const POLL_INTERVAL_MS = 5000;
const MIN_REFRESH_MS = 400;
const PAGE_SIZE = 200;
const LOAD_MORE_TRIGGER_PX = 40;
const DEFAULT_RANGE_MINUTES = 60;

const LEVEL_STYLES: Record<LogLevel, string> = {
	error: 'bg-red-500/10 text-red-500',
	warn: 'bg-yellow-500/10 text-yellow-500',
	info: 'bg-blue-500/10 text-blue-500',
	debug: 'bg-muted text-muted-foreground',
};

const SOURCE_STYLES: Record<string, string> = {
	http: 'text-chart-3',
	agent: 'text-chart-1',
	tool: 'text-chart-2',
	system: 'text-chart-4',
};

type LogEntry = {
	id: string;
	level: LogLevel;
	source: LogSource;
	message: string;
	context?: Record<string, unknown> | null;
	createdAt: string | Date;
};

function LogsPage() {
	const [level, setLevel] = useState<LogLevel | 'all'>('all');
	const [source, setSource] = useState<LogSource | 'all'>('all');
	const [range, setRange] = useState<LogsDateRange | undefined>(() => ({
		from: new Date(Date.now() - DEFAULT_RANGE_MINUTES * 60 * 1000),
	}));
	const [olderEntries, setOlderEntries] = useState<LogEntry[]>([]);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [isLoadingOlder, setIsLoadingOlder] = useState(false);
	const [hasMoreOlder, setHasMoreOlder] = useState(true);
	const [autoScroll, setAutoScroll] = useState(true);
	const [showRefresh, setShowRefresh] = useState(false);
	const [copied, setCopied] = useState(false);
	const terminalRef = useRef<HTMLDivElement>(null);
	const loadingOlderRef = useRef(false);
	const prevScrollHeightRef = useRef<number | null>(null);
	const olderRequestIdRef = useRef(0);

	const filterParams = useMemo(
		() => ({
			level: level === 'all' ? undefined : level,
			source: source === 'all' ? undefined : source,
			from: range?.from,
			to: range?.to,
			limit: PAGE_SIZE,
		}),
		[level, source, range],
	);

	const logs = useQuery({
		...trpc.log.listLogs.queryOptions(filterParams),
		refetchInterval: range?.to ? false : POLL_INTERVAL_MS,
	});

	useEffect(() => {
		olderRequestIdRef.current += 1;
		loadingOlderRef.current = false;
		setIsLoadingOlder(false);
		setOlderEntries([]);
		setHasMoreOlder(true);
		setExpandedIds(new Set());
	}, [filterParams]);

	const sortedEntries = useMemo(() => {
		const baseEntries = (logs.data ?? []) as LogEntry[];
		const byId = new Map<string, LogEntry>();
		for (const e of olderEntries) {
			byId.set(e.id, e);
		}
		for (const e of baseEntries) {
			byId.set(e.id, e);
		}
		return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
	}, [olderEntries, logs.data]);

	useEffect(() => {
		if (autoScroll && terminalRef.current) {
			terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
		}
	}, [sortedEntries.length, autoScroll]);

	useEffect(() => {
		if (prevScrollHeightRef.current != null && terminalRef.current) {
			const delta = terminalRef.current.scrollHeight - prevScrollHeightRef.current;
			if (delta > 0) {
				terminalRef.current.scrollTop = delta + terminalRef.current.scrollTop;
			}
			prevScrollHeightRef.current = null;
		}
	}, [olderEntries]);

	const loadOlder = useCallback(async () => {
		if (loadingOlderRef.current || !hasMoreOlder) {
			return;
		}
		if (!sortedEntries.length) {
			return;
		}
		const oldest = sortedEntries[0];
		const before = new Date(oldest.createdAt);

		const requestId = ++olderRequestIdRef.current;
		loadingOlderRef.current = true;
		setIsLoadingOlder(true);
		if (terminalRef.current) {
			prevScrollHeightRef.current = terminalRef.current.scrollHeight;
		}
		try {
			const data = (await trpcClient.log.listLogs.query({
				...filterParams,
				before,
			})) as LogEntry[];
			if (requestId !== olderRequestIdRef.current) {
				return;
			}
			if (!data.length) {
				setHasMoreOlder(false);
				return;
			}
			setOlderEntries((prev) => {
				const map = new Map<string, LogEntry>();
				for (const e of prev) {
					map.set(e.id, e);
				}
				for (const e of data) {
					map.set(e.id, e);
				}
				return [...map.values()];
			});
			if (data.length < PAGE_SIZE) {
				setHasMoreOlder(false);
			}
		} catch {
			// Keep hasMoreOlder true so the user can retry after a transient failure.
		} finally {
			if (requestId === olderRequestIdRef.current) {
				loadingOlderRef.current = false;
				setIsLoadingOlder(false);
			}
		}
	}, [filterParams, hasMoreOlder, sortedEntries]);

	const handleScroll = () => {
		if (!terminalRef.current) {
			return;
		}
		const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
		setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
		if (scrollTop <= LOAD_MORE_TRIGGER_PX && hasMoreOlder && !loadingOlderRef.current) {
			void loadOlder();
		}
	};

	const handleRefresh = useCallback(() => {
		setShowRefresh(true);
		logs.refetch();
		setTimeout(() => setShowRefresh(false), MIN_REFRESH_MS);
	}, [logs]);

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	const handleCopy = useCallback(async () => {
		if (!sortedEntries.length) {
			return;
		}

		const text = sortedEntries
			.map((e) => {
				const d = new Date(e.createdAt);
				const ts = d.toLocaleTimeString('en-US', {
					hour12: false,
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
				});
				return `${ts} [${e.level.toUpperCase()}] [${e.source}] ${e.message}`;
			})
			.join('\n');

		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard write can fail on non-secure origins or denied permissions
		}
	}, [sortedEntries]);

	const formatTimestamp = (ts: string | Date) => {
		const d = new Date(ts);
		return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
	};

	const isRefreshing = showRefresh;

	return (
		<SettingsPageWrapper>
			<SettingsCard title='Logs' titleSize='lg' description='Real-time backend logs with auto-refresh.'>
				<div className='flex items-center gap-2 flex-wrap'>
					<Select value={level} onValueChange={(v) => setLevel(v as LogLevel | 'all')}>
						<SelectTrigger size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>All levels</SelectItem>
							<SelectItem value='error'>Error</SelectItem>
							<SelectItem value='warn'>Warn</SelectItem>
							<SelectItem value='info'>Info</SelectItem>
							<SelectItem value='debug'>Debug</SelectItem>
						</SelectContent>
					</Select>

					<Select value={source} onValueChange={(v) => setSource(v as LogSource | 'all')}>
						<SelectTrigger size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>All sources</SelectItem>
							<SelectItem value='http'>HTTP</SelectItem>
							<SelectItem value='agent'>Agent</SelectItem>
							<SelectItem value='tool'>Tool</SelectItem>
							<SelectItem value='system'>System</SelectItem>
						</SelectContent>
					</Select>

					<LogsDateRangeFilter value={range} onChange={setRange} />

					<div className='flex-1' />

					<Button variant='outline' size='sm' onClick={handleCopy} disabled={!sortedEntries.length}>
						{copied ? (
							<>
								<Copy className='size-3.5' />
								Copied
							</>
						) : (
							<>
								<Copy className='size-3.5' />
								Copy
							</>
						)}
					</Button>
					<Button variant='outline' size='sm' onClick={handleRefresh} disabled={isRefreshing}>
						{isRefreshing ? (
							<TextShimmer text='Refreshing...' />
						) : (
							<>
								<RefreshCw className='size-3.5' />
								Refresh
							</>
						)}
					</Button>
				</div>

				<div
					ref={terminalRef}
					onScroll={handleScroll}
					className='rounded-lg bg-background border border-border font-mono text-xs overflow-auto max-h-[480px] min-h-[300px]'
				>
					{logs.isLoading ? (
						<div className='flex items-center justify-center h-[280px]'>
							<TextShimmer text='Loading logs...' />
						</div>
					) : logs.isError ? (
						<div className='flex flex-col items-center justify-center h-[280px] gap-2 text-muted-foreground'>
							<Terminal className='size-8 opacity-30' />
							<span className='text-sm'>Failed to load logs.</span>
							<Button variant='outline' size='sm' onClick={handleRefresh}>
								Retry
							</Button>
						</div>
					) : !sortedEntries.length ? (
						<div className='flex flex-col items-center justify-center h-[280px] gap-2 text-muted-foreground'>
							<Terminal className='size-8 opacity-30' />
							<span className='text-sm'>No logs yet.</span>
						</div>
					) : (
						<div className='flex flex-col p-1'>
							<LoadMoreHeader isLoading={isLoadingOlder} hasMore={hasMoreOlder} onClick={loadOlder} />
							{sortedEntries.map((entry) => (
								<LogRow
									key={entry.id}
									entry={entry}
									expanded={expandedIds.has(entry.id)}
									onToggle={() => toggleExpand(entry.id)}
									formatTimestamp={formatTimestamp}
								/>
							))}
						</div>
					)}
				</div>
			</SettingsCard>
		</SettingsPageWrapper>
	);
}

type LoadMoreHeaderProps = {
	isLoading: boolean;
	hasMore: boolean;
	onClick: () => void;
};

function LoadMoreHeader({ isLoading, hasMore, onClick }: LoadMoreHeaderProps) {
	if (!hasMore) {
		return (
			<div className='flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground'>
				No more older logs
			</div>
		);
	}
	return (
		<button
			type='button'
			onClick={onClick}
			disabled={isLoading}
			className='flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-md cursor-pointer disabled:cursor-default'
		>
			{isLoading ? (
				<>
					<Loader2 className='size-3 animate-spin' />
					Loading older logs…
				</>
			) : (
				<>Pull down or click to load older logs</>
			)}
		</button>
	);
}

type LogRowProps = {
	entry: LogEntry;
	expanded: boolean;
	onToggle: () => void;
	formatTimestamp: (ts: string | Date) => string;
};

function LogRow({ entry, expanded, onToggle, formatTimestamp }: LogRowProps) {
	const messageRef = useRef<HTMLSpanElement>(null);
	const [isTruncated, setIsTruncated] = useState(false);
	const hasContext = Boolean(entry.context && Object.keys(entry.context).length);
	const isClickable = isTruncated || hasContext;

	useEffect(() => {
		const el = messageRef.current;
		if (!el) {
			return;
		}
		if (expanded) {
			return;
		}
		const measure = () => setIsTruncated(el.scrollWidth > el.clientWidth + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [entry.message, expanded]);

	const handleClick = () => {
		if (isClickable) {
			onToggle();
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (!isClickable) {
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggle();
		}
	};

	return (
		<div
			role={isClickable ? 'button' : undefined}
			tabIndex={isClickable ? 0 : undefined}
			aria-expanded={isClickable ? expanded : undefined}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			className={cn(
				'flex flex-col gap-1 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors',
				isClickable && 'cursor-pointer',
			)}
		>
			<div className='flex items-start gap-2'>
				<span className='text-muted-foreground shrink-0 tabular-nums leading-5'>
					{formatTimestamp(entry.createdAt)}
				</span>
				<Badge
					variant='ghost'
					className={cn(
						'uppercase text-[10px] px-1.5 py-0 rounded-md font-semibold shrink-0 mt-0.5',
						LEVEL_STYLES[entry.level],
					)}
				>
					{entry.level}
				</Badge>
				<span
					className={cn(
						'text-[10px] shrink-0 font-medium leading-5',
						SOURCE_STYLES[entry.source] ?? 'text-muted-foreground',
					)}
				>
					{entry.source}
				</span>
				<span
					ref={messageRef}
					className={cn(
						'text-foreground/80 min-w-0 flex-1',
						expanded ? 'whitespace-pre-wrap break-words' : 'truncate',
					)}
				>
					{entry.message}
				</span>
				{isClickable && (
					<span className='text-muted-foreground shrink-0 mt-0.5'>
						{expanded ? <ChevronDown className='size-3.5' /> : <ChevronRight className='size-3.5' />}
					</span>
				)}
			</div>
			{expanded && hasContext && (
				<pre className='mt-1 ml-[7.5rem] max-w-full overflow-x-auto rounded-md border border-border bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-words text-foreground/80'>
					{JSON.stringify(entry.context, null, 2)}
				</pre>
			)}
		</div>
	);
}

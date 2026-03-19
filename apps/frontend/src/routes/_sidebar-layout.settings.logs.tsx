import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Copy, RefreshCw, Terminal } from 'lucide-react';
import type { LogLevel, LogSource } from '@nao/backend/log';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/logs')({
	component: LogsPage,
});

const POLL_INTERVAL_MS = 5000;
const MIN_REFRESH_MS = 400;

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

function LogsPage() {
	const [level, setLevel] = useState<LogLevel | 'all'>('all');
	const [source, setSource] = useState<LogSource | 'all'>('all');
	const [autoScroll, setAutoScroll] = useState(true);
	const [showRefresh, setShowRefresh] = useState(false);
	const [copied, setCopied] = useState(false);
	const terminalRef = useRef<HTMLDivElement>(null);

	const logs = useQuery({
		...trpc.log.getLogs.queryOptions({
			level: level === 'all' ? undefined : level,
			source: source === 'all' ? undefined : source,
			limit: 200,
		}),
		refetchInterval: POLL_INTERVAL_MS,
	});

	const entries = logs.data ?? [];
	const sortedEntries = [...entries].reverse();

	useEffect(() => {
		if (autoScroll && terminalRef.current) {
			terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
		}
	}, [sortedEntries.length, autoScroll]);

	const handleScroll = () => {
		if (!terminalRef.current) {
			return;
		}
		const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
		setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
	};

	const handleRefresh = useCallback(() => {
		setShowRefresh(true);
		logs.refetch();
		setTimeout(() => setShowRefresh(false), MIN_REFRESH_MS);
	}, [logs]);

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
		<SettingsCard title='Logs' titleSize='lg' description='Real-time backend logs with auto-refresh.'>
			{/* Filter bar - left aligned */}
			<div className='flex items-center gap-2'>
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

				<div className='flex-1' />

				{/* Actions - right side */}
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

			{/* Terminal */}
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
						{sortedEntries.map((entry) => (
							<div
								key={entry.id}
								className='flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors'
							>
								<span className='text-muted-foreground shrink-0 tabular-nums'>
									{formatTimestamp(entry.createdAt)}
								</span>
								<Badge
									variant='ghost'
									className={cn(
										'uppercase text-[10px] px-1.5 py-0 rounded-md font-semibold shrink-0',
										LEVEL_STYLES[entry.level],
									)}
								>
									{entry.level}
								</Badge>
								<span
									className={cn(
										'text-[10px] shrink-0 font-medium',
										SOURCE_STYLES[entry.source] ?? 'text-muted-foreground',
									)}
								>
									{entry.source}
								</span>
								<span className='text-foreground/80 truncate'>{entry.message}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</SettingsCard>
	);
}

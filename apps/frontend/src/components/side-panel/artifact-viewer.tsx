import { useState, useMemo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Streamdown } from 'streamdown';
import { Editor } from '@monaco-editor/react';
import { ChevronDown, ChevronLeft, ChevronRight, Code, Eye, FileText } from 'lucide-react';
import { ArtifactChartEmbed } from './artifact-chart-embed';
import type { ArtifactVersion } from '@/lib/artifact.utils';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgentContext } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { collectArtifactVersions, findArtifacts } from '@/lib/artifact.utils';
import { getLocalArtifactVersions, subscribe as subscribeArtifactStore } from '@/lib/artifact.store';

type ViewMode = 'preview' | 'code';

interface ArtifactViewerProps {
	artifactId: string;
	initialVersions: ArtifactVersion[];
}

export function ArtifactViewer({ artifactId, initialVersions }: ArtifactViewerProps) {
	const { messages } = useAgentContext();
	const { open: openSidePanel } = useSidePanel();
	const [viewMode, setViewMode] = useState<ViewMode>('preview');
	const [selectedVersionIndex, setSelectedVersionIndex] = useState<number>(initialVersions.length - 1);

	const localVersionCount = useSyncExternalStore(
		subscribeArtifactStore,
		() => getLocalArtifactVersions(artifactId).length,
	);

	const versions = useMemo(
		() => collectArtifactVersions(messages, artifactId),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[messages, artifactId, localVersionCount],
	);

	const allArtifacts = useMemo(() => findArtifacts(messages), [messages]);

	useEffect(() => {
		setSelectedVersionIndex(versions.length - 1);
	}, [versions.length]);

	const currentVersion = versions[selectedVersionIndex] ?? versions.at(-1);

	const goToPreviousVersion = useCallback(() => {
		setSelectedVersionIndex((i) => Math.max(0, i - 1));
	}, []);

	const goToNextVersion = useCallback(() => {
		setSelectedVersionIndex((i) => Math.min(versions.length - 1, i + 1));
	}, [versions.length]);

	const switchArtifact = useCallback(
		(id: string) => {
			const nextVersions = collectArtifactVersions(messages, id);
			openSidePanel(<ArtifactViewer artifactId={id} initialVersions={nextVersions} />);
		},
		[messages, openSidePanel],
	);

	if (!currentVersion) {
		return (
			<div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
				No artifact content available.
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col'>
			<ArtifactHeader
				title={currentVersion.title}
				artifactId={artifactId}
				allArtifacts={allArtifacts}
				onSwitchArtifact={switchArtifact}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentVersion={selectedVersionIndex + 1}
				totalVersions={versions.length}
				onPreviousVersion={goToPreviousVersion}
				onNextVersion={goToNextVersion}
			/>

			<div className='flex-1 min-h-0 overflow-auto'>
				{viewMode === 'preview' ? (
					<ArtifactPreview code={currentVersion.code} />
				) : (
					<ArtifactCodeView code={currentVersion.code} />
				)}
			</div>
		</div>
	);
}

function ArtifactHeader({
	title,
	artifactId,
	allArtifacts,
	onSwitchArtifact,
	viewMode,
	onViewModeChange,
	currentVersion,
	totalVersions,
	onPreviousVersion,
	onNextVersion,
}: {
	title: string;
	artifactId: string;
	allArtifacts: { id: string; title: string }[];
	onSwitchArtifact: (id: string) => void;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	currentVersion: number;
	totalVersions: number;
	onPreviousVersion: () => void;
	onNextVersion: () => void;
}) {
	const otherArtifacts = allArtifacts.filter((a) => a.id !== artifactId);
	const hasMultiple = otherArtifacts.length > 0;

	return (
		<div className='flex items-center gap-2 border-b px-4 py-3 shrink-0'>
			{hasMultiple ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type='button'
							className='flex items-center gap-1 min-w-0 flex-1 cursor-pointer hover:text-foreground/80 transition-colors focus:outline-none'
						>
							<h3 className='text-sm font-medium truncate'>{title}</h3>
							<ChevronDown className='size-3 shrink-0 text-muted-foreground' />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='start'>
						{otherArtifacts.map((artifact) => (
							<DropdownMenuItem key={artifact.id} onClick={() => onSwitchArtifact(artifact.id)}>
								<FileText className='size-3.5' />
								<span className='truncate'>{artifact.title}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<h3 className='text-sm font-medium truncate flex-1'>{title}</h3>
			)}

			{totalVersions > 1 && (
				<div className='flex items-center gap-1'>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						onClick={onPreviousVersion}
						disabled={currentVersion <= 1}
					>
						<ChevronLeft className='size-3' />
					</Button>
					<span className='text-xs text-muted-foreground tabular-nums min-w-12 text-center'>
						v{currentVersion}/{totalVersions}
					</span>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						onClick={onNextVersion}
						disabled={currentVersion >= totalVersions}
					>
						<ChevronRight className='size-3' />
					</Button>
				</div>
			)}

			<div className='flex items-center rounded-lg border p-0.5 gap-0.5'>
				<Button
					variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
					size='icon-xs'
					onClick={() => onViewModeChange('preview')}
				>
					<Eye className='size-3' />
				</Button>
				<Button
					variant={viewMode === 'code' ? 'secondary' : 'ghost'}
					size='icon-xs'
					onClick={() => onViewModeChange('code')}
				>
					<Code className='size-3' />
				</Button>
			</div>
		</div>
	);
}

interface ParsedChartBlock {
	queryId: string;
	chartType: string;
	xAxisKey: string;
	xAxisType: string | null;
	series: Array<{ data_key: string; color: string; label?: string }>;
	title: string;
}

function parseChartAttributes(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrRegex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g;
	let match;
	while ((match = attrRegex.exec(attrString)) !== null) {
		attrs[match[1]] = match[2] ?? match[3];
	}
	return attrs;
}

function parseChartBlock(attrString: string): ParsedChartBlock | null {
	const attrs = parseChartAttributes(attrString);
	if (!attrs.query_id || !attrs.chart_type || !attrs.x_axis_key) {
		return null;
	}

	const series: ParsedChartBlock['series'] = [];
	if (attrs.series) {
		try {
			const parsed = JSON.parse(attrs.series);
			if (Array.isArray(parsed)) {
				series.push(...parsed);
			}
		} catch {
			/* ignore malformed series */
		}
	} else if (attrs.data_key) {
		series.push({
			data_key: attrs.data_key,
			color: attrs.color || 'var(--chart-1)',
			label: attrs.label,
		});
	}

	return {
		queryId: attrs.query_id,
		chartType: attrs.chart_type,
		xAxisKey: attrs.x_axis_key,
		xAxisType: attrs.x_axis_type || null,
		series,
		title: attrs.title || '',
	};
}

function ArtifactPreview({ code }: { code: string }) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	return (
		<div className='p-6 flex flex-col gap-4'>
			<SegmentList segments={segments} />
		</div>
	);
}

function SegmentList({ segments }: { segments: Segment[] }) {
	return (
		<>
			{segments.map((segment, i) => {
				switch (segment.type) {
					case 'markdown':
						return (
							<Streamdown key={i} mode='static'>
								{segment.content}
							</Streamdown>
						);
					case 'chart':
						return <ArtifactChartEmbed key={i} chart={segment.chart} />;
					case 'grid':
						return <ArtifactGrid key={i} cols={segment.cols} children={segment.children} />;
				}
			})}
		</>
	);
}

const GRID_CLASSES: Record<number, string> = {
	1: 'grid-cols-1',
	2: 'grid-cols-1 @sm:grid-cols-2',
	3: 'grid-cols-1 @sm:grid-cols-2 @xl:grid-cols-3',
	4: 'grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4',
};

function ArtifactGrid({ cols, children }: { cols: number; children: Segment[] }) {
	const gridClass = GRID_CLASSES[Math.min(cols, 4)] ?? GRID_CLASSES[2];

	return (
		<div className='@container'>
			<div className={`grid ${gridClass} gap-4`}>
				{children.map((segment, i) => (
					<div key={i} className='min-w-0'>
						{segment.type === 'markdown' ? (
							<Streamdown mode='static'>{segment.content}</Streamdown>
						) : segment.type === 'chart' ? (
							<ArtifactChartEmbed chart={segment.chart} />
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}

type Segment =
	| { type: 'markdown'; content: string }
	| { type: 'chart'; chart: ParsedChartBlock }
	| { type: 'grid'; cols: number; children: Segment[] };

function splitCodeIntoSegments(code: string): Segment[] {
	const segments: Segment[] = [];
	const blockRegex = /<grid\s+([^>]*)>([\s\S]*?)<\/grid>|<chart\s+([^/>]*)\/?>/g;
	let match;
	let lastIndex = 0;

	while ((match = blockRegex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			const md = code.slice(lastIndex, match.index).trim();
			if (md) {
				segments.push({ type: 'markdown', content: md });
			}
		}

		if (match[1] !== undefined && match[2] !== undefined) {
			const gridAttrs = parseChartAttributes(match[1]);
			const cols = parseInt(gridAttrs.cols || '2', 10);
			const gridChildren = splitCodeIntoSegments(match[2]);
			segments.push({ type: 'grid', cols, children: gridChildren });
		} else if (match[3] !== undefined) {
			const chart = parseChartBlock(match[3]);
			if (chart) {
				segments.push({ type: 'chart', chart });
			}
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < code.length) {
		const md = code.slice(lastIndex).trim();
		if (md) {
			segments.push({ type: 'markdown', content: md });
		}
	}

	return segments;
}

function ArtifactCodeView({ code }: { code: string }) {
	return (
		<div className='h-full'>
			<Editor
				value={code}
				language='markdown'
				theme='light'
				options={{
					minimap: { enabled: false },
					folding: true,
					lineNumbers: 'on',
					scrollbar: { horizontal: 'auto', vertical: 'auto' },
					scrollBeyondLastLine: false,
					padding: { top: 16, bottom: 16 },
					wordWrap: 'on',
					readOnly: true,
				}}
			/>
		</div>
	);
}

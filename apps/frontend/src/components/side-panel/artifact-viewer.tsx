import { useState, useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Streamdown } from 'streamdown';
import { Editor } from '@monaco-editor/react';
import { useMutation } from '@tanstack/react-query';
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Eye,
	Pencil,
	FileText,
	Save,
	Share2,
	Check,
	Loader2,
	RotateCcw,
} from 'lucide-react';
import { ArtifactChartEmbed } from './artifact-chart-embed';
import { ArtifactEditor, getEditorMarkdown } from './artifact-editor';
import type { ArtifactVersion } from '@/lib/artifact.utils';
import type { UIMessage } from '@nao/backend/chat';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { Segment } from '@/lib/artifact-segments';
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
import {
	addLocalArtifactVersion,
	getLocalArtifactVersions,
	subscribe as subscribeArtifactStore,
} from '@/lib/artifact.store';
import { splitCodeIntoSegments } from '@/lib/artifact-segments';
import { collectQueryDataFromMessages } from '@/lib/artifact-share.utils';
import { trpc } from '@/main';

type ViewMode = 'preview' | 'edit' | 'code';

interface ArtifactViewerProps {
	artifactId: string;
	initialVersions: ArtifactVersion[];
}

export function ArtifactViewer({ artifactId, initialVersions }: ArtifactViewerProps) {
	const { messages } = useAgentContext();
	const { open: openSidePanel } = useSidePanel();
	const [viewMode, setViewMode] = useState<ViewMode>('preview');
	const [selectedVersionIndex, setSelectedVersionIndex] = useState<number>(initialVersions.length - 1);
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);

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

	const handleSave = useCallback(() => {
		const editor = tiptapEditorRef.current;
		if (!editor || !currentVersion) {
			return;
		}

		const newCode = getEditorMarkdown(editor);
		if (newCode === currentVersion.code) {
			setViewMode('preview');

			return;
		}

		addLocalArtifactVersion(artifactId, {
			version: (versions.at(-1)?.version ?? 0) + 1,
			code: newCode,
			title: currentVersion.title,
			action: 'replace',
		});

		setViewMode('preview');
	}, [artifactId, currentVersion, versions]);

	const isViewingLatest = selectedVersionIndex === versions.length - 1;

	const handleRestore = useCallback(() => {
		if (!currentVersion || isViewingLatest) {
			return;
		}

		addLocalArtifactVersion(artifactId, {
			version: (versions.at(-1)?.version ?? 0) + 1,
			code: currentVersion.code,
			title: currentVersion.title,
			action: 'replace',
		});
	}, [artifactId, currentVersion, isViewingLatest, versions]);

	const shareArtifact = useShareArtifact(messages);

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
				isViewingLatest={isViewingLatest}
				onRestore={handleRestore}
				onSave={handleSave}
				shareState={shareArtifact}
				onShare={() => shareArtifact.share(currentVersion.title, currentVersion.code)}
			/>

			<div className='flex-1 min-h-0 overflow-auto'>
				{viewMode === 'preview' ? (
					<ArtifactPreview code={currentVersion.code} />
				) : viewMode === 'edit' ? (
					<ArtifactEditor code={currentVersion.code} editorRef={tiptapEditorRef} />
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
	isViewingLatest,
	onRestore,
	onSave,
	shareState,
	onShare,
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
	isViewingLatest: boolean;
	onRestore: () => void;
	onSave: () => void;
	shareState: ShareArtifactState;
	onShare: () => void;
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

			{!isViewingLatest && totalVersions > 1 && (
				<Button variant='outline' size='sm' onClick={onRestore} className='gap-1.5'>
					<RotateCcw className='size-3' />
					<span>Restore</span>
				</Button>
			)}

			{viewMode === 'edit' && (
				<Button variant='default' size='sm' onClick={onSave} className='gap-1.5'>
					<Save className='size-3' />
					<span>Save</span>
				</Button>
			)}

			<Button
				variant='ghost-muted'
				size='icon-xs'
				onClick={onShare}
				disabled={shareState.isPending}
				aria-label='Share artifact'
			>
				{shareState.isPending ? (
					<Loader2 className='size-3 animate-spin' />
				) : shareState.isCopied ? (
					<Check className='size-3 text-green-500' />
				) : (
					<Share2 className='size-3' />
				)}
			</Button>

			<div className='flex items-center rounded-lg border p-0.5 gap-0.5'>
				<Button
					variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
					size='icon-xs'
					onClick={() => onViewModeChange('preview')}
				>
					<Eye className='size-3' />
				</Button>
				<Button
					variant={viewMode === 'edit' ? 'secondary' : 'ghost'}
					size='icon-xs'
					onClick={() => onViewModeChange('edit')}
				>
					<Pencil className='size-3' />
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

interface ShareArtifactState {
	isPending: boolean;
	isCopied: boolean;
	share: (title: string, code: string) => void;
}

function useShareArtifact(messages: UIMessage[]): ShareArtifactState {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const mutation = useMutation(
		trpc.sharedArtifact.create.mutationOptions({
			onSuccess: (data) => {
				const url = `${window.location.origin}/shared/${data.id}`;
				navigator.clipboard.writeText(url);
				setIsCopied(true);
				clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => setIsCopied(false), 2500);
			},
		}),
	);

	const share = useCallback(
		(title: string, code: string) => {
			const queryData = collectQueryDataFromMessages(messages, code);
			mutation.mutate({ title, code, queryData });
		},
		[messages, mutation],
	);

	return { isPending: mutation.isPending, isCopied, share };
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

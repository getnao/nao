import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Editor } from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Eye,
	Pencil,
	FileText,
	Save,
	Check,
	Loader2,
	RotateCcw,
	Share,
} from 'lucide-react';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryEditor, getEditorMarkdown } from './story-editor';
import type { StorySummary } from '@/lib/story.utils';
import type { UIMessage } from '@nao/backend/chat';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { SegmentList } from '@/components/story-rendering';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgentContext } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { findStories } from '@/lib/story.utils';
import { splitCodeIntoSegments } from '@/lib/story-segments';
import { collectQueryDataFromMessages } from '@/lib/story-share.utils';
import { trpc } from '@/main';

type ViewMode = 'preview' | 'edit' | 'code';

interface StoryViewerProps {
	chatId: string;
	storyId: string;
}

export function StoryViewer({ chatId, storyId }: StoryViewerProps) {
	const { messages, status } = useAgentContext();
	const { open: openSidePanel } = useSidePanel();
	const queryClient = useQueryClient();
	const [viewMode, setViewMode] = useState<ViewMode>('preview');
	const [selectedVersionIndex, setSelectedVersionIndex] = useState<number>(-1);
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);

	const versionsQuery = useQuery(trpc.story.listVersions.queryOptions({ chatId, storyId }));
	const versions = versionsQuery.data ?? [];

	const isAgentRunning = status === 'streaming' || status === 'submitted';
	const prevIsRunning = useRef(isAgentRunning);
	useEffect(() => {
		if (prevIsRunning.current && !isAgentRunning) {
			versionsQuery.refetch();
		}
		prevIsRunning.current = isAgentRunning;
	}, [isAgentRunning, versionsQuery]);

	useEffect(() => {
		setSelectedVersionIndex(versions.length - 1);
	}, [versions.length]);

	const allStories = useMemo(() => findStories(messages), [messages]);

	const currentVersion = versions[selectedVersionIndex] ?? versions.at(-1);

	const goToPreviousVersion = useCallback(() => {
		setSelectedVersionIndex((i) => Math.max(0, i - 1));
	}, []);

	const goToNextVersion = useCallback(() => {
		setSelectedVersionIndex((i) => Math.min(versions.length - 1, i + 1));
	}, [versions.length]);

	const switchStory = useCallback(
		(id: string) => {
			openSidePanel(<StoryViewer chatId={chatId} storyId={id} />, id);
		},
		[chatId, openSidePanel],
	);

	const createVersionMutation = useMutation(
		trpc.story.createVersion.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storyId }) });
			},
		}),
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

		createVersionMutation.mutate({
			chatId,
			storyId,
			title: currentVersion.title,
			code: newCode,
			action: 'replace',
		});

		setViewMode('preview');
	}, [chatId, storyId, currentVersion, createVersionMutation]);

	const isViewingLatest = selectedVersionIndex === versions.length - 1;

	const handleRestore = useCallback(() => {
		if (!currentVersion || isViewingLatest) {
			return;
		}

		createVersionMutation.mutate({
			chatId,
			storyId,
			title: currentVersion.title,
			code: currentVersion.code,
			action: 'replace',
		});
	}, [chatId, storyId, currentVersion, isViewingLatest, createVersionMutation]);

	const shareStory = useShareStory(messages);

	if (!currentVersion) {
		return (
			<div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
				No Story content available.
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col'>
			<StoryHeader
				title={currentVersion.title}
				storyId={storyId}
				allStories={allStories}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentVersion={selectedVersionIndex + 1}
				totalVersions={versions.length}
				onPreviousVersion={goToPreviousVersion}
				onNextVersion={goToNextVersion}
				isViewingLatest={isViewingLatest}
				onRestore={handleRestore}
				onSave={handleSave}
				shareState={shareStory}
				onShare={() => shareStory.share(currentVersion.title, currentVersion.code)}
			/>

			<div className='flex-1 min-h-0 overflow-auto'>
				{viewMode === 'preview' ? (
					<StoryPreview code={currentVersion.code} />
				) : viewMode === 'edit' ? (
					<StoryEditor code={currentVersion.code} editorRef={tiptapEditorRef} />
				) : (
					<StoryCodeView code={currentVersion.code} />
				)}
			</div>
		</div>
	);
}

function StoryHeader({
	title,
	storyId,
	allStories,
	onSwitchStory,
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
	storyId: string;
	allStories: StorySummary[];
	onSwitchStory: (id: string) => void;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	currentVersion: number;
	totalVersions: number;
	onPreviousVersion: () => void;
	onNextVersion: () => void;
	isViewingLatest: boolean;
	onRestore: () => void;
	onSave: () => void;
	shareState: ShareStoryState;
	onShare: () => void;
}) {
	const otherStories = allStories.filter((s) => s.id !== storyId);
	const hasMultiple = otherStories.length > 0;

	const showSubHeader = viewMode === 'edit' || !isViewingLatest;

	return (
		<div className='shrink-0'>
			<div className='flex items-center gap-2 border-b px-4 py-3'>
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
							{otherStories.map((story) => (
								<DropdownMenuItem key={story.id} onClick={() => onSwitchStory(story.id)}>
									<FileText className='size-3.5' />
									<span className='truncate'>{story.title}</span>
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
						<span className='text-xs text-muted-foreground tabular-nums min-w-6 text-center'>
							{currentVersion}/{totalVersions}
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

				<Button
					variant='ghost-muted'
					size='icon-xs'
					onClick={onShare}
					disabled={shareState.isPending}
					aria-label='Share Story'
				>
					{shareState.isPending ? (
						<Loader2 className='size-3 animate-spin' />
					) : shareState.isCopied ? (
						<Check className='size-3 text-green-500' />
					) : (
						<Share className='size-3' />
					)}
				</Button>
			</div>

			{showSubHeader && (
				<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2'>
					{viewMode === 'edit' ? (
						<>
							<span className='text-xs text-muted-foreground'>Editing</span>
							<div className='flex items-center gap-2'>
								<Button variant='outline' size='sm' onClick={() => onViewModeChange('preview')}>
									Cancel
								</Button>
								<Button variant='default' size='sm' onClick={onSave} className='gap-1.5'>
									<Save className='size-3' />
									<span>Save</span>
								</Button>
							</div>
						</>
					) : (
						<>
							<span className='text-xs text-muted-foreground'>
								Viewing v{currentVersion} of {totalVersions}
							</span>
							<Button variant='outline' size='sm' onClick={onRestore} className='gap-1.5'>
								<RotateCcw className='size-3' />
								<span>Restore</span>
							</Button>
						</>
					)}
				</div>
			)}
		</div>
	);
}

function StoryPreview({ code }: { code: string }) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	return (
		<div className='p-6 flex flex-col gap-4'>
			<SegmentList segments={segments} renderChart={(chart) => <StoryChartEmbed chart={chart} />} />
		</div>
	);
}

interface ShareStoryState {
	isPending: boolean;
	isCopied: boolean;
	share: (title: string, code: string) => void;
}

function useShareStory(messages: UIMessage[]): ShareStoryState {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const mutation = useMutation(
		trpc.storyShare.create.mutationOptions({
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

function StoryCodeView({ code }: { code: string }) {
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

import { useCallback, useMemo, useState } from 'react';
import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDefaultLayout } from 'react-resizable-panels';

import type { FileSelectionOptions } from '@/components/settings/file-tree';

import { ContextFileDiff } from '@/components/settings/context-file-diff';
import { ContextGitPanel } from '@/components/settings/context-git-panel';
import { FileTree } from '@/components/settings/file-tree';
import { FileViewer } from '@/components/settings/file-viewer';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';
import { trpc } from '@/main';

const contentSearchStorage = createLocalStorage<boolean>('nao-file-explorer-content-search', true);

type ViewerTarget = { type: 'file'; path: string; openSource: boolean } | { type: 'diff'; path: string };
type SourceAutoOpenRequest = { path: string; id: number };

export const Route = createFileRoute('/_sidebar-layout/settings/context-explorer')({
	beforeLoad: requireContextAdminOrAdmin,
	component: ContextExplorerPage,
});

function ContextExplorerPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
	const [pendingViewerTarget, setPendingViewerTarget] = useState<ViewerTarget | null>(null);
	const [sourceAutoOpenRequest, setSourceAutoOpenRequest] = useState<SourceAutoOpenRequest | null>(null);
	const [viewerRevision, setViewerRevision] = useState(0);
	const [isViewerDirty, setIsViewerDirty] = useState(false);
	const [search, setSearch] = useState('');
	const [isContentSearchEnabled, setIsContentSearchEnabled] = useLocalStorage(contentSearchStorage);
	const trimmedSearch = search.trim();
	const contentSearchQuery = trimmedSearch.slice(0, 200);
	const debouncedSearch = useDebouncedValue(contentSearchQuery, 250);
	const isLiveContentSearchEligible = isContentSearchEnabled && trimmedSearch.length >= 2;
	const shouldSearchContent = isContentSearchEnabled && debouncedSearch.length >= 2;
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: 'context-explorer',
		storage: localStorage,
	});
	const shouldBlockNavigation = useCallback(() => isViewerDirty, [isViewerDirty]);
	const navigationBlocker = useBlocker({
		shouldBlockFn: shouldBlockNavigation,
		enableBeforeUnload: isViewerDirty,
		disabled: !isViewerDirty,
		withResolver: true,
	});

	const fileTree = useQuery(trpc.contextExplorer.getFileTree.queryOptions());
	const fileContent = useQuery({
		...trpc.contextExplorer.readFile.queryOptions({ path: selectedPath! }),
		enabled: !!selectedPath,
	});
	const contentSearch = useQuery({
		...trpc.contextExplorer.searchContent.queryOptions({ query: debouncedSearch }),
		enabled: shouldSearchContent,
		placeholderData: keepPreviousData,
	});
	const isContentSearchPending =
		isLiveContentSearchEligible && (contentSearchQuery !== debouncedSearch || contentSearch.isFetching);
	const contentMatches = useMemo(() => {
		if (!isLiveContentSearchEligible || !shouldSearchContent) {
			return new Map();
		}
		return new Map(
			(contentSearch.data?.results ?? []).map((match) => [
				match.path,
				{ count: match.count, line: match.line, text: match.text },
			]),
		);
	}, [contentSearch.data?.results, isLiveContentSearchEligible, shouldSearchContent]);

	const requestSourceAutoOpen = (path: string) => {
		setSourceAutoOpenRequest((current) => ({ path, id: (current?.id ?? 0) + 1 }));
	};

	const applyViewerTarget = (target: ViewerTarget) => {
		if (target.type === 'file') {
			setSelectedPath(target.path);
			setSelectedDiffPath(null);
			if (target.openSource) {
				requestSourceAutoOpen(target.path);
			} else {
				setSourceAutoOpenRequest(null);
			}
			return;
		}
		setSelectedDiffPath(target.path);
	};

	const requestViewerTarget = (target: ViewerTarget) => {
		if (isViewerDirty) {
			setPendingViewerTarget(target);
			return;
		}
		applyViewerTarget(target);
	};

	const handleSelectFile = (path: string, options: FileSelectionOptions) => {
		if (path === selectedPath && selectedDiffPath === null) {
			if (options.isContentMatch) {
				requestSourceAutoOpen(path);
			}
			return;
		}
		requestViewerTarget({ type: 'file', path, openSource: options.isContentMatch });
	};

	const handleViewDiff = (path: string) => {
		if (path === selectedDiffPath) {
			return;
		}
		requestViewerTarget({ type: 'diff', path });
	};

	const handleChangesCommitted = async (paths: string[]) => {
		if (!selectedDiffPath || !paths.includes(selectedDiffPath)) {
			return;
		}
		const committedDiffPath = selectedDiffPath;
		setSelectedDiffPath(null);
		await queryClient.cancelQueries({
			queryKey: trpc.contextExplorer.getFileDiff.queryKey({ path: committedDiffPath }),
		});
	};

	const handleDiscardAndChangeView = () => {
		if (!pendingViewerTarget) {
			return;
		}
		setIsViewerDirty(false);
		applyViewerTarget(pendingViewerTarget);
		setPendingViewerTarget(null);
	};

	const handleLocalChangeDiscarded = async (path: string) => {
		if (selectedDiffPath === path) {
			setSelectedDiffPath(null);
		}
		if (selectedPath !== path) {
			return;
		}
		setIsViewerDirty(false);
		await queryClient.invalidateQueries({
			queryKey: trpc.contextExplorer.readFile.queryKey({ path }),
		});
		setViewerRevision((current) => current + 1);
	};

	const handleAllLocalChangesDiscarded = async () => {
		setSelectedDiffPath(null);
		setIsViewerDirty(false);
		if (selectedPath) {
			await queryClient.invalidateQueries({
				queryKey: trpc.contextExplorer.readFile.queryKey({ path: selectedPath }),
			});
			setViewerRevision((current) => current + 1);
		}
	};

	const handleRepositoryChanged = () => {
		setSelectedPath(null);
		setSelectedDiffPath(null);
		setSourceAutoOpenRequest(null);
		setIsViewerDirty(false);
		setViewerRevision((current) => current + 1);
	};

	const handleDiscardAndNavigate = () => {
		if (navigationBlocker.status !== 'blocked') {
			return;
		}
		setIsViewerDirty(false);
		navigationBlocker.proceed();
	};

	return (
		<div className='flex flex-col flex-1 overflow-hidden'>
			<ResizablePanelGroup
				orientation='horizontal'
				className='flex-1 min-h-0'
				defaultLayout={defaultLayout ?? { tree: 1.1, viewer: 5 }}
				onLayoutChanged={onLayoutChanged}
			>
				<ResizablePanel id='tree' minSize={180}>
					<div className='flex h-full flex-col overflow-hidden bg-card'>
						{fileTree.isLoading ? (
							<div className='flex items-center justify-center h-32'>
								<Spinner />
							</div>
						) : fileTree.isError ? (
							<div className='flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2'>
								<p>Failed to load files</p>
								<Button variant='outline' size='sm' onClick={() => fileTree.refetch()}>
									Retry
								</Button>
							</div>
						) : (
							<>
								<div className='min-h-40 flex-1 overflow-hidden'>
									<FileTree
										entries={fileTree.data?.entries ?? []}
										selectedPath={selectedDiffPath ?? selectedPath}
										onSelectFile={handleSelectFile}
										search={search}
										onSearchChange={setSearch}
										isContentSearchEnabled={isContentSearchEnabled}
										onContentSearchEnabledChange={setIsContentSearchEnabled}
										contentMatches={contentMatches}
										isContentSearchPending={isContentSearchPending}
										contentSearchFailed={shouldSearchContent && contentSearch.isError}
										contentSearchTruncated={
											isLiveContentSearchEligible &&
											shouldSearchContent &&
											!isContentSearchPending &&
											!contentSearch.isPlaceholderData &&
											contentSearch.data?.truncated === true
										}
									/>
								</div>
								<ContextGitPanel
									selectedDiffPath={selectedDiffPath}
									hasUnsavedFileChanges={isViewerDirty}
									onViewDiff={handleViewDiff}
									onCommitted={handleChangesCommitted}
									onDiscarded={handleLocalChangeDiscarded}
									onDiscardAll={handleAllLocalChangesDiscarded}
									onRepositoryChanged={handleRepositoryChanged}
								/>
							</>
						)}
					</div>
				</ResizablePanel>

				<ResizableSeparator />

				<ResizablePanel id='viewer' minSize={300}>
					<div className='h-full bg-background'>
						{selectedDiffPath ? (
							<ContextFileDiff path={selectedDiffPath} />
						) : (
							<FileViewer
								key={`${selectedPath ?? 'empty'}:${viewerRevision}`}
								filePath={selectedPath}
								content={fileContent.data?.content}
								hash={fileContent.data?.hash}
								isLoading={fileContent.isLoading && fileContent.fetchStatus !== 'idle'}
								isError={fileContent.isError && !fileContent.data}
								isEditable={fileContent.data?.isEditable === true}
								editabilityGuidance={fileContent.data?.guidance ?? null}
								searchQuery={shouldSearchContent ? debouncedSearch : ''}
								sourceAutoOpenRequestId={
									sourceAutoOpenRequest?.path === selectedPath ? sourceAutoOpenRequest.id : null
								}
								onDirtyChange={setIsViewerDirty}
								onOpenGuidancePath={(path, kind) => {
									if (kind === 'route') {
										void navigate({ to: path });
										return;
									}
									requestViewerTarget({ type: 'file', path, openSource: false });
								}}
								onReload={async () => {
									const result = await fileContent.refetch();
									if (result.error) {
										throw result.error;
									}
									return result.data;
								}}
							/>
						)}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
			<DiscardChangesDialog
				open={pendingViewerTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingViewerTarget(null);
					}
				}}
				onDiscard={handleDiscardAndChangeView}
			/>
			<DiscardChangesDialog
				open={navigationBlocker.status === 'blocked'}
				onOpenChange={(open) => {
					if (!open && navigationBlocker.status === 'blocked') {
						navigationBlocker.reset();
					}
				}}
				onDiscard={handleDiscardAndNavigate}
			/>
		</div>
	);
}

function DiscardChangesDialog({
	open,
	onOpenChange,
	onDiscard,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDiscard: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
					<AlertDialogDescription>
						Continuing will discard the changes you made to this file.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep editing</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						onClick={(event) => {
							event.preventDefault();
							onDiscard();
						}}
					>
						Discard changes
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

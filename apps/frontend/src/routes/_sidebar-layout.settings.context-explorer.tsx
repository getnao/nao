import { useCallback, useMemo, useState } from 'react';
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDefaultLayout } from 'react-resizable-panels';

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
import { requireAdmin } from '@/lib/require-admin';
import { trpc } from '@/main';

const contentSearchStorage = createLocalStorage<boolean>('nao-file-explorer-content-search', true);

export const Route = createFileRoute('/_sidebar-layout/settings/context-explorer')({
	beforeLoad: requireAdmin,
	component: ContextExplorerPage,
});

function ContextExplorerPage() {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [pendingSelectedPath, setPendingSelectedPath] = useState<string | null>(null);
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

	const handleSelectFile = (path: string) => {
		if (path === selectedPath) {
			return;
		}
		if (isViewerDirty) {
			setPendingSelectedPath(path);
			return;
		}
		setSelectedPath(path);
	};

	const handleDiscardAndSelect = () => {
		setIsViewerDirty(false);
		setSelectedPath(pendingSelectedPath);
		setPendingSelectedPath(null);
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
					<div className='h-full overflow-hidden bg-card'>
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
							<FileTree
								entries={fileTree.data?.entries ?? []}
								selectedPath={selectedPath}
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
						)}
					</div>
				</ResizablePanel>

				<ResizableSeparator />

				<ResizablePanel id='viewer' minSize={300}>
					<div className='h-full bg-background'>
						<FileViewer
							filePath={selectedPath}
							content={fileContent.data?.content}
							hash={fileContent.data?.hash}
							isLoading={fileContent.isLoading && fileContent.fetchStatus !== 'idle'}
							isError={fileContent.isError && !fileContent.data}
							isEditable={fileTree.data?.isEditable === true}
							searchQuery={shouldSearchContent ? debouncedSearch : ''}
							onDirtyChange={setIsViewerDirty}
							onReload={async () => {
								const result = await fileContent.refetch();
								if (result.error) {
									throw result.error;
								}
								return result.data;
							}}
						/>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
			<DiscardChangesDialog
				open={pendingSelectedPath !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingSelectedPath(null);
					}
				}}
				onDiscard={handleDiscardAndSelect}
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

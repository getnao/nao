import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import type { ContextHubView } from '@/hooks/use-context-hub-view';
import type { ContextHubContent } from '@/lib/context-hub';
import { ContextHubChatPanel, useContextHubChatPanelOpen } from '@/components/context-hub/context-hub-chat-panel';
import { ContextHubNavigator } from '@/components/context-hub/context-hub-navigator';
import { ContextHubOverview } from '@/components/context-hub/context-hub-overview';
import { ContextHubViewMenu } from '@/components/context-hub/context-hub-view-menu';
import { ContextHubViewer } from '@/components/context-hub/context-hub-viewer';
import { NewSkillDialog } from '@/components/context-hub/new-skill-dialog';
import { OpenEditorChatButton } from '@/components/editor-chat-panel';
import { ContextGitPanel } from '@/components/settings/context-git-panel';
import { ContextSidebar } from '@/components/settings/context-sidebar';
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
import { FileExplorerWorktreeProvider } from '@/contexts/file-explorer-worktree';
import { useRegisterOpenContextFileCallback } from '@/contexts/open-context-file-callback';
import { useContextChanges } from '@/hooks/use-context-changes';
import {
	buildContextHubContent,
	findTableOfPath,
	groupTablesByLocation,
	matchesContextHubDoc,
	matchesContextHubTable,
} from '@/lib/context-hub';
import { invalidateExplorerQueries } from '@/lib/context-explorer-queries';
import { trpc } from '@/main';

/** What the right column shows: a table or doc page, nothing, or a change picked in the Changes tab. */
type ViewerTarget = { type: 'file'; path: string | null } | { type: 'diff'; path: string };

/** A diff stays shown only while the URL points at the file it was opened over, so Back and Forward replace it. */
interface ShownDiff {
	path: string;
	requestedPath: string | null;
}

/**
 * The doc view of the Context Hub: the tables and docs the agent knows, by section, with a chat to edit them. It is
 * laid out like the file tree, so switching between them keeps the same frame.
 */
export function ContextDocView({
	requestedPath,
	onSwitchView,
}: {
	requestedPath: string | null;
	/** Absent for people who only get the doc view. */
	onSwitchView?: (view: ContextHubView, openPath: string | null) => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState('');
	const [isDirty, setIsDirty] = useState(false);
	const [shownDiff, setShownDiff] = useState<ShownDiff | null>(null);
	const diffPath = shownDiff?.requestedPath === requestedPath ? shownDiff.path : null;
	const [pendingTarget, setPendingTarget] = useState<ViewerTarget | null>(null);
	const [isNewSkillOpen, setIsNewSkillOpen] = useState(false);
	const [isChatOpen, setIsChatOpen] = useContextHubChatPanelOpen();
	const changedFileCount = useContextChanges().changedFiles.data?.length ?? 0;
	const fileTree = useQuery(trpc.contextExplorer.getFileTree.queryOptions());
	const content = useMemo(() => buildContextHubContent(fileTree.data?.entries ?? []), [fileTree.data]);
	const tables = useMemo(
		() => content.tables.filter((table) => matchesContextHubTable(table, search)),
		[content.tables, search],
	);
	const tableFolders = useMemo(() => groupTablesByLocation(tables, content.tables), [tables, content.tables]);
	const docs = useMemo(() => content.docs.filter((doc) => matchesContextHubDoc(doc, search)), [content.docs, search]);
	const openPath = isKnownPath(content, requestedPath) ? requestedPath : null;
	const unlistedRequestedPath = fileTree.isSuccess && requestedPath !== openPath ? requestedPath : null;
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'context-explorer', storage: localStorage });
	const isShowingTargetRef = useRef(false);
	const navigationBlocker = useBlocker({
		shouldBlockFn: ({ current, next }) => isDirty && !isShowingTargetRef.current && leavesOpenFile(current, next),
		enableBeforeUnload: isDirty,
		disabled: !isDirty,
		withResolver: true,
	});

	const showTarget = (target: ViewerTarget) => {
		setIsDirty(false);
		if (target.type === 'diff') {
			setShownDiff({ path: target.path, requestedPath });
			return;
		}
		setShownDiff(null);
		isShowingTargetRef.current = true;
		void navigate({ to: '.', search: target.path ? { path: target.path } : {} }).finally(() => {
			isShowingTargetRef.current = false;
		});
	};

	const requestTarget = (target: ViewerTarget) => {
		if (isDirty) {
			setPendingTarget(target);
			return;
		}
		showTarget(target);
	};

	const openFile = (path: string) => requestTarget({ type: 'file', path });

	useRegisterOpenContextFileCallback(openFile, [openFile]);

	useEffect(() => {
		if (unlistedRequestedPath && onSwitchView) {
			onSwitchView('files', unlistedRequestedPath);
		}
	}, [unlistedRequestedPath, onSwitchView]);

	const refreshChanges = async () => {
		setShownDiff(null);
		await invalidateExplorerQueries(queryClient);
	};

	const handleSkillCreated = async (path: string) => {
		await invalidateExplorerQueries(queryClient);
		requestTarget({ type: 'file', path });
	};

	const handleRepositoryChanged = () => showTarget({ type: 'file', path: null });

	return (
		<FileExplorerWorktreeProvider
			value={{ hasUnsavedFileChanges: isDirty, onRepositoryChanged: handleRepositoryChanged }}
		>
			<div className='relative flex min-h-0 min-w-0 flex-1 overflow-hidden'>
				<ResizablePanelGroup
					orientation='horizontal'
					className='min-h-0 flex-1'
					defaultLayout={defaultLayout ?? { tree: 1.1, viewer: 5 }}
					onLayoutChanged={onLayoutChanged}
				>
					<ResizablePanel id='tree' minSize={180}>
						<ContextSidebar
							filesLabel='Context'
							onSelectFiles={() => requestTarget({ type: 'file', path: null })}
							changeCount={changedFileCount}
							viewMenu={
								<div className='flex shrink-0 items-center gap-0.5'>
									<OpenEditorChatButton
										isOpen={isChatOpen}
										isCompact
										onOpen={() => setIsChatOpen(true)}
									/>
									{onSwitchView && (
										<ContextHubViewMenu
											view='docs'
											isDirty={isDirty}
											onSwitchView={(view) => onSwitchView(view, openPath)}
										/>
									)}
								</div>
							}
							files={
								fileTree.isLoading ? (
									<div className='flex h-32 items-center justify-center'>
										<Spinner />
									</div>
								) : fileTree.isError ? (
									<div className='flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
										<p>Failed to load the context</p>
										<Button variant='outline' size='sm' onClick={() => fileTree.refetch()}>
											Retry
										</Button>
									</div>
								) : (
									<ContextHubNavigator
										tableFolders={tableFolders}
										docs={docs}
										search={search}
										selectedPath={diffPath ? null : openPath}
										onSearchChange={setSearch}
										onOpenFile={openFile}
										onNewSkill={() => setIsNewSkillOpen(true)}
									/>
								)
							}
							changes={
								<ContextGitPanel
									selectedDiffPath={diffPath}
									selectedUpstreamDiffPath={null}
									hasUnsavedFileChanges={isDirty}
									onViewDiff={(path) => requestTarget({ type: 'diff', path })}
									onCommitted={refreshChanges}
									onDiscarded={refreshChanges}
									onDiscardAll={refreshChanges}
									onRepositoryChanged={handleRepositoryChanged}
								/>
							}
						/>
					</ResizablePanel>

					<ResizableSeparator />

					<ResizablePanel id='viewer' minSize={300}>
						<div className='h-full bg-background'>
							{openPath || diffPath ? (
								<ContextHubViewer
									table={findTableOfPath(content.tables, openPath)}
									doc={content.docs.find((doc) => doc.path === openPath) ?? null}
									path={openPath}
									diffPath={diffPath}
									isDirty={isDirty}
									onOpenFile={openFile}
									onDirtyChange={setIsDirty}
								/>
							) : (
								<ContextHubOverview
									content={content}
									onOpenFile={openFile}
									onNewSkill={() => setIsNewSkillOpen(true)}
								/>
							)}
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
				<ContextHubChatPanel openPath={openPath} isOpen={isChatOpen} onOpenChange={setIsChatOpen} />

				<NewSkillDialog
					open={isNewSkillOpen}
					onOpenChange={setIsNewSkillOpen}
					onCreated={(path) => void handleSkillCreated(path)}
				/>
				<DiscardChangesDialog
					open={pendingTarget !== null || navigationBlocker.status === 'blocked'}
					onKeepEditing={() => {
						setPendingTarget(null);
						if (navigationBlocker.status === 'blocked') {
							navigationBlocker.reset();
						}
					}}
					onDiscard={() => {
						setIsDirty(false);
						if (navigationBlocker.status === 'blocked') {
							navigationBlocker.proceed();
							return;
						}
						if (pendingTarget) {
							showTarget(pendingTarget);
							setPendingTarget(null);
						}
					}}
				/>
			</div>
		</FileExplorerWorktreeProvider>
	);
}

function DiscardChangesDialog({
	open,
	onKeepEditing,
	onDiscard,
}: {
	open: boolean;
	onKeepEditing: () => void;
	onDiscard: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onKeepEditing()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
					<AlertDialogDescription>
						You have edits that are not saved yet. Continuing will discard them.
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

/** Back and Forward move between files through the search, which would replace the edited file. */
function leavesOpenFile(
	current: { pathname: string; search: object },
	next: { pathname: string; search: object },
): boolean {
	return current.pathname !== next.pathname || getSearchPath(current.search) !== getSearchPath(next.search);
}

function getSearchPath(search: object): unknown {
	return 'path' in search ? search.path : undefined;
}

/** Only the tables and docs the hub lists open in it, so a link to another context file shows nothing. */
function isKnownPath(content: ContextHubContent, path: string | null): path is string {
	return (
		path !== null &&
		(content.docs.some((doc) => doc.path === path) || findTableOfPath(content.tables, path) !== null)
	);
}

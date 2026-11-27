import { TESTS_FOLDER } from '@nao/shared/test-paths';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import type { ShownContextHubPage } from '@nao/backend/chat';
import type { SkillPage } from '@/components/context-hub/context-hub-skill-page';
import type { ContextHubView } from '@/hooks/use-context-hub-view';
import type { ContextExplorerSearch, DocViewTestsPage } from '@/lib/context-explorer-search';
import type { ContextHubContent } from '@/lib/context-hub';
import { ContextHubChatPanel, useContextHubChatPanelOpen } from '@/components/context-hub/context-hub-chat-panel';
import { ContextHubNavigator } from '@/components/context-hub/context-hub-navigator';
import { ContextHubOverview } from '@/components/context-hub/context-hub-overview';
import { DiscardChangesDialog } from '@/components/context-hub/discard-changes-dialog';
import { ContextHubSkillPage, isSameSkillPage } from '@/components/context-hub/context-hub-skill-page';
import { ContextHubTestPage, ContextHubTestSuite } from '@/components/context-hub/context-hub-tests';
import { ContextHubViewMenu } from '@/components/context-hub/context-hub-view-menu';
import { ContextHubViewer } from '@/components/context-hub/context-hub-viewer';
import { OpenEditorChatButton } from '@/components/editor-chat-panel';
import { NewSkillButton, NewSkillDialog, useNewSkillScope } from '@/components/personal-skills';
import { ContextGitPanel } from '@/components/settings/context-git-panel';
import { ContextSidebar } from '@/components/settings/context-sidebar';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { FileExplorerWorktreeProvider } from '@/contexts/file-explorer-worktree';
import { useRegisterOpenContextFileCallback } from '@/contexts/open-context-file-callback';
import { useContextChanges } from '@/hooks/use-context-changes';
import { useTestSuite } from '@/hooks/use-upstream-context';
import { invalidateExplorerQueries } from '@/lib/context-explorer-queries';
import { getDocViewTestsPage } from '@/lib/context-explorer-search';
import {
	buildContextHubContent,
	findTableOfPath,
	groupTablesByLocation,
	matchesContextHubDoc,
	matchesContextHubTable,
	matchesContextHubTest,
} from '@/lib/context-hub';
import { trpc } from '@/main';

/** What the right column shows: a table or doc page, nothing, a change picked in the Changes tab, or the tests. */
type ViewerTarget =
	| { type: 'skill'; page: SkillPage }
	| { type: 'file'; path: string | null }
	| { type: 'diff'; path: string }
	| { type: 'tests'; runId?: string }
	| { type: 'test'; path: string; runId?: string };

/** A diff stays shown only while the URL points at the file it was opened over, so Back and Forward replace it. */
interface ShownDiff {
	path: string;
	requestedPath: string | null;
}

/**
 * The doc view of the Context Hub: the tables and docs the agent knows, by section, with a chat to edit them and the
 * tests that check them. It is laid out like the file tree, so switching between them keeps the same frame.
 */
export function ContextDocView({
	search: contextSearch,
	onSwitchView,
}: {
	search: ContextExplorerSearch;
	/** Absent for people who only get the doc view. */
	onSwitchView?: (view: ContextHubView, openPath: string | null) => void;
}) {
	const testsPage = getDocViewTestsPage(contextSearch);
	const requestedPath = testsPage ? null : (contextSearch.path ?? null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState('');
	const [isDirty, setIsDirty] = useState(false);
	const [shownDiff, setShownDiff] = useState<ShownDiff | null>(null);
	const diffPath = shownDiff?.requestedPath === requestedPath ? shownDiff.path : null;
	const [pendingTarget, setPendingTarget] = useState<ViewerTarget | null>(null);
	const [isNewSkillOpen, setIsNewSkillOpen] = useState(false);
	const [newSkillScope, setNewSkillScope] = useNewSkillScope();
	const isSkillsLinkOpen = contextSearch.skills === 'open';
	const linkedSkillName = contextSearch.skill;
	const [skillPage, setSkillPage] = useState<SkillPage | null>(
		linkedSkillName ? { type: 'personal', name: linkedSkillName } : isSkillsLinkOpen ? { type: 'all' } : null,
	);
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
	const allTests = useTestSuite().data?.tests;
	const tests = useMemo(() => allTests?.filter((test) => matchesContextHubTest(test, search)), [allTests, search]);
	const openPath = isKnownPath(content, requestedPath) ? requestedPath : null;
	const unlistedRequestedPath = fileTree.isSuccess && requestedPath !== openPath ? requestedPath : null;
	const selectedNavigatorPath = diffPath ? null : testsPage ? getTestsPagePath(testsPage) : openPath;
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
		if (target.type === 'skill') {
			setSkillPage(target.page);
			return;
		}
		setSkillPage(null);
		if (target.type === 'diff') {
			setShownDiff({ path: target.path, requestedPath });
			return;
		}
		setShownDiff(null);
		isShowingTargetRef.current = true;
		void navigate({ to: '.', search: toTargetSearch(target) }).finally(() => {
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
	const openSkillPage = (page: SkillPage) => requestTarget({ type: 'skill', page });
	const openTests = (runId?: string) => requestTarget({ type: 'tests', runId });
	const openTest = (path: string, runId?: string) => requestTarget({ type: 'test', path, runId });

	useRegisterOpenContextFileCallback(openFile, [openFile]);

	useEffect(() => {
		if (isSkillsLinkOpen) {
			setSkillPage({ type: 'all' });
		}
	}, [isSkillsLinkOpen]);

	/** Back and Forward follow the link: leaving the skill it named closes that skill, unless another page replaced it. */
	const previousLinkedSkillNameRef = useRef(linkedSkillName);
	useEffect(() => {
		const previousName = previousLinkedSkillNameRef.current;
		previousLinkedSkillNameRef.current = linkedSkillName;
		if (linkedSkillName) {
			setSkillPage({ type: 'personal', name: linkedSkillName });
		} else if (previousName) {
			setSkillPage((current) =>
				isSameSkillPage(current, { type: 'personal', name: previousName }) ? null : current,
			);
		}
	}, [linkedSkillName]);

	useEffect(() => {
		if (unlistedRequestedPath && onSwitchView) {
			onSwitchView('files', unlistedRequestedPath);
		}
	}, [unlistedRequestedPath, onSwitchView]);

	const refreshChanges = async () => {
		setShownDiff(null);
		await invalidateExplorerQueries(queryClient);
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
										tests={tests}
										search={search}
										selectedPath={skillPage ? null : selectedNavigatorPath}
										onSearchChange={setSearch}
										onOpenFile={openFile}
										onOpenTests={() => openTests()}
										onOpenTest={openTest}
										onNewSkill={() => setIsNewSkillOpen(true)}
										skillPage={skillPage}
										onOpenSkillPage={openSkillPage}
									/>
								)
							}
							changes={
								!fileTree.data?.isManagedRepository ? (
									<ContextGitPanel
										selectedDiffPath={diffPath}
										selectedUpstreamDiffPath={null}
										hasUnsavedFileChanges={isDirty}
										onViewDiff={(path) => requestTarget({ type: 'diff', path })}
										onCommitted={refreshChanges}
										onDiscarded={refreshChanges}
										onDiscardAll={refreshChanges}
										onRepositoryChanged={handleRepositoryChanged}
										onOpenTests={() => openTests()}
									/>
								) : undefined
							}
						/>
					</ResizablePanel>

					<ResizableSeparator />

					<ResizablePanel id='viewer' minSize={300}>
						<div className='h-full bg-background'>
							{skillPage ? (
								<ContextHubSkillPage
									page={skillPage}
									onOpenPage={openSkillPage}
									onDirtyChange={setIsDirty}
									onOpenFile={openFile}
									newSkillAction={
										<NewSkillButton
											scope={newSkillScope}
											canCreateTeamSkill
											onScopeChange={setNewSkillScope}
											onCreate={() => setIsNewSkillOpen(true)}
										/>
									}
								/>
							) : diffPath === null && testsPage?.type === 'test' ? (
								<ContextHubTestPage
									key={testsPage.path}
									testPath={testsPage.path}
									selectedRunId={contextSearch.testRun ?? null}
									onSelectRun={(runId) => showTarget({ ...testsPage, runId: runId ?? undefined })}
									onOpenSuite={() => showTarget({ type: 'tests' })}
									onOpenSuiteRun={(runId) => showTarget({ type: 'tests', runId })}
									onEditFile={onSwitchView && (() => onSwitchView('files', testsPage.path))}
								/>
							) : diffPath === null && testsPage?.type === 'suite' ? (
								<ContextHubTestSuite
									selectedRunId={contextSearch.testRun ?? null}
									onSelectRun={(runId) => showTarget({ type: 'tests', runId: runId ?? undefined })}
									onOpenTest={openTest}
								/>
							) : openPath || diffPath ? (
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
				<ContextHubChatPanel
					shown={getShownPage({ skillPage, diffPath, testsPage, testRun: contextSearch.testRun, openPath })}
					isOpen={isChatOpen}
					onOpenChange={setIsChatOpen}
				/>

				<NewSkillDialog
					open={isNewSkillOpen}
					scope={newSkillScope}
					canCreateTeamSkill
					onScopeChange={setNewSkillScope}
					onClose={() => setIsNewSkillOpen(false)}
					onCreated={(skill) =>
						skill.scope === 'personal'
							? openSkillPage({ type: 'personal', name: skill.name })
							: openFile(skill.path)
					}
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

function toTargetSearch(target: Exclude<ViewerTarget, { type: 'diff' | 'skill' }>): ContextExplorerSearch {
	switch (target.type) {
		case 'file':
			return { path: target.path ?? undefined };
		case 'tests':
			return { tests: 'open', testRun: target.runId };
		case 'test':
			return { test: target.path, testRun: target.runId };
	}
}

/** What the viewer shows, in the order it picks it, for the chat beside the hub to know what the user looks at. */
function getShownPage({
	skillPage,
	diffPath,
	testsPage,
	testRun,
	openPath,
}: {
	skillPage: SkillPage | null;
	diffPath: string | null;
	testsPage: DocViewTestsPage | null;
	testRun: string | undefined;
	openPath: string | null;
}): ShownContextHubPage {
	if (skillPage) {
		return toShownSkillPage(skillPage);
	}
	if (diffPath) {
		return { type: 'change', path: diffPath };
	}
	if (testsPage?.type === 'test') {
		return { type: 'test', path: testsPage.path, runId: testRun ?? null };
	}
	if (testsPage?.type === 'suite') {
		return { type: 'tests', runId: testRun ?? null };
	}
	return openPath ? { type: 'file', path: openPath } : { type: 'overview' };
}

function toShownSkillPage(page: SkillPage): ShownContextHubPage {
	switch (page.type) {
		case 'all':
			return { type: 'skills' };
		case 'personal':
			return { type: 'personal-skill', name: page.name };
		case 'request':
			return { type: 'share-request', id: page.id };
	}
}

/** The tests are not files of the context, so the navigator marks them by their place in the tests folder. */
function getTestsPagePath(testsPage: DocViewTestsPage): string {
	return testsPage.type === 'test' ? testsPage.path : `/${TESTS_FOLDER}`;
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

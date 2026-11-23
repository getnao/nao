import { useQuery } from '@tanstack/react-query';
import { Hammer, Inbox, User } from 'lucide-react';
import { useState } from 'react';

import type { ReactNode } from 'react';
import {
	NewSkillButton,
	NewSkillDialog,
	PERSONAL_ICON_CLASS_NAME,
	PersonalSkillEditor,
	ShareRequestReview,
	SkillsLibrary,
} from '@/components/personal-skills';
import { ContextHubSkillsNavigator } from '@/components/context-hub/context-hub-navigator';
import { DiscardChangesDialog } from '@/components/context-hub/discard-changes-dialog';
import { EditorTab, TabBar } from '@/components/settings/sortable-tabs';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

/** A page of the Skills section with no file behind it: the library, a personal skill or a share request. */
export type SkillPage = { type: 'all' } | { type: 'personal'; name: string } | { type: 'request'; id: string };

interface ContextHubSkillPageProps {
	page: SkillPage;
	onOpenPage: (page: SkillPage) => void;
	/** Opens a project skill's file; absent for members, who only see the skills, not the files. */
	onOpenFile?: (path: string) => void;
	/** The button creating a skill, shown at the top of the skills library. */
	newSkillAction: ReactNode;
	onDirtyChange?: (isDirty: boolean) => void;
}

export function ContextHubSkillPage({
	page,
	onOpenPage,
	onOpenFile,
	newSkillAction,
	onDirtyChange,
}: ContextHubSkillPageProps) {
	const label = useSkillPageLabel(page);

	return (
		<div className='flex h-full flex-col'>
			<TabBar
				label='Opened skill page'
				trailing={
					page.type !== 'all' && (
						<span className='flex items-center gap-1.5 px-3 text-xs whitespace-nowrap text-muted-foreground'>
							<PageIcon page={page} />
							Stored in nao, not in the context files
						</span>
					)
				}
			>
				<EditorTab label={label} isActive isUnsaved={false} onSelect={() => undefined} />
			</TabBar>
			<div className='min-h-0 flex-1 overflow-auto'>
				<SkillPageContent
					page={page}
					onOpenPage={onOpenPage}
					onOpenFile={onOpenFile}
					newSkillAction={newSkillAction}
					onDirtyChange={onDirtyChange}
				/>
			</div>
		</div>
	);
}

/** The Context Hub of members whose groups grant personal skills: their skills and the team's, without the files. */
export function ContextHubSkillsView() {
	const [page, setPage] = useState<SkillPage>({ type: 'all' });
	const [isNewSkillOpen, setIsNewSkillOpen] = useState(false);
	const [isDirty, setIsDirty] = useState(false);
	const [pendingPage, setPendingPage] = useState<SkillPage | null>(null);
	const openNewSkill = () => setIsNewSkillOpen(true);
	const openPage = (nextPage: SkillPage) => (isDirty ? setPendingPage(nextPage) : setPage(nextPage));

	return (
		<div className='flex h-full min-h-0'>
			<aside className='flex w-64 shrink-0 flex-col border-r bg-panel'>
				<p className='flex h-10 shrink-0 items-center border-b px-4 text-sm font-medium'>Context Hub</p>
				<ContextHubSkillsNavigator skillPage={page} onOpenSkillPage={openPage} onNewSkill={openNewSkill} />
			</aside>
			<div className='min-w-0 flex-1 bg-background'>
				<ContextHubSkillPage
					page={page}
					onOpenPage={openPage}
					onDirtyChange={setIsDirty}
					newSkillAction={
						<NewSkillButton
							scope='personal'
							canCreateTeamSkill={false}
							onScopeChange={() => undefined}
							onCreate={openNewSkill}
						/>
					}
				/>
			</div>
			<NewSkillDialog
				open={isNewSkillOpen}
				scope='personal'
				canCreateTeamSkill={false}
				onScopeChange={() => undefined}
				onClose={() => setIsNewSkillOpen(false)}
				onCreated={(skill) => skill.scope === 'personal' && openPage({ type: 'personal', name: skill.name })}
			/>
			<DiscardChangesDialog
				open={pendingPage !== null}
				onKeepEditing={() => setPendingPage(null)}
				onDiscard={() => {
					setIsDirty(false);
					setPage(pendingPage ?? page);
					setPendingPage(null);
				}}
			/>
		</div>
	);
}

export function isSameSkillPage(selected: SkillPage | null, page: SkillPage): boolean {
	return selected !== null && getSkillPageKey(selected) === getSkillPageKey(page);
}

function SkillPageContent({ page, onOpenPage, onOpenFile, newSkillAction, onDirtyChange }: ContextHubSkillPageProps) {
	const canReviewShares = onOpenFile !== undefined;
	const personalSkills = useQuery(trpc.skill.listPersonal.queryOptions());
	const shareRequests = useQuery({ ...trpc.skill.listShareRequests.queryOptions(), enabled: canReviewShares });
	const openAll = () => onOpenPage({ type: 'all' });

	if (page.type === 'personal') {
		const skill = personalSkills.data?.find((candidate) => candidate.name === page.name);
		return (
			<div className='mx-auto w-full max-w-5xl px-8 py-8'>
				{skill && (
					<PersonalSkillEditor
						key={skill.name}
						skill={skill}
						onDeleted={openAll}
						onDirtyChange={onDirtyChange}
					/>
				)}
			</div>
		);
	}

	if (page.type === 'request') {
		const request = shareRequests.data?.find((candidate) => candidate.id === page.id);
		return request ? (
			<ShareRequestReview
				key={request.id}
				request={request}
				onAccepted={(path) => onOpenFile?.(path)}
				onDeclined={openAll}
			/>
		) : null;
	}

	return (
		<div className='mx-auto w-full max-w-5xl px-8 py-8'>
			<SkillsLibrary
				shareRequests={shareRequests.data}
				actions={newSkillAction}
				onOpenShareRequest={(request) => onOpenPage({ type: 'request', id: request.id })}
				onOpenSkill={(skill) => onOpenPage({ type: 'personal', name: skill.name })}
				onOpenSharedSkill={onOpenFile && ((skill) => skill.location && onOpenFile(skill.location))}
			/>
		</div>
	);
}

function useSkillPageLabel(page: SkillPage): string {
	const shareRequests = useQuery({
		...trpc.skill.listShareRequests.queryOptions(),
		enabled: page.type === 'request',
	});
	if (page.type === 'all') {
		return 'All skills';
	}
	if (page.type === 'personal') {
		return page.name;
	}
	return shareRequests.data?.find((request) => request.id === page.id)?.name ?? 'Share request';
}

function PageIcon({ page }: { page: SkillPage }) {
	if (page.type === 'request') {
		return <Inbox className='size-3.5 text-amber-600 dark:text-amber-500' />;
	}
	if (page.type === 'personal') {
		return <User className={cn('size-3.5', PERSONAL_ICON_CLASS_NAME)} />;
	}
	return <Hammer className='size-3.5' />;
}

function getSkillPageKey(page: SkillPage): string {
	if (page.type === 'personal') {
		return `personal:${page.name}`;
	}
	if (page.type === 'request') {
		return `request:${page.id}`;
	}
	return 'all';
}

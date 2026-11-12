import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, Link as LinkIcon, Loader2, SearchIcon, Users, X } from 'lucide-react';

import type { ShareModel, ShareTarget, ShareTargetState } from '@/hooks/use-share-target';
import type { ShareDraft, ShareSavedState } from '@/lib/share-draft';
import { ShareAccessPanel } from '@/components/share-access-panel';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
	useCopyWithFeedback,
	useShareActionRunner,
	useShareAudience,
	useShareCandidates,
} from '@/hooks/use-share-dialog';
import { useShareTarget } from '@/hooks/use-share-target';
import { useSession } from '@/lib/auth-client';
import { shareSubjectKey } from '@/lib/share-access';
import { createShareDraft, isShareDraftChanged, isShareDraftEmpty, STOP_SHARING_DRAFT } from '@/lib/share-draft';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export type { ShareTarget } from '@/hooks/use-share-target';

type ShareAttempt = 'save' | 'stopSharing';

interface ShareDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: ShareTarget;
}

export function ShareDialog({ open, onOpenChange, target }: ShareDialogProps) {
	const share = useShareTarget(target, open);
	const audience = useShareAudience();
	const title = target.kind === 'chat' ? 'Share chat' : 'Share story';

	if (share.isLoading || audience.isLoading) {
		return <ShareLoadingDialog open={open} onOpenChange={onOpenChange} title={title} className='sm:max-w-lg' />;
	}
	if (!share.model) {
		return <ShareErrorDialog open={open} onOpenChange={onOpenChange} title={title} onRetry={share.refetch} />;
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-lg'>
				<ShareDialogBody
					chatId={target.chatId}
					title={title}
					description={describeAudience(share.model)}
					model={share.model}
					commands={share.commands}
					onClose={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function ShareDialogBody({
	chatId,
	title,
	description,
	model,
	commands,
	onClose,
}: {
	chatId: string;
	title: string;
	description: string;
	model: ShareModel;
	commands: ShareTargetState['commands'];
	onClose: () => void;
}) {
	const { data: session } = useSession();
	const audience = useShareAudience();
	const smtpQuery = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const actions = useShareActionRunner(commands.invalidate);
	const lastAttemptRef = useRef<ShareAttempt | null>(null);
	const saved = toSavedState(model);
	const [editedDraft, setEditedDraft] = useState<ShareDraft | null>(null);
	const draft = editedDraft ?? createShareDraft(saved, audience.canShareToProject);
	const [notify, setNotify] = useState(false);
	const canNotify = smtpQuery.data === true;
	const hasChanges = model.canManage && isShareDraftChanged(draft, saved);
	const sharesWithNobody = isShareDraftEmpty(draft);

	const excludedKeys = useMemo(() => new Set([shareSubjectKey('user', model.owner?.id ?? '')]), [model.owner?.id]);
	const { candidates, isLoading } = useShareCandidates({
		chatId,
		withGroups: model.withGroups,
		excludedKeys,
		enabled: model.canManage,
	});

	const attempt = async (next: ShareAttempt) => {
		lastAttemptRef.current = next;
		const savedDraft = next === 'stopSharing' ? STOP_SHARING_DRAFT : draft;
		const saving = commands.save(savedDraft, { notify: canNotify && notify });
		if (!model.isShared && !isShareDraftEmpty(savedDraft)) {
			copyShareLinkOnceSaved(saving);
		}
		if (await actions.run(() => saving)) {
			onClose();
		}
	};
	const retry = () => {
		if (lastAttemptRef.current) {
			void attempt(lastAttemptRef.current);
		}
	};

	return (
		<>
			<DialogHeader className='gap-2'>
				<DialogTitle className='truncate pr-6'>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<ShareAccessPanel
				itemLabel={model.itemLabel}
				owner={model.owner}
				currentUserId={session?.user?.id}
				draft={draft}
				onDraftChange={setEditedDraft}
				candidates={candidates}
				isLoadingCandidates={isLoading}
				emptyMessage={audience.emptyMessage}
				withRoles={model.withRoles}
				canManage={model.canManage}
				canShareToProject={audience.canShareToProject}
				canNotify={canNotify}
				notify={notify}
				onNotifyChange={setNotify}
			/>
			{actions.error && (
				<ShareActionError message={actions.error} onRetry={retry} onDismiss={actions.dismissError} />
			)}
			<DialogFooter className='flex-row items-center sm:justify-between'>
				<div className='flex items-center gap-2'>
					{model.isShared && model.shareUrl && <CopyShareLinkButton url={model.shareUrl} />}
				</div>
				<div className='flex items-center gap-2'>
					{model.isShared && model.canManage && !hasChanges && (
						<Button
							variant='ghost-muted'
							className='rounded-full'
							disabled={actions.isPending}
							onClick={() => attempt('stopSharing')}
						>
							Stop sharing
						</Button>
					)}
					{hasChanges && (
						<Button variant='outline' className='rounded-full' onClick={onClose}>
							Cancel
						</Button>
					)}
					<Button
						className='gap-1.5 rounded-full'
						variant={hasChanges && model.isShared && sharesWithNobody ? 'destructive' : 'default'}
						disabled={actions.isPending || (hasChanges && !model.isShared && sharesWithNobody)}
						onClick={hasChanges ? () => attempt('save') : onClose}
					>
						{actions.isPending && <Loader2 className='size-3.5 animate-spin' />}
						{describeConfirm(model, { hasChanges, sharesWithNobody })}
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}

function toSavedState(model: ShareModel): ShareSavedState {
	return { isShared: model.isShared, ...model.generalAccess, grants: model.grants };
}

function describeConfirm(
	model: ShareModel,
	{ hasChanges, sharesWithNobody }: { hasChanges: boolean; sharesWithNobody: boolean },
): string {
	if (!hasChanges) {
		return 'Done';
	}
	if (model.isShared) {
		return sharesWithNobody ? 'Stop sharing' : 'Save';
	}
	return 'Share & copy link';
}

/** Writes the link while the click still counts as a user gesture, even though the share is not saved yet. */
function copyShareLinkOnceSaved(saving: Promise<string | null>): void {
	const link = saving.then((url) => new Blob([url ?? ''], { type: 'text/plain' }));
	link.catch(() => {});
	navigator.clipboard.write([new ClipboardItem({ 'text/plain': link })]).catch(() => {});
}

function describeAudience(model: ShareModel): string {
	if (model.itemLabel === 'chat') {
		return 'People you share it with can read this conversation.';
	}
	return 'People you share it with always see the latest version. Editors can change it from their own chats.';
}

export function ShareLoadingDialog({
	open,
	onOpenChange,
	title,
	className = 'sm:max-w-md',
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	className?: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={className}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>Loading sharing settings...</DialogDescription>
				</DialogHeader>
				<div className='flex items-center justify-center py-6'>
					<Loader2 className='size-4 animate-spin text-muted-foreground' />
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function ShareErrorDialog({
	open,
	onOpenChange,
	title,
	onRetry,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	onRetry: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription className='text-destructive'>
						Failed to load sharing settings. Please try again.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Close
					</Button>
					<Button onClick={onRetry}>Retry</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function CopyShareLinkButton({ url }: { url: string }) {
	const { isCopied, copy } = useCopyWithFeedback();
	return (
		<Button variant='outline' className='gap-1.5 rounded-full' onClick={() => copy(url)}>
			{isCopied ? <Check className='size-3.5' /> : <LinkIcon className='size-3.5' />}
			<span>{isCopied ? 'Copied' : 'Copy link'}</span>
		</Button>
	);
}

function ShareActionError({
	message,
	onRetry,
	onDismiss,
}: {
	message: string;
	onRetry: () => void;
	onDismiss: () => void;
}) {
	return (
		<div
			role='alert'
			className='flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs'
		>
			<CircleAlert className='size-3.5 shrink-0 text-destructive' />
			<span className='flex-1 text-destructive'>Couldn't update access. {message}</span>
			<Button variant='outline' size='sm' className='h-6 rounded-full text-xs' onClick={onRetry}>
				Retry
			</Button>
			<Button variant='ghost-muted' size='icon-xs' aria-label='Dismiss' onClick={onDismiss}>
				<X className='size-3' />
			</Button>
		</div>
	);
}

export interface ShareableGroup {
	id: string;
	name: string;
	memberCount: number;
}

export function MemberPicker({
	members,
	selectedUserIds,
	isLoading,
	search,
	onSearchChange,
	onToggleUser,
	groups = [],
	selectedGroupIds = new Set(),
	onToggleGroup,
	emptyMessage = 'No other members in this project',
}: {
	members: { id: string; name: string; email: string }[];
	selectedUserIds: Set<string>;
	isLoading: boolean;
	search: string;
	onSearchChange: (value: string) => void;
	onToggleUser: (userId: string) => void;
	groups?: ShareableGroup[];
	selectedGroupIds?: Set<string>;
	onToggleGroup?: (groupId: string) => void;
	emptyMessage?: string;
}) {
	const showGroups = onToggleGroup !== undefined && groups.length > 0;
	const hasResults = members.length > 0 || showGroups;
	const selectedCount = selectedUserIds.size + selectedGroupIds.size;

	return (
		<div className='flex flex-col gap-2 relative'>
			<SearchIcon className='absolute translate-x-2 translate-y-2 size-4' />
			<Input
				type='search'
				placeholder={onToggleGroup ? 'Search members or groups...' : 'Search members...'}
				value={search}
				onChange={(e) => onSearchChange(e.target.value)}
				className='h-8 text-sm bg-panel pl-8'
			/>
			<div className='max-h-48 overflow-y-auto'>
				{isLoading ? (
					<div className='flex items-center justify-center py-6'>
						<Loader2 className='size-4 animate-spin text-muted-foreground' />
					</div>
				) : !hasResults ? (
					<div className='py-6 text-center text-sm text-muted-foreground'>
						{search ? 'No members found' : emptyMessage}
					</div>
				) : (
					<>
						{showGroups && (
							<>
								<PickerSectionLabel>Groups</PickerSectionLabel>
								{groups.map((group) => (
									<GroupRow
										key={group.id}
										name={group.name}
										memberCount={group.memberCount}
										selected={selectedGroupIds.has(group.id)}
										onClick={() => onToggleGroup(group.id)}
									/>
								))}
								{members.length > 0 && <PickerSectionLabel>People</PickerSectionLabel>}
							</>
						)}
						{members.map((member) => (
							<MemberRow
								key={member.id}
								name={member.name}
								email={member.email}
								selected={selectedUserIds.has(member.id)}
								onClick={() => onToggleUser(member.id)}
							/>
						))}
					</>
				)}
			</div>
			{selectedCount > 0 && (
				<p className='text-xs text-muted-foreground'>
					{formatRecipientCount(selectedUserIds.size, selectedGroupIds.size)} selected
				</p>
			)}
		</div>
	);
}

export function MemberRow({
	name,
	email,
	selected,
	onClick,
}: {
	name: string;
	email: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<PickerRow selected={selected} onClick={onClick}>
			<Avatar username={name} size='sm' />
			<div className='min-w-0 flex-1'>
				<div className='text-sm font-medium truncate'>{name}</div>
				<div className='text-xs text-muted-foreground truncate'>{email}</div>
			</div>
		</PickerRow>
	);
}

function GroupRow({
	name,
	memberCount,
	selected,
	onClick,
}: {
	name: string;
	memberCount: number;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<PickerRow selected={selected} onClick={onClick}>
			<div className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted'>
				<Users className='size-3.5' />
			</div>
			<div className='min-w-0 flex-1'>
				<div className='text-sm font-medium truncate'>{name}</div>
				<div className='text-xs text-muted-foreground truncate'>
					{memberCount} {memberCount === 1 ? 'member' : 'members'}
				</div>
			</div>
		</PickerRow>
	);
}

function PickerRow({
	selected,
	onClick,
	children,
}: {
	selected: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			aria-pressed={selected}
			className={cn(
				'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer',
				'hover:bg-muted/50',
			)}
		>
			{children}
			<div
				className={cn(
					'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
					selected ? 'border-primary bg-primary text-white' : 'border-muted-foreground/30',
				)}
			>
				{selected && <Check className='size-3' />}
			</div>
		</button>
	);
}

function PickerSectionLabel({ children }: { children: React.ReactNode }) {
	return <div className='px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground'>{children}</div>;
}

function formatRecipientCount(peopleCount: number, groupCount: number): string {
	const people = `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`;
	if (groupCount === 0) {
		return people;
	}
	const groups = `${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`;
	return peopleCount === 0 ? groups : `${people} and ${groups}`;
}

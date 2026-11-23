import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FileText, Plus, Search, Trash2, User, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { ReactNode } from 'react';

import { ContextHubSectionIcon } from '@/components/context-hub/context-hub-section-icon';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { TabBar } from '@/components/ui/tab-bar';
import { Textarea } from '@/components/ui/textarea';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { invalidateExplorerQueries } from '@/lib/context-explorer-queries';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;
export type ListedSkill = RouterOutputs['skill']['list'][number];
export type PersonalSkill = RouterOutputs['skill']['listPersonal'][number];
export type ShareRequest = RouterOutputs['skill']['listShareRequests'][number];
type SkillScope = ListedSkill['scope'];
type SkillsTab = 'all' | 'shared' | 'mine';

export const PERSONAL_ICON_CLASS_NAME = 'text-teal-700 dark:text-teal-400';

export function SkillIcon({ scope, className }: { scope: SkillScope; className?: string }) {
	if (scope === 'project') {
		return <ContextHubSectionIcon section='skills' className={className} />;
	}
	return (
		<span
			className={cn(
				'flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-teal-500/12 dark:bg-teal-400/15',
				className,
			)}
		>
			<User className={cn('size-3.5', PERSONAL_ICON_CLASS_NAME)} />
		</span>
	);
}

/** The library of every skill the user can call: their own first, then the ones shared with the whole project. */
export function SkillsLibrary({
	actions,
	shareRequests = [],
	onOpenSkill,
	onOpenSharedSkill,
	onOpenShareRequest,
}: {
	actions?: ReactNode;
	shareRequests?: ShareRequest[];
	onOpenSkill: (skill: ListedSkill) => void;
	/** Opens a team skill's file; absent for members, who only see the skills, not the files. */
	onOpenSharedSkill?: (skill: ListedSkill) => void;
	onOpenShareRequest?: (request: ShareRequest) => void;
}) {
	const [tab, setTab] = useState<SkillsTab>('all');
	const [search, setSearch] = useState('');
	const skills = useQuery(trpc.skill.list.queryOptions());
	const matchingSkills = (skills.data ?? []).filter((skill) => matchesSearch(skill, search));
	const personalSkills = matchingSkills.filter((skill) => skill.scope === 'personal');
	const sharedSkills = matchingSkills.filter((skill) => skill.scope === 'project');

	return (
		<div className='flex flex-col gap-6'>
			<header className='flex flex-wrap items-center justify-between gap-3'>
				<div>
					<h1 className='text-xl font-semibold tracking-tight'>Skills</h1>
					<p className='text-sm text-muted-foreground'>
						A skill teaches nao how to handle one kind of request. Type / in any chat to use one.
					</p>
				</div>
				{actions}
			</header>

			<div className='flex flex-wrap items-end justify-between gap-3 border-b'>
				<TabBar
					idBase='skills'
					label='Skills'
					activeTab={tab}
					onTabChange={setTab}
					className='border-b-0'
					tabs={[
						{ id: 'all', label: 'All', count: matchingSkills.length },
						{ id: 'shared', label: 'Shared with everyone', count: sharedSkills.length },
						{ id: 'mine', label: 'Mine', count: personalSkills.length },
					]}
				/>
				<div className='relative mb-2 w-64'>
					<Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
					<Input
						placeholder='Search skills'
						className='h-8 pl-8 text-sm'
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</div>
			</div>

			{shareRequests.length > 0 && onOpenShareRequest && (
				<SkillSection title='Share requests' subtitle='Personal skills people asked to share with everyone'>
					{shareRequests.map((request) => (
						<SkillCard
							key={request.id}
							name={request.name}
							description={request.description}
							scope='personal'
							badge={<Badge variant='context_admin'>From {request.authorName}</Badge>}
							onOpen={() => onOpenShareRequest(request)}
						/>
					))}
				</SkillSection>
			)}
			{tab !== 'shared' && (
				<SkillSection
					title='Mine'
					subtitle='Only you can see and use these'
					emptyMessage='No personal skills yet. Create one to teach nao how you like a recurring request answered.'
				>
					{personalSkills.map((skill) => (
						<SkillCard
							key={skill.name}
							name={skill.name}
							description={skill.description}
							scope='personal'
							badge={<ShareStatusBadge status={skill.shareStatus} />}
							onOpen={() => onOpenSkill(skill)}
						/>
					))}
				</SkillSection>
			)}
			{tab !== 'mine' && (
				<SkillSection
					title='Shared with everyone'
					subtitle='Maintained by the context admins'
					emptyMessage='No shared skills yet.'
				>
					{sharedSkills.map((skill) => (
						<SkillCard
							key={skill.name}
							name={skill.name}
							description={skill.description}
							scope='project'
							onOpen={onOpenSharedSkill && (() => onOpenSharedSkill(skill))}
						/>
					))}
				</SkillSection>
			)}
		</div>
	);
}

export function PersonalSkillEditor({
	skill,
	onDeleted,
	onDirtyChange,
}: {
	skill: PersonalSkill;
	onDeleted: () => void;
	/** Told whether there are unsaved edits, so the page around it can ask before leaving them. */
	onDirtyChange?: (isDirty: boolean) => void;
}) {
	const [description, setDescription] = useState(skill.description);
	const [body, setBody] = useState(skill.body);
	const [loaded, setLoaded] = useState({ description: skill.description, body: skill.body });
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const invalidateSkills = useInvalidateSkills();
	const update = useMutation(trpc.skill.updatePersonal.mutationOptions({ onSuccess: invalidateSkills }));
	const remove = useMutation(
		trpc.skill.deletePersonal.mutationOptions({
			onSuccess: async () => {
				await invalidateSkills();
				onDeleted();
			},
		}),
	);
	const isDirty = description !== loaded.description || body !== loaded.body;

	/** The skill changes under the editor when the chat beside it edits it: unsaved edits are kept over its version. */
	if (skill.description !== loaded.description || skill.body !== loaded.body) {
		setLoaded({ description: skill.description, body: skill.body });
		if (!isDirty) {
			setDescription(skill.description);
			setBody(skill.body);
		}
	}

	useEffect(() => {
		onDirtyChange?.(isDirty);
		return () => onDirtyChange?.(false);
	}, [isDirty, onDirtyChange]);

	return (
		<div className='flex flex-col gap-6'>
			<header className='flex flex-wrap items-center gap-3'>
				<SkillIcon scope='personal' className='size-8 rounded-lg [&>svg]:size-4.5' />
				<h1 className='font-mono text-lg font-medium'>{skill.name}</h1>
				<ShareStatusBadge status={skill.shareStatus} />
				<div className='ml-auto flex items-center gap-2'>
					<Button
						variant='outline'
						size='icon'
						aria-label='Delete skill'
						onClick={() => setIsDeleteOpen(true)}
					>
						<Trash2 className='size-4' />
					</Button>
					<Button
						disabled={!isDirty || !body.trim()}
						isLoading={update.isPending}
						onClick={() => update.mutate({ name: skill.name, description, body })}
					>
						Save
					</Button>
				</div>
			</header>

			<div className='flex flex-wrap items-start gap-6'>
				<div className='flex min-w-0 flex-[999_1_420px] flex-col gap-5'>
					<SkillContentFields
						description={description}
						body={body}
						onDescriptionChange={setDescription}
						onBodyChange={setBody}
					/>
					{update.error && <ErrorMessage message={update.error.message} />}
				</div>
				<aside className='flex min-w-0 flex-[1_1_300px] flex-col gap-4'>
					<ShareSkillCard skill={skill} />
				</aside>
			</div>

			<ConfirmationDialog
				open={isDeleteOpen}
				onOpenChange={setIsDeleteOpen}
				title={`Delete ${skill.name}?`}
				description='nao stops using this skill in your chats. This cannot be undone.'
				confirmLabel='Delete skill'
				isPending={remove.isPending}
				error={remove.error?.message}
				onConfirm={() => remove.mutateAsync({ name: skill.name })}
			/>
		</div>
	);
}

export type NewSkillScope = 'personal' | 'project';

export type CreatedSkill = { scope: 'personal'; name: string } | { scope: 'project'; path: string };

/** The skill kind the "new skill" button and dialog start with: the one the user picked last. */
export function useNewSkillScope() {
	return useLocalStorage(newSkillScopeStorage);
}

/** A split button: its main part opens the dialog for the kind shown, its arrow switches that kind. */
export function NewSkillButton({
	scope,
	canCreateTeamSkill,
	onScopeChange,
	onCreate,
}: {
	scope: NewSkillScope;
	/** Members only write personal skills, so their button has no arrow to switch. */
	canCreateTeamSkill: boolean;
	onScopeChange: (scope: NewSkillScope) => void;
	onCreate: () => void;
}) {
	if (!canCreateTeamSkill) {
		return (
			<Button variant='primary-gradient' onClick={onCreate}>
				<Plus className='size-4' />
				New personal skill
			</Button>
		);
	}

	return (
		<div className='flex items-center'>
			<Button variant='primary-gradient' className='rounded-r-none' onClick={onCreate}>
				<Plus className='size-4' />
				New {getScopeOption(scope).word} skill
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='primary-gradient'
						size='icon'
						className='rounded-l-none border-l border-white/30'
						aria-label='Choose the kind of skill'
					>
						<ChevronDown className='size-4' />
					</Button>
				</DropdownMenuTrigger>
				<NewSkillScopeItems scope={scope} onScopeChange={onScopeChange} />
			</DropdownMenu>
		</div>
	);
}

/** A personal skill only its author uses, or a skill file for everyone that joins the user's changes. */
export function NewSkillDialog({
	open,
	scope: pickedScope,
	canCreateTeamSkill,
	onScopeChange,
	onClose,
	onCreated,
}: {
	open: boolean;
	scope: NewSkillScope;
	canCreateTeamSkill: boolean;
	onScopeChange: (scope: NewSkillScope) => void;
	onClose: () => void;
	onCreated: (skill: CreatedSkill) => void;
}) {
	const scope = canCreateTeamSkill ? pickedScope : 'personal';
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [body, setBody] = useState('');
	const queryClient = useQueryClient();
	const invalidateSkills = useInvalidateSkills();
	const createPersonal = useMutation(trpc.skill.createPersonal.mutationOptions({ onSuccess: invalidateSkills }));
	const createProject = useMutation(
		trpc.contextExplorer.createSkill.mutationOptions({
			onSuccess: () => invalidateExplorerQueries(queryClient),
		}),
	);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const name = toSkillName(title);
	const error = createPersonal.error ?? createProject.error;
	const selected = getScopeOption(scope);

	const close = () => {
		setTitle('');
		setDescription('');
		setBody('');
		createPersonal.reset();
		createProject.reset();
		onClose();
	};

	const handleCreate = async () => {
		const created: CreatedSkill =
			scope === 'project'
				? { scope: 'project', path: (await createProject.mutateAsync({ name, description, body })).path }
				: { scope: 'personal', name: (await createPersonal.mutateAsync({ name, description, body })).name };
		close();
		onCreated(created);
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
			<DialogContent
				className='sm:max-w-xl'
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					nameInputRef.current?.focus();
				}}
			>
				<form
					className='flex flex-col gap-4'
					onSubmit={(event) => {
						event.preventDefault();
						void handleCreate().catch(() => undefined);
					}}
				>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-1.5'>
							New
							{canCreateTeamSkill ? (
								<DropdownMenu>
									<DropdownMenuTrigger
										className={cn(
											'inline-flex cursor-pointer items-center gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
											selected.colorClassName,
										)}
									>
										{selected.word}
										<ChevronDown className='size-3.5 opacity-60' />
									</DropdownMenuTrigger>
									<NewSkillScopeItems scope={scope} onScopeChange={onScopeChange} />
								</DropdownMenu>
							) : (
								<span className={selected.colorClassName}>{selected.word}</span>
							)}
							skill
						</DialogTitle>
						<DialogDescription>{selected.description}</DialogDescription>
					</DialogHeader>
					<label className='flex flex-col gap-1.5 text-sm font-medium'>
						Name
						<Input
							ref={nameInputRef}
							value={title}
							placeholder='Weekly orders by store'
							onChange={(event) => setTitle(event.target.value)}
						/>
						{name && (
							<span className='text-xs font-normal text-muted-foreground'>
								Use it with <span className='font-mono'>/{name}</span>
								{scope === 'project' && <> · saved as agent/skills/{name}.md</>}
							</span>
						)}
					</label>
					<SkillContentFields
						description={description}
						body={body}
						onDescriptionChange={setDescription}
						onBodyChange={setBody}
					/>
					{error && <ErrorMessage message={error.message} />}
					<DialogFooter>
						<Button type='button' variant='outline' onClick={close}>
							Cancel
						</Button>
						<Button
							type='submit'
							disabled={!name || !body.trim()}
							isLoading={createPersonal.isPending || createProject.isPending}
						>
							Create skill
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface NewSkillScopeOption {
	value: NewSkillScope;
	label: string;
	/** The word the button and the dialog title show, as in "New team skill". */
	word: string;
	colorClassName: string;
	description: string;
}

const NEW_SKILL_SCOPES: readonly NewSkillScopeOption[] = [
	{
		value: 'personal',
		label: 'Personal skill',
		word: 'personal',
		colorClassName: PERSONAL_ICON_CLASS_NAME,
		description: 'Only you can use it, starting with your next chat. You can ask to share it with your team later.',
	},
	{
		value: 'project',
		label: 'Team skill',
		word: 'team',
		colorClassName: 'text-violet-600 dark:text-violet-400',
		description: 'It joins your changes as a skill file and reaches your whole team once you publish them.',
	},
];

const newSkillScopeStorage = createLocalStorage<NewSkillScope>('nao-new-skill-scope', 'personal');

function NewSkillScopeItems({
	scope,
	onScopeChange,
}: {
	scope: NewSkillScope;
	onScopeChange: (scope: NewSkillScope) => void;
}) {
	return (
		<DropdownMenuContent align='end'>
			<DropdownMenuRadioGroup value={scope} onValueChange={(value) => onScopeChange(value as NewSkillScope)}>
				{NEW_SKILL_SCOPES.map((option) => (
					<DropdownMenuRadioItem key={option.value} value={option.value} indicator='check'>
						{option.label}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	);
}

function getScopeOption(scope: NewSkillScope): NewSkillScopeOption {
	return NEW_SKILL_SCOPES.find((option) => option.value === scope) ?? NEW_SKILL_SCOPES[0];
}

export function ShareRequestReview({
	request,
	onAccepted,
	onDeclined,
}: {
	request: ShareRequest;
	onAccepted: (path: string) => void;
	onDeclined: () => void;
}) {
	const queryClient = useQueryClient();
	const invalidateRequests = () =>
		queryClient.invalidateQueries({ queryKey: trpc.skill.listShareRequests.queryKey() });
	const accept = useMutation(
		trpc.skill.acceptShareRequest.mutationOptions({
			onSuccess: async ({ path }) => {
				await Promise.all([invalidateRequests(), invalidateExplorerQueries(queryClient)]);
				onAccepted(path);
			},
		}),
	);
	const decline = useMutation(
		trpc.skill.declineShareRequest.mutationOptions({
			onSuccess: async () => {
				await invalidateRequests();
				onDeclined();
			},
		}),
	);
	const error = accept.error ?? decline.error;

	return (
		<div className='mx-auto flex w-full max-w-3xl flex-col gap-5 px-8 py-8'>
			<header className='flex flex-wrap items-center gap-3'>
				<div className='flex min-w-0 flex-1 flex-col gap-1'>
					<p className='text-xs text-muted-foreground'>Share request</p>
					<h1 className='truncate font-mono text-lg font-medium'>{request.name}</h1>
				</div>
				<Button
					variant='outline'
					size='sm'
					isLoading={decline.isPending}
					disabled={accept.isPending}
					onClick={() => decline.mutate({ id: request.id })}
				>
					Decline
				</Button>
				<Button
					size='sm'
					isLoading={accept.isPending}
					disabled={decline.isPending}
					onClick={() => accept.mutate({ id: request.id })}
				>
					<Check />
					Add to my changes
				</Button>
			</header>

			<section className='flex items-start gap-3 rounded-xl border p-4'>
				<Avatar username={request.authorName} size='sm' />
				<div className='flex flex-col gap-1 text-sm'>
					<span>
						<span className='font-medium'>{request.authorName}</span>{' '}
						<span className='text-muted-foreground'>asks to share it with everyone</span>
					</span>
					{request.note && <span className='text-muted-foreground'>{request.note}</span>}
				</div>
			</section>

			{error && <ErrorMessage message={error.message} />}

			<section className='overflow-hidden rounded-xl border'>
				<div className='flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground'>
					<FileText className='size-3.5' />
					<span className='font-mono'>agent/skills/{request.name}.md</span>
					<Badge variant='success' className='ml-auto'>
						New file
					</Badge>
				</div>
				<div className='flex flex-col gap-3 p-4'>
					<p className='text-sm text-muted-foreground'>{request.description || 'No description.'}</p>
					<pre className='overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap'>
						{request.body}
					</pre>
				</div>
			</section>

			<p className='text-sm text-muted-foreground'>
				The file joins your changes like any edit in the Context Hub. Once you publish, the skill is shared with
				everyone and replaces {request.authorName}’s personal copy.
			</p>
		</div>
	);
}

/** An accepted skill only joined a reviewer's changes: if they never publish them, the author may ask again. */
const SHARE_CARD_TEXT: Record<Exclude<PersonalSkill['shareStatus'], 'requested'>, string> = {
	private: 'Only you can use this skill. Ask the context admins to add it to the project so the whole team gets it.',
	declined: 'A context admin declined to share it. You can keep using it, or ask again after changing it.',
	accepted:
		'A context admin added it to their changes: it reaches everyone once they publish them. If it never does, you can ask again.',
};

function ShareSkillCard({ skill }: { skill: PersonalSkill }) {
	const [note, setNote] = useState('');
	const invalidateSkills = useInvalidateSkills();
	const requestShare = useMutation(trpc.skill.requestShare.mutationOptions({ onSuccess: invalidateSkills }));

	if (skill.shareStatus === 'requested') {
		return (
			<section className='flex flex-col gap-2 rounded-xl border p-4'>
				<h2 className='text-sm font-semibold'>Share with everyone</h2>
				<p className='text-sm text-muted-foreground'>
					Waiting for a context admin to review it. You can keep using and editing it meanwhile.
				</p>
			</section>
		);
	}

	return (
		<section className='flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4'>
			<h2 className='text-sm font-semibold'>Share with everyone</h2>
			<p className='text-sm text-muted-foreground'>{SHARE_CARD_TEXT[skill.shareStatus]}</p>
			<Input
				placeholder='Note for the reviewer (optional)'
				className='bg-background'
				value={note}
				onChange={(event) => setNote(event.target.value)}
			/>
			{requestShare.error && <ErrorMessage message={requestShare.error.message} />}
			<Button
				isLoading={requestShare.isPending}
				onClick={() => requestShare.mutate({ name: skill.name, note: note.trim() || null })}
			>
				<Users />
				Request to share
			</Button>
		</section>
	);
}

function SkillContentFields({
	description,
	body,
	onDescriptionChange,
	onBodyChange,
}: {
	description: string;
	body: string;
	onDescriptionChange: (description: string) => void;
	onBodyChange: (body: string) => void;
}) {
	return (
		<>
			<label className='flex flex-col gap-1.5 text-sm font-medium'>
				When should nao use it?
				<Textarea
					className='min-h-16 font-normal'
					value={description}
					placeholder='When I ask for last week’s orders by store.'
					onChange={(event) => onDescriptionChange(event.target.value)}
				/>
				<span className='text-xs font-normal text-muted-foreground'>
					nao reads this to pick the skill on its own, without the / command.
				</span>
			</label>
			<label className='flex flex-col gap-1.5 text-sm font-medium'>
				Instructions
				<Textarea
					className='min-h-56 font-mono text-xs leading-relaxed font-normal'
					value={body}
					placeholder={'Revenue counts completed orders only.\nShow revenue and order count by store.'}
					onChange={(event) => onBodyChange(event.target.value)}
				/>
			</label>
		</>
	);
}

function ShareStatusBadge({ status }: { status: ListedSkill['shareStatus'] }) {
	if (status === 'requested') {
		return <Badge variant='context_admin'>Sharing requested</Badge>;
	}
	if (status === 'accepted') {
		return <Badge variant='success'>Being shared</Badge>;
	}
	return (
		<Badge className='bg-teal-500/10 text-teal-700 dark:text-teal-400'>
			<User />
			Personal
		</Badge>
	);
}

function SkillCard({
	name,
	description,
	scope,
	badge,
	onOpen,
}: {
	name: string;
	description: string;
	scope: SkillScope;
	badge?: ReactNode;
	/** Absent when the user cannot open the skill, such as a team skill for someone who does not see the files. */
	onOpen?: () => void;
}) {
	const content = (
		<>
			<span className='flex min-w-0 items-center gap-2.5'>
				<SkillIcon scope={scope} className='size-6' />
				<span className='truncate font-mono text-[13px] font-medium'>{name}</span>
			</span>
			<span className='line-clamp-2 text-sm text-muted-foreground'>{description || 'No description.'}</span>
			{badge && <span className='mt-auto'>{badge}</span>}
		</>
	);
	const className = 'flex flex-col gap-3 rounded-xl border bg-background p-4 text-left';

	return onOpen ? (
		<button
			type='button'
			className={cn(className, 'cursor-pointer transition-colors hover:border-foreground/20')}
			onClick={onOpen}
		>
			{content}
		</button>
	) : (
		<div className={className}>{content}</div>
	);
}

function SkillSection({
	title,
	subtitle,
	emptyMessage,
	children,
}: {
	title: string;
	subtitle: string;
	emptyMessage?: string;
	children: ReactNode[];
}) {
	return (
		<section className='flex flex-col gap-3'>
			<div className='flex items-baseline gap-2'>
				<h2 className='text-sm font-semibold'>{title}</h2>
				<span className='text-sm text-muted-foreground'>{subtitle}</span>
			</div>
			{children.length === 0 && emptyMessage ? (
				<p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
					{emptyMessage}
				</p>
			) : (
				<div className='grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4'>{children}</div>
			)}
		</section>
	);
}

function useInvalidateSkills() {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.skill.list.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.skill.listPersonal.queryKey() }),
		]);
}

function matchesSearch(skill: ListedSkill, search: string): boolean {
	const query = search.trim().toLowerCase();
	return !query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query);
}

function toSkillName(title: string): string {
	return title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
		.replace(/-+$/, '');
}

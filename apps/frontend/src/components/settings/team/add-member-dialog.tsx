import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { EMPTY_EMAIL_LIST, EmailListInput, isValidEmail, listEmails } from './email-list-input';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { ReactNode } from 'react';

import type { EmailListValue } from './email-list-input';
import type { UserGroupPickerOption } from '@/components/settings/user-group-picker';
import { UserGroupPicker } from '@/components/settings/user-group-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type AddMemberGroupOption = UserGroupPickerOption;
export type AddMemberOutcome = inferRouterOutputs<TrpcRouter>['user']['addUserToProject'][number];
export type AddMembersRequest = { members: { email: string; name?: string }[]; groupIds?: string[] };

type Step = 'emails' | 'names' | 'results';

interface AddMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	groupOptions?: AddMemberGroupOption[];
	groupsLoading?: boolean;
	groupsError?: boolean;
	onRetryGroups?: () => void;
	onSubmit: (request: AddMembersRequest) => Promise<AddMemberOutcome[]>;
}

export function AddMemberDialog({
	open,
	onOpenChange,
	title = 'Add Members',
	groupOptions,
	groupsLoading = false,
	groupsError = false,
	onRetryGroups,
	onSubmit,
}: AddMemberDialogProps) {
	const [step, setStep] = useState<Step>('emails');
	const [emailList, setEmailList] = useState<EmailListValue>(EMPTY_EMAIL_LIST);
	const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
	const [outcomes, setOutcomes] = useState<AddMemberOutcome[]>([]);
	const [names, setNames] = useState<Record<string, string>>({});
	const [error, setError] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);

	const emails = listEmails(emailList);
	const invalidEmails = emails.filter((email) => !isValidEmail(email));
	const emailsNeedingName = outcomes.filter((outcome) => outcome.status === 'needsName').map(({ email }) => email);
	const groupsUnavailable = groupOptions !== undefined && (groupsLoading || groupsError);

	const handleClose = () => {
		onOpenChange(false);
		setStep('emails');
		setEmailList(EMPTY_EMAIL_LIST);
		setSelectedGroupIds([]);
		setOutcomes([]);
		setNames({});
		setError('');
	};

	const submit = async (members: AddMembersRequest['members']) => {
		setError('');
		setIsSubmitting(true);
		try {
			const newOutcomes = await onSubmit({ members, ...(groupOptions ? { groupIds: selectedGroupIds } : {}) });
			return mergeOutcomes(outcomes, newOutcomes);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return null;
		} finally {
			setIsSubmitting(false);
		}
	};

	const showNextStep = (allOutcomes: AddMemberOutcome[]) => {
		setOutcomes(allOutcomes);
		const needsName = allOutcomes.filter((outcome) => outcome.status === 'needsName');
		if (needsName.length > 0) {
			setNames(Object.fromEntries(needsName.map(({ email }) => [email, nameFromEmail(email)])));
			setStep('names');
		} else if (allOutcomes.every(isSilentSuccess)) {
			handleClose();
		} else {
			setStep('results');
		}
	};

	const submitEmails = async () => {
		if (invalidEmails.length > 0) {
			setError(`Fix or remove invalid emails: ${invalidEmails.join(', ')}`);
			return;
		}
		const allOutcomes = await submit(emails.map((email) => ({ email })));
		if (allOutcomes) {
			showNextStep(allOutcomes);
		}
	};

	const submitNames = async () => {
		const members = emailsNeedingName.map((email) => ({ email, name: names[email]?.trim() ?? '' }));
		if (members.some((member) => !member.name)) {
			setError('Enter a name for every new account.');
			return;
		}
		const allOutcomes = await submit(members);
		if (allOutcomes) {
			showNextStep(allOutcomes);
		}
	};

	const skipNewAccount = (email: string) => {
		const remaining = outcomes.filter((outcome) => outcome.email !== email);
		if (remaining.some((outcome) => outcome.status === 'needsName')) {
			setOutcomes(remaining);
		} else {
			showNextStep(remaining);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className={step === 'emails' ? undefined : 'sm:max-w-xl'}>
				{step === 'emails' && (
					<StepForm
						title={title}
						description='Paste or type one or more emails, separated by commas, spaces or new lines.'
						error={error}
						onSubmit={submitEmails}
						submitLabel={emails.length > 1 ? `Add ${emails.length} members` : 'Add member'}
						submitDisabled={groupsUnavailable || emails.length === 0}
						isSubmitting={isSubmitting}
					>
						<div className='flex flex-col gap-2'>
							<label htmlFor='member-emails' className='text-sm font-medium'>
								Emails
							</label>
							<EmailListInput id='member-emails' value={emailList} onChange={setEmailList} />
						</div>
						{groupOptions && !groupsError && (
							<UserGroupPicker
								groups={groupOptions}
								selectedGroupIds={selectedGroupIds}
								loading={groupsLoading}
								onSelectedGroupIdsChange={setSelectedGroupIds}
							/>
						)}
						{groupOptions && groupsError && <GroupsLoadError onRetry={onRetryGroups} />}
					</StepForm>
				)}

				{step === 'names' && (
					<StepForm
						title={emailsNeedingName.length > 1 ? 'Create new accounts' : 'Create a new account'}
						description='No account exists for these emails yet. Check the names we guessed, then create the accounts.'
						error={error}
						onSubmit={submitNames}
						submitLabel={
							emailsNeedingName.length > 1
								? `Create ${emailsNeedingName.length} accounts`
								: 'Create account'
						}
						isSubmitting={isSubmitting}
					>
						<NewAccountNames
							emails={emailsNeedingName}
							names={names}
							onNameChange={(email, name) => setNames({ ...names, [email]: name })}
							onSkip={skipNewAccount}
						/>
					</StepForm>
				)}

				{step === 'results' && <AddMemberResults outcomes={outcomes} onDone={handleClose} />}
			</DialogContent>
		</Dialog>
	);
}

function StepForm({
	title,
	description,
	error,
	submitLabel,
	submitDisabled = false,
	isSubmitting,
	onSubmit,
	children,
}: {
	title: string;
	description: string;
	error: string;
	submitLabel: string;
	submitDisabled?: boolean;
	isSubmitting: boolean;
	onSubmit: () => void;
	children: ReactNode;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onSubmit();
				}}
				className='flex min-w-0 flex-col gap-4'
			>
				{children}
				{error && <p className='text-center text-sm text-destructive'>{error}</p>}
				<DialogFooter>
					<Button
						type='submit'
						variant='primary-gradient'
						className='rounded-full'
						disabled={submitDisabled}
						isLoading={isSubmitting}
					>
						{submitLabel}
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}

function GroupsLoadError({ onRetry }: { onRetry?: () => void }) {
	return (
		<div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
			<p className='text-sm text-destructive'>Failed to load groups.</p>
			{onRetry && (
				<Button type='button' variant='outline' size='sm' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function NewAccountNames({
	emails,
	names,
	onNameChange,
	onSkip,
}: {
	emails: string[];
	names: Record<string, string>;
	onNameChange: (email: string, name: string) => void;
	onSkip: (email: string) => void;
}) {
	return (
		<div className='max-h-80 overflow-y-auto rounded-lg border'>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Email</TableHead>
						<TableHead>Name</TableHead>
						<TableHead className='w-10' />
					</TableRow>
				</TableHeader>
				<TableBody>
					{emails.map((email) => (
						<TableRow key={email}>
							<TableCell className='max-w-56 truncate'>{email}</TableCell>
							<TableCell>
								<Input
									aria-label={`Name for ${email}`}
									value={names[email] ?? ''}
									onChange={(event) => onNameChange(email, event.target.value)}
									className='h-8'
								/>
							</TableCell>
							<TableCell>
								<Button
									type='button'
									variant='ghost-muted'
									size='icon-sm'
									aria-label={`Skip ${email}`}
									onClick={() => onSkip(email)}
								>
									<X />
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function AddMemberResults({ outcomes, onDone }: { outcomes: AddMemberOutcome[]; onDone: () => void }) {
	const [copied, setCopied] = useState(false);
	const addedCount = outcomes.filter((outcome) => outcome.status === 'added').length;
	const credentials = outcomes.flatMap((outcome) =>
		outcome.status === 'added' && outcome.password ? [`${outcome.email},${outcome.password}`] : [],
	);

	const copyCredentials = async () => {
		await navigator.clipboard.writeText(['email,password', ...credentials].join('\n'));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>{addedCount === 1 ? '1 member added' : `${addedCount} members added`}</DialogTitle>
				<DialogDescription>Each person added received an email with access.</DialogDescription>
			</DialogHeader>
			{credentials.length > 0 && (
				<Callout variant='warning' className='text-sm'>
					Save these temporary passwords now: you won't see them again after closing this dialog.
				</Callout>
			)}
			<div className='max-h-80 overflow-y-auto rounded-lg border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Email</TableHead>
							<TableHead>Details</TableHead>
							<TableHead>Result</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{outcomes.map((outcome) => (
							<TableRow key={outcome.email}>
								<TableCell className='max-w-56 truncate'>{outcome.email}</TableCell>
								<OutcomeDetails outcome={outcome} />
								<TableCell>
									<OutcomeBadge outcome={outcome} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<DialogFooter className='sm:justify-between'>
				{credentials.length > 0 ? (
					<Button type='button' variant='outline' className='rounded-full' onClick={copyCredentials}>
						{copied ? <Check className='text-green-500' /> : <Copy />}
						Copy passwords as CSV
					</Button>
				) : (
					<span />
				)}
				<Button type='button' variant='primary-gradient' className='rounded-full' onClick={onDone}>
					Done
				</Button>
			</DialogFooter>
		</>
	);
}

function OutcomeDetails({ outcome }: { outcome: AddMemberOutcome }) {
	if (outcome.status === 'added' && outcome.password) {
		return <TableCell className='font-mono text-xs'>{outcome.password}</TableCell>;
	}
	if (outcome.status === 'failed') {
		return <TableCell className='max-w-48 truncate text-xs text-destructive'>{outcome.error}</TableCell>;
	}
	return <TableCell />;
}

function OutcomeBadge({ outcome }: { outcome: AddMemberOutcome }) {
	switch (outcome.status) {
		case 'added':
			return <Badge variant='success'>Added</Badge>;
		case 'alreadyMember':
			return <Badge variant='viewer'>Already a member</Badge>;
		case 'failed':
			return <Badge variant='error'>Failed</Badge>;
		case 'needsName':
			return <Badge variant='viewer'>Skipped</Badge>;
	}
}

function mergeOutcomes(previous: AddMemberOutcome[], next: AddMemberOutcome[]): AddMemberOutcome[] {
	const outcomesByEmail = new Map(previous.map((outcome) => [outcome.email, outcome]));
	for (const outcome of next) {
		outcomesByEmail.set(outcome.email, outcome);
	}
	return [...outcomesByEmail.values()];
}

function isSilentSuccess(outcome: AddMemberOutcome): boolean {
	return outcome.status === 'added' && !outcome.password;
}

function nameFromEmail(email: string): string {
	return email
		.split('@')[0]
		.split(/[._-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

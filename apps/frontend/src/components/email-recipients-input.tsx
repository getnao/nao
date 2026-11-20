import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { CompletionOptions } from '@/components/ui/completion-input';
import { CompletionInput } from '@/components/ui/completion-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const NOT_A_MEMBER_ERROR = 'Not a project member you can share with. Runs emailing this address will fail.';

type EmailRecipientsInputProps = {
	recipients: string[];
	error: string | null;
	disabled: boolean;
	onChange: (recipients: string[]) => void;
};

/** Recipients as removable pills, completed from the project members the user can share with. */
export function EmailRecipientsInput({ recipients, error, disabled, onChange }: EmailRecipientsInputProps) {
	const [draft, setDraft] = useState('');
	const [isDraftAppended, setIsDraftAppended] = useState(false);
	const members = useQuery(trpc.automation.listEmailRecipients.queryOptions());
	const memberEmails = members.data && new Set(members.data.map((member) => normalizeEmail(member.email)));
	const tokens =
		isDraftAppended && recipients.at(-1) === normalizeEmail(draft) ? recipients.slice(0, -1) : recipients;

	/** A new draft address is appended to `recipients` so a save shortcut pressed mid-typing keeps it. */
	function update(nextTokens: string[], nextDraft: string) {
		const nextRecipients = mergeRecipients(nextTokens, [nextDraft]);
		setDraft(nextDraft);
		setIsDraftAppended(nextRecipients.length > nextTokens.length);
		onChange(nextRecipients);
	}

	function commitDraft() {
		setDraft('');
		setIsDraftAppended(false);
	}

	function handleDraftChange(text: string) {
		const completedRecipients = text.split(/[\s,;]+/);
		const remainder = completedRecipients.pop() ?? '';
		update(mergeRecipients(tokens, completedRecipients), remainder);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Enter' && draft.trim()) {
			event.preventDefault();
			commitDraft();
			return;
		}
		if (event.key === 'Backspace' && draft === '' && tokens.length > 0) {
			event.preventDefault();
			update(tokens.slice(0, -1), '');
		}
	}

	/** A picked member is inserted with a separator, which turns the address into a pill. */
	function completeMembers(value: string, cursor: number): CompletionOptions {
		const typed = normalizeEmail(value.slice(0, cursor));
		const taken = new Set(tokens.map(normalizeEmail));
		const matches = (members.data ?? []).filter((member) => {
			const isMatch = normalizeEmail(member.email).includes(typed) || member.name.toLowerCase().includes(typed);
			return typed !== '' && isMatch && !taken.has(normalizeEmail(member.email));
		});
		return {
			from: 0,
			to: value.length,
			items: matches.map((member) => ({
				label: member.email,
				detail: member.name,
				insertText: `${member.email},`,
			})),
		};
	}

	return (
		<div
			onClick={(event) => event.currentTarget.querySelector('input')?.focus()}
			aria-invalid={Boolean(error)}
			className={cn(
				'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs transition-[color,box-shadow]',
				'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
				error && 'border-destructive ring-1 ring-destructive/20',
				disabled && 'pointer-events-none opacity-50',
			)}
		>
			{tokens.map((recipient) => (
				<EmailRecipientPill
					key={recipient}
					recipient={recipient}
					error={memberEmails && !memberEmails.has(normalizeEmail(recipient)) ? NOT_A_MEMBER_ERROR : null}
					disabled={disabled}
					onRemove={() =>
						update(
							tokens.filter((token) => token !== recipient),
							draft,
						)
					}
				/>
			))}
			<CompletionInput
				value={draft}
				disabled={disabled}
				aria-label='Email recipients'
				aria-describedby={error ? 'automation-email-recipients-error' : undefined}
				placeholder={tokens.length === 0 ? 'Type a project member’s name or email' : ''}
				className='h-6 min-w-32 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent'
				getCompletions={completeMembers}
				onValueChange={handleDraftChange}
				onKeyDown={handleKeyDown}
				onBlur={commitDraft}
			/>
		</div>
	);
}

function EmailRecipientPill({
	recipient,
	error,
	disabled,
	onRemove,
}: {
	recipient: string;
	error: string | null;
	disabled: boolean;
	onRemove: () => void;
}) {
	const pill = (
		<span
			aria-invalid={Boolean(error)}
			className={cn(
				'inline-flex h-6 max-w-full items-center gap-1 rounded-md border pl-1.5 pr-0.5 text-xs',
				error
					? 'border-destructive/40 bg-destructive/10 text-destructive'
					: 'border-border bg-muted/60 text-foreground',
			)}
		>
			<span className='truncate font-mono'>{recipient}</span>
			<button
				type='button'
				disabled={disabled}
				onClick={onRemove}
				aria-label={`Remove ${recipient}`}
				className='inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-70 transition-opacity hover:bg-background/60 hover:opacity-100'
			>
				<X className='size-3' />
			</button>
		</span>
	);

	if (!error) {
		return pill;
	}

	return (
		<Tooltip delayDuration={150}>
			<TooltipTrigger asChild>{pill}</TooltipTrigger>
			<TooltipContent>{error}</TooltipContent>
		</Tooltip>
	);
}

function mergeRecipients(recipients: string[], additions: string[]): string[] {
	const merged = [...recipients];
	for (const addition of additions.map(normalizeEmail).filter(Boolean)) {
		if (!merged.some((recipient) => normalizeEmail(recipient) === addition)) {
			merged.push(addition);
		}
	}
	return merged;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

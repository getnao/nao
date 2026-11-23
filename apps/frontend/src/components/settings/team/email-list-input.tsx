import { X } from 'lucide-react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export interface EmailListValue {
	emails: string[];
	draft: string;
}

export const EMPTY_EMAIL_LIST: EmailListValue = { emails: [], draft: '' };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_SEPARATORS = /[\s,;<>"']+/;

/** Chip input that turns typed or pasted text into a list of emails, e.g. a column copied from a spreadsheet. */
export function EmailListInput({
	id,
	value,
	onChange,
}: {
	id: string;
	value: EmailListValue;
	onChange: (value: EmailListValue) => void;
}) {
	const handleDraftChange = (text: string) => {
		const tokens = text.split(TOKEN_SEPARATORS);
		const draft = tokens.pop() ?? '';
		onChange({ emails: mergeEmails(value.emails, tokens.join(' ')), draft });
	};

	const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		event.preventDefault();
		onChange({
			emails: mergeEmails(value.emails, `${value.draft} ${event.clipboardData.getData('text')}`),
			draft: '',
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter' && value.draft) {
			event.preventDefault();
			onChange({ emails: mergeEmails(value.emails, value.draft), draft: '' });
		}
		if (event.key === 'Backspace' && !value.draft && value.emails.length > 0) {
			onChange({ ...value, emails: value.emails.slice(0, -1) });
		}
	};

	const removeEmail = (email: string) => {
		onChange({ ...value, emails: value.emails.filter((existing) => existing !== email) });
	};

	return (
		<div className='border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex max-h-40 min-h-20 flex-wrap content-start gap-1.5 overflow-y-auto rounded-md border p-1.5 shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]'>
			{value.emails.map((email) => (
				<EmailChip key={email} email={email} onRemove={() => removeEmail(email)} />
			))}
			<input
				id={id}
				value={value.draft}
				onChange={(event) => handleDraftChange(event.target.value)}
				onPaste={handlePaste}
				onKeyDown={handleKeyDown}
				onBlur={() => value.draft && onChange({ emails: mergeEmails(value.emails, value.draft), draft: '' })}
				placeholder={value.emails.length === 0 ? 'jane@acme.com, marc@acme.com…' : undefined}
				className='placeholder:text-muted-foreground h-6 min-w-40 flex-1 bg-transparent px-1.5 text-sm outline-none'
			/>
		</div>
	);
}

export function listEmails(value: EmailListValue): string[] {
	return mergeEmails(value.emails, value.draft);
}

export function isValidEmail(email: string): boolean {
	return EMAIL_PATTERN.test(email);
}

function EmailChip({ email, onRemove }: { email: string; onRemove: () => void }) {
	const valid = isValidEmail(email);
	return (
		<span
			className={cn(
				'inline-flex h-6 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs',
				valid ? 'bg-muted' : 'bg-destructive/10 text-destructive',
			)}
			title={valid ? undefined : 'Invalid email'}
		>
			{email}
			<button
				type='button'
				onClick={onRemove}
				aria-label={`Remove ${email}`}
				className='hover:bg-foreground/10 flex size-4 cursor-pointer items-center justify-center rounded-full'
			>
				<X className='size-3' />
			</button>
		</span>
	);
}

function mergeEmails(emails: string[], text: string): string[] {
	const parsed = text
		.split(TOKEN_SEPARATORS)
		.filter((token) => token.includes('@'))
		.map((token) => token.toLowerCase());
	return [...new Set([...emails, ...parsed])];
}

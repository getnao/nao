import { X } from 'lucide-react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export interface EmailListValue {
	emails: string[];
	draft: string;
}

export const EMPTY_EMAIL_LIST: EmailListValue = { emails: [], draft: '' };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENTRY_SEPARATORS = /[,;\n]+/;
const ANGLE_ADDRESSES = /<([^<>]*)>/g;
const SURROUNDING_QUOTES = /^["']+|["']+$/g;
const TYPED_TEXT_WITH_SEPARATOR = /^([\s\S]*[\s,;])([^\s,;]*)$/;
const UNCLOSED_ANGLE_ADDRESS = /<[^>]*$/;

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
		const match = text.match(TYPED_TEXT_WITH_SEPARATOR);
		if (!match || !isCompleteTypedText(match[1])) {
			onChange({ ...value, draft: text });
			return;
		}
		const [, completeText, draft] = match;
		onChange({ emails: mergeEmails(value.emails, completeText), draft });
	};

	const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		event.preventDefault();
		onChange({
			emails: mergeEmails(value.emails, `${value.draft}\n${event.clipboardData.getData('text')}`),
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
	return [...new Set([...emails, ...text.split(ENTRY_SEPARATORS).flatMap(parseEntry)])];
}

/**
 * Typed text becomes chips at a comma or semicolon, or at a space once it holds an address,
 * so a display name such as `Jane Doe <jane@acme.com>` can be typed in full.
 */
function isCompleteTypedText(text: string): boolean {
	return !UNCLOSED_ANGLE_ADDRESS.test(text) && (/[,;]/.test(text) || text.includes('@'));
}

/** Drops display names next to `<address>` entries; any other word stays, so typos remain visible. */
function parseEntry(entry: string): string[] {
	const angleAddresses = [...entry.matchAll(ANGLE_ADDRESSES)].map((match) => match[1]);
	const otherWords = entry.replace(ANGLE_ADDRESSES, ' ').split(/\s+/);
	const tokens =
		angleAddresses.length > 0
			? [...angleAddresses, ...otherWords.filter((word) => word.includes('@'))]
			: otherWords;
	return tokens.map((token) => token.trim().replace(SURROUNDING_QUOTES, '').toLowerCase()).filter(Boolean);
}

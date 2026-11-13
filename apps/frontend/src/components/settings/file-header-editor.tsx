import { useLayoutEffect, useRef, useState } from 'react';
import { FilePlus2, Tag, TriangleAlert, UserRound, X } from 'lucide-react';
import { isContextFileHeaderEditable, normalizeContextFileTags } from '@nao/shared/context-file-header';
import type { ContextFileHeaderChanges, ContextFileHeaderProblem } from '@nao/shared/context-file-header';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';

import type { FileHeaderState } from '@/hooks/use-file-header';
import { FileOwnerPicker } from '@/components/settings/file-owner-picker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FileHeaderEditorProps {
	state: FileHeaderState;
	isEditable: boolean;
	onChange: (changes: ContextFileHeaderChanges) => void;
	onSave?: () => void;
}

/** The frontmatter of a Markdown file as editable properties, like the header of a document. */
export function FileHeaderEditor({ state, isEditable, onChange, onSave }: FileHeaderEditorProps) {
	const { reading, problems, owners, isOwnersError, retryOwners, defaults } = state;
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const canEdit = isEditable && isContextFileHeaderEditable(reading);
	const { header } = reading;

	const handleKeyDown = (event: KeyboardEvent) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			onSave?.();
		}
	};

	return (
		<header aria-label='File properties' className='mb-2 flex flex-col border-b pb-3' onKeyDown={handleKeyDown}>
			{problems
				.filter((problem) => problem.kind !== 'unknown-owner')
				.map((problem) => (
					<HeaderWarning key={problem.message} className='mb-2'>
						{problem.kind === 'invalid-header' ? `${problem.message} Fix it in Source.` : problem.message}
					</HeaderWarning>
				))}
			<HeaderTextInput
				label='Title'
				placeholder='Untitled'
				value={header.title}
				fallback={defaults.title}
				isEditable={canEdit}
				className='text-2xl leading-tight font-semibold'
				onChange={(title) => onChange({ title })}
				onEnter={() => descriptionRef.current?.focus()}
			/>
			<HeaderTextInput
				textareaRef={descriptionRef}
				label='Description'
				placeholder='Add a description'
				value={header.description}
				fallback={defaults.description}
				isEditable={canEdit}
				isMultiline
				className='mt-1 text-sm text-muted-foreground'
				onChange={(description) => onChange({ description })}
			/>
			<dl className='mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-y-0.5'>
				<PropertyRow icon={UserRound} label='Owner'>
					<FileOwnerPicker
						owner={header.owner}
						owners={owners}
						isOwnersError={isOwnersError}
						onRetryOwners={retryOwners}
						isEditable={canEdit}
						onChange={(owner) => onChange({ owner })}
					/>
				</PropertyRow>
				<PropertyRow icon={Tag} label='Tags'>
					<TagsInput tags={header.tags} isEditable={canEdit} onChange={(tags) => onChange({ tags })} />
				</PropertyRow>
			</dl>
		</header>
	);
}

/** Above the Markdown source: offers to start a header when the file has none, and lists what is wrong in it. */
export function FileHeaderSourceBar({
	state,
	isEditable,
	onAddHeader,
}: {
	state: FileHeaderState;
	isEditable: boolean;
	onAddHeader: () => void;
}) {
	const canAddHeader = isEditable && !state.reading.hasHeader;
	if (!canAddHeader && state.problems.length === 0) {
		return null;
	}

	return (
		<div aria-label='Header checks' className='flex shrink-0 flex-col gap-1 border-b px-3 py-1.5'>
			{canAddHeader && (
				<div className='flex items-center gap-2 text-xs text-muted-foreground'>
					<span>This file has no header to describe it.</span>
					<Button
						type='button'
						variant='outline'
						size='sm'
						className='h-6 px-2 text-xs'
						onClick={onAddHeader}
					>
						<FilePlus2 />
						Add header
					</Button>
				</div>
			)}
			{state.problems.map((problem) => (
				<HeaderWarning key={problem.message}>{describeSourceProblem(problem)}</HeaderWarning>
			))}
		</div>
	);
}

function PropertyRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
	return (
		<>
			<dt className='flex items-center gap-1.5 text-sm text-muted-foreground'>
				<Icon className='size-3.5' />
				{label}
			</dt>
			<dd className='min-w-0'>{children}</dd>
		</>
	);
}

function HeaderWarning({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<p
			className={cn(
				'flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400',
				className,
			)}
		>
			<TriangleAlert className='mt-px size-3.5 shrink-0' />
			{children}
		</p>
	);
}

interface HeaderTextInputProps {
	textareaRef?: RefObject<HTMLTextAreaElement | null>;
	label: string;
	placeholder: string;
	value: string | null;
	/** Shown like a value while the file sets none, until the user types their own. */
	fallback?: string | null;
	isEditable: boolean;
	isMultiline?: boolean;
	className: string;
	onChange: (value: string) => void;
	onEnter?: () => void;
}

/**
 * A borderless field growing with its text. It keeps what the user types, spaces included, while the file stores the
 * trimmed value, and follows the file when it changes elsewhere, like in Source.
 */
function HeaderTextInput({
	textareaRef,
	label,
	placeholder,
	value,
	fallback,
	isEditable,
	isMultiline = false,
	className,
	onChange,
	onEnter,
}: HeaderTextInputProps) {
	const [text, setText] = useState(value ?? '');
	const ownTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const resolvedTextareaRef = textareaRef ?? ownTextareaRef;
	if ((text.trim() || null) !== value) {
		setText(value ?? '');
	}

	useLayoutEffect(() => {
		const textarea = resolvedTextareaRef.current;
		if (textarea) {
			fitHeightToText(textarea);
		}
	}, [resolvedTextareaRef, text, fallback]);

	if (!isEditable && !value && !fallback) {
		return null;
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !isMultiline) {
			event.preventDefault();
			onEnter?.();
		}
	};

	return (
		<textarea
			ref={resolvedTextareaRef}
			aria-label={label}
			rows={1}
			value={text}
			placeholder={fallback || placeholder}
			readOnly={!isEditable}
			onChange={(event) => {
				const nextText = isMultiline ? event.target.value : event.target.value.replaceAll(/\r?\n/g, ' ');
				setText(nextText);
				onChange(nextText);
			}}
			onKeyDown={handleKeyDown}
			className={cn(
				'w-full resize-none overflow-hidden bg-transparent px-0 py-0.5 outline-none',
				fallback ? 'placeholder:text-inherit' : 'placeholder:text-muted-foreground/50',
				className,
			)}
		/>
	);
}

/** Grows the field to its text, or to its placeholder while empty, which browsers leave out of its scroll height. */
function fitHeightToText(textarea: HTMLTextAreaElement): void {
	const text = textarea.value;
	if (!text) {
		textarea.value = textarea.placeholder;
	}
	textarea.style.height = 'auto';
	textarea.style.height = `${textarea.scrollHeight}px`;
	textarea.value = text;
}

function TagsInput({
	tags,
	isEditable,
	onChange,
}: {
	tags: string[];
	isEditable: boolean;
	onChange: (tags: string[]) => void;
}) {
	const [input, setInput] = useState('');

	const addTags = (text: string) => {
		const nextTags = normalizeContextFileTags([...tags, ...text.split(',')]);
		if (nextTags.length !== tags.length) {
			onChange(nextTags);
		}
		setInput('');
	};

	const removeTag = (tag: string) => {
		onChange(tags.filter((candidate) => candidate !== tag));
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			addTags(input);
		} else if (event.key === 'Backspace' && input === '' && tags.length > 0) {
			removeTag(tags[tags.length - 1]);
		}
	};

	if (!isEditable && tags.length === 0) {
		return <span className='flex h-7 items-center px-1.5 text-sm text-muted-foreground'>Empty</span>;
	}

	return (
		<div className='flex min-h-7 flex-wrap items-center gap-1 px-1.5 py-0.5'>
			{tags.map((tag) => (
				<span
					key={tag}
					className='inline-flex h-5 items-center gap-0.5 rounded-sm bg-secondary px-1.5 text-xs text-secondary-foreground'
				>
					{tag}
					{isEditable && (
						<button
							type='button'
							aria-label={`Remove tag ${tag}`}
							onClick={() => removeTag(tag)}
							className='-mr-0.5 cursor-pointer rounded-sm opacity-60 hover:opacity-100'
						>
							<X className='size-3' />
						</button>
					)}
				</span>
			))}
			{isEditable && (
				<input
					aria-label='Add a tag'
					value={input}
					placeholder={tags.length === 0 ? 'Empty' : 'Add a tag'}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={handleKeyDown}
					onBlur={() => addTags(input)}
					className='h-5 min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
				/>
			)}
		</div>
	);
}

function describeSourceProblem(problem: ContextFileHeaderProblem): string {
	return problem.kind === 'unknown-owner' ? `${problem.message} Use the email of a project user.` : problem.message;
}

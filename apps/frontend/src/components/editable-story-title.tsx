import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { KeyboardEvent, MouseEvent } from 'react';

import { invalidateStoryTitleCaches } from '@/lib/stories-cache';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface EditableStoryTitleProps {
	storyId?: string | null;
	title: string;
	canEdit: boolean;
	heading: 'h1' | 'h3';
	className?: string;
	inputClassName?: string;
	onClick?: () => void;
}

export function EditableStoryTitle({
	storyId,
	title: currentTitle,
	canEdit,
	heading,
	className,
	inputClassName,
	onClick,
}: EditableStoryTitleProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const isEditingRef = useRef(false);
	const submittingRef = useRef(false);
	const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [displayTitle, setDisplayTitle] = useState(currentTitle);
	const [draft, setDraft] = useState(currentTitle);

	const renameStory = useMutation(
		trpc.story.rename.mutationOptions({
			onSuccess: (_data, _variables, _result, context) => {
				invalidateStoryTitleCaches(context.client);
			},
		}),
	);

	useEffect(() => {
		if (!isEditingRef.current) {
			setDisplayTitle(currentTitle);
		}
	}, [currentTitle]);

	useEffect(
		() => () => {
			if (clickTimerRef.current) {
				clearTimeout(clickTimerRef.current);
			}
		},
		[],
	);

	const handleClick = (event: MouseEvent<HTMLElement>) => {
		if (!onClick) {
			return;
		}
		if (!canEdit || !storyId) {
			onClick();
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (clickTimerRef.current) {
			clearTimeout(clickTimerRef.current);
		}
		clickTimerRef.current = setTimeout(() => {
			clickTimerRef.current = null;
			onClick();
		}, 200);
	};

	const startEditing = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
		if (clickTimerRef.current) {
			clearTimeout(clickTimerRef.current);
			clickTimerRef.current = null;
		}
		if (!canEdit || !storyId || renameStory.isPending) {
			return;
		}

		setDraft(displayTitle);
		isEditingRef.current = true;
		setIsEditing(true);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	};

	const finishEditing = () => {
		isEditingRef.current = false;
		setIsEditing(false);
	};

	const cancel = () => {
		setDraft(displayTitle);
		finishEditing();
	};

	const submit = async () => {
		if (!isEditingRef.current || submittingRef.current || !storyId) {
			return;
		}

		const title = draft.trim();
		if (!title || title === displayTitle) {
			cancel();
			return;
		}

		submittingRef.current = true;
		try {
			await renameStory.mutateAsync({ storyId, title });
			setDisplayTitle(title);
		} catch {
			setDraft(displayTitle);
		} finally {
			submittingRef.current = false;
			finishEditing();
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void submit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
		}
	};

	if (isEditing) {
		return (
			<input
				ref={inputRef}
				value={draft}
				maxLength={255}
				aria-label='Story title'
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => void submit()}
				onKeyDown={handleKeyDown}
				onClick={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				disabled={renameStory.isPending}
				className={cn(
					'field-sizing-content w-auto min-w-20 max-w-full shrink rounded border border-border bg-transparent px-1 -mx-1 outline-none',
					inputClassName,
				)}
			/>
		);
	}

	const Heading = heading;
	return (
		<Heading
			onClick={handleClick}
			onDoubleClick={startEditing}
			className={cn(canEdit && storyId && !renameStory.isPending && 'cursor-text', className)}
		>
			{displayTitle}
		</Heading>
	);
}

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface Props {
	chatId: string;
	title: string;
	className?: string;
}

export function EditableChatTitle({ chatId, title: currentTitle, className }: Props) {
	const inputRef = useRef<HTMLInputElement>(null);
	const submittingRef = useRef(false);
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(currentTitle);

	const renameChat = useMutation(
		trpc.chat.rename.mutationOptions({
			onSuccess: (_data, vars, _res, ctx) => {
				ctx.client.setQueryData(trpc.chat.list.queryKey(), (prev) => {
					if (!prev) {
						return prev;
					}
					return {
						...prev,
						chats: prev.chats.map((c) => (c.id === vars.chatId ? { ...c, title: vars.title } : c)),
					};
				});
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId }), (prev) => {
					if (!prev) {
						return prev;
					}
					return { ...prev, title: vars.title };
				});
			},
			onSettled: () => {
				setIsEditing(false);
			},
		}),
	);

	const startEditing = () => {
		setDraft(currentTitle);
		setIsEditing(true);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	};

	const submit = async () => {
		if (!isEditing || submittingRef.current) {
			return;
		}
		const trimmed = draft.trim();
		if (trimmed && trimmed !== currentTitle) {
			submittingRef.current = true;
			try {
				await renameChat.mutateAsync({ chatId, title: trimmed });
			} finally {
				submittingRef.current = false;
			}
		} else {
			setDraft(currentTitle);
			setIsEditing(false);
		}
	};

	const cancel = () => {
		setDraft(currentTitle);
		setIsEditing(false);
	};

	return (
		<input
			ref={inputRef}
			value={isEditing ? draft : currentTitle}
			readOnly={!isEditing}
			onChange={(e) => setDraft(e.target.value)}
			onClick={() => !isEditing && startEditing()}
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					submit();
				} else if (e.key === 'Escape') {
					cancel();
				}
			}}
			onBlur={submit}
			disabled={renameChat.isPending}
			className={cn(
				'bg-transparent text-inherit outline-none truncate w-full',
				'rounded-md border border-transparent px-2 py-1 -mx-2 -my-1',
				'transition-colors cursor-default',
				!isEditing && 'hover:border-border hover:cursor-text',
				isEditing && 'border-border cursor-text',
				className,
			)}
		/>
	);
}

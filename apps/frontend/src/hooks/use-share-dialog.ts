import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useMemberPicker(currentUserId: string | undefined, initialIds?: string[], chatId?: string) {
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set(initialIds));
	const [search, setSearch] = useState('');

	const membersByChatQuery = useQuery({
		...trpc.project.getProjectMembersByChatId.queryOptions({ chatId: chatId! }),
		enabled: !!chatId,
	});
	const membersDefaultQuery = useQuery({
		...trpc.project.listAllUsersWithRoles.queryOptions(),
		enabled: !chatId,
	});
	const membersQuery = chatId ? membersByChatQuery : membersDefaultQuery;

	const otherMembers = useMemo(() => {
		return (membersQuery.data ?? []).filter((m) => m.id !== currentUserId);
	}, [membersQuery.data, currentUserId]);

	const filteredMembers = useMemo(() => {
		if (!search.trim()) {
			return otherMembers;
		}
		const q = search.toLowerCase();
		return otherMembers.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
	}, [otherMembers, search]);

	const toggleUser = useCallback((userId: string) => {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) {
				next.delete(userId);
			} else {
				next.add(userId);
			}
			return next;
		});
	}, []);

	const reset = useCallback((ids?: string[]) => {
		setSelectedUserIds(new Set(ids));
		setSearch('');
	}, []);

	return {
		selectedUserIds,
		setSelectedUserIds,
		search,
		setSearch,
		otherMembers,
		filteredMembers,
		toggleUser,
		membersQuery,
		reset,
	};
}

export function useCopyWithFeedback(delay = 1500) {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	const copy = useCallback(
		(text: string) => {
			navigator.clipboard.writeText(text);
			setIsCopied(true);
			clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(() => setIsCopied(false), delay);
		},
		[delay],
	);

	return { isCopied, copy };
}

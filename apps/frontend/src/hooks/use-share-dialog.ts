import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

export function useShareAudience() {
	const activeProjectId = useActiveProjectId();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projectId = project.data?.id;
	const hasProject = projectId != null && (!activeProjectId || activeProjectId === projectId);
	const access = useQuery({
		...trpc.userGroup.projectSharingAccess.queryOptions(),
		enabled: hasProject,
	});
	const canShareToProject = hasProject && !access.isFetching && access.data?.canShareToProject === true;
	return {
		canShareToProject,
		emptyMessage: canShareToProject ? undefined : 'No other members in your groups',
	};
}

export function useMemberPicker(currentUserId: string | undefined, initialIds: string[] | undefined, chatId: string) {
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set(initialIds));
	const [search, setSearch] = useState('');

	const activeProjectId = useActiveProjectId();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projectId = project.data?.id;
	const hasProject = projectId != null && (!activeProjectId || activeProjectId === projectId);
	const membersQuery = useQuery({
		...trpc.project.getProjectMembersByChatId.queryOptions({ chatId }),
		enabled: hasProject,
	});

	const otherMembers = useMemo(() => {
		return hasProject && !membersQuery.isFetching
			? (membersQuery.data ?? []).filter((m) => m.id !== currentUserId)
			: [];
	}, [hasProject, membersQuery.data, membersQuery.isFetching, currentUserId]);

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
		isLoading: membersQuery.isFetching,
		membersQuery,
		reset,
	};
}

export function useGroupPicker(search: string, initialIds: string[] | undefined) {
	const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set(initialIds));

	const groupsQuery = useQuery(trpc.storyShare.listShareableGroups.queryOptions());

	const filteredGroups = useMemo(() => {
		const groups = groupsQuery.data ?? [];
		if (!search.trim()) {
			return groups;
		}
		const q = search.toLowerCase();
		return groups.filter((group) => group.name.toLowerCase().includes(q));
	}, [groupsQuery.data, search]);

	const toggleGroup = useCallback((groupId: string) => {
		setSelectedGroupIds((prev) => {
			const next = new Set(prev);
			if (next.has(groupId)) {
				next.delete(groupId);
			} else {
				next.add(groupId);
			}
			return next;
		});
	}, []);

	const reset = useCallback((ids?: string[]) => {
		setSelectedGroupIds(new Set(ids));
	}, []);

	return {
		selectedGroupIds,
		filteredGroups,
		toggleGroup,
		groupsQuery,
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

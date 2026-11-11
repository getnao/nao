import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ShareCandidate } from '@/lib/share-access';
import { useActiveProjectId } from '@/lib/active-project';
import { formatMemberCount, shareSubjectKey } from '@/lib/share-access';
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
		isLoading: project.isLoading || access.isLoading,
		emptyMessage: canShareToProject ? undefined : 'No other members in your groups',
	};
}

export function useShareCandidates({
	chatId,
	withGroups,
	excludedKeys,
	enabled,
}: {
	chatId: string;
	withGroups: boolean;
	excludedKeys: Set<string>;
	enabled: boolean;
}) {
	const activeProjectId = useActiveProjectId();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projectId = project.data?.id;
	const hasProject = projectId != null && (!activeProjectId || activeProjectId === projectId);
	const membersQuery = useQuery({
		...trpc.project.getProjectMembersByChatId.queryOptions({ chatId }),
		enabled: enabled && hasProject,
	});
	const groupsQuery = useQuery({
		...trpc.storyShare.listShareableGroups.queryOptions(),
		enabled: enabled && withGroups && hasProject,
	});
	const showsGroups = withGroups && hasProject && !groupsQuery.isFetching;

	const candidates = useMemo<ShareCandidate[]>(() => {
		const groups = showsGroups
			? (groupsQuery.data ?? []).map((group) => ({
					key: shareSubjectKey('group', group.id),
					kind: 'group' as const,
					id: group.id,
					name: group.name,
					detail: formatMemberCount(group.memberCount),
				}))
			: [];
		const members = hasProject && !membersQuery.isFetching ? (membersQuery.data ?? []) : [];
		const people = members.map((member) => ({
			key: shareSubjectKey('user', member.id),
			kind: 'user' as const,
			id: member.id,
			name: member.name,
			detail: member.email,
		}));
		return [...groups, ...people].filter((candidate) => !excludedKeys.has(candidate.key));
	}, [showsGroups, groupsQuery.data, hasProject, membersQuery.isFetching, membersQuery.data, excludedKeys]);

	return { candidates, isLoading: membersQuery.isFetching || (withGroups && groupsQuery.isFetching) };
}

/** Runs one sharing change at a time and keeps the last failed one so it can be retried. */
export function useShareActionRunner(onSettled: () => Promise<unknown>) {
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(
		async (action: () => Promise<unknown>): Promise<boolean> => {
			setIsPending(true);
			setError(null);
			try {
				await action();
				return true;
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : 'Something went wrong.');
				return false;
			} finally {
				await onSettled();
				setIsPending(false);
			}
		},
		[onSettled],
	);

	const dismissError = useCallback(() => {
		setError(null);
	}, []);

	return { run, dismissError, isPending, error };
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

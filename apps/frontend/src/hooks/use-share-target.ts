import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShareRole } from '@nao/shared/types';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

import type { GeneralAccess, ShareGrant, ShareOwner } from '@/lib/share-access';
import type { ShareDraft } from '@/lib/share-draft';
import { formatMemberCount, shareSubjectKey, toShareSelection } from '@/lib/share-access';
import { isShareDraftEmpty, toSavedGrants } from '@/lib/share-draft';
import { invalidateStoriesCaches } from '@/lib/stories-cache';
import { trpc } from '@/main';

export type ShareTarget =
	| { kind: 'chat'; chatId: string }
	| { kind: 'story'; chatId: string; storySlug: string }
	| { kind: 'standalone-story'; storyId: string }
	| { kind: 'automation'; automationId: string };

type StoryShareLookup = { chatId: string; storySlug: string } | { storyId: string };

export interface ShareModel {
	itemLabel: 'chat' | 'story' | 'automation';
	storyId: string | null;
	owner: ShareOwner | null;
	grants: ShareGrant[];
	generalAccess: GeneralAccess;
	isShared: boolean;
	canManage: boolean;
	withRoles: boolean;
	withGroups: boolean;
	shareUrl: string | null;
	placement: SharePlacement | null;
}

interface SharePlacement {
	folderId: string | null;
	lastUsedFolderId: string | null;
}

interface ShareSaveOptions {
	notify: boolean;
	folderId?: string | null;
}

export interface ShareCommands {
	save: (draft: ShareDraft, options: ShareSaveOptions) => Promise<string | null>;
	invalidate: () => Promise<unknown>;
}

export interface ShareTargetState {
	isLoading: boolean;
	model: ShareModel | undefined;
	refetch: () => void;
	commands: ShareCommands;
}

/** Chats, stories and automations expose the same sharing model so one dialog can manage them all. */
export function useShareTarget(target: ShareTarget, enabled: boolean): ShareTargetState {
	const chat = useChatShareTarget(target.kind === 'chat' ? target : null, enabled);
	const automation = useAutomationShareTarget(target.kind === 'automation' ? target : null, enabled);
	const story = useStoryShareTarget(target.kind === 'chat' || target.kind === 'automation' ? null : target, enabled);
	if (target.kind === 'chat') {
		return chat;
	}
	return target.kind === 'automation' ? automation : story;
}

type ChatShareSettings = inferRouterOutputs<TrpcRouter>['sharedChat']['getShareSettings'];
type StoryShareSettings = inferRouterOutputs<TrpcRouter>['storyShare']['getShareSettings'];
type AutomationShareSettings = inferRouterOutputs<TrpcRouter>['automation']['getShareSettings'];

function useChatShareTarget(target: { chatId: string } | null, enabled: boolean): ShareTargetState {
	const chatId = target?.chatId ?? '';
	const queryClient = useQueryClient();
	const query = useQuery({
		...trpc.sharedChat.getShareSettings.queryOptions({ chatId }),
		enabled: enabled && target !== null,
	});
	const saveSettings = useMutation(trpc.sharedChat.saveShareSettings.mutationOptions());

	const invalidate = useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.sharedChat.getShareSettings.queryKey({ chatId }) }),
				queryClient.invalidateQueries({ queryKey: trpc.sharedChat.list.queryKey() }),
			]),
		[queryClient, chatId],
	);

	return {
		isLoading: query.isLoading,
		model: query.data && toChatModel(query.data),
		refetch: () => void query.refetch(),
		commands: {
			save: async (draft, { notify }) => {
				const { shareId } = await saveSettings.mutateAsync({
					chatId,
					visibility: draft.visibility,
					...toShareSelection(toSavedGrants(draft)),
					notify,
				});
				return shareId && buildSharedChatUrl(shareId);
			},
			invalidate,
		},
	};
}

function useStoryShareTarget(target: StoryShareLookup | null, enabled: boolean): ShareTargetState {
	const lookup = useStoryShareLookup(target);
	const queryClient = useQueryClient();
	const query = useQuery({
		...trpc.storyShare.getShareSettings.queryOptions(lookup),
		enabled: enabled && target !== null,
	});
	const storyId = query.data?.storyId ?? '';
	const saveSettings = useMutation(trpc.storyShare.saveShareSettings.mutationOptions());

	const invalidate = useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.getShareSettings.queryKey(lookup) }),
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.getSharedStoryInfo.queryKey(lookup) }),
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() }),
				invalidateStoriesCaches(queryClient),
			]),
		[queryClient, lookup],
	);

	return {
		isLoading: query.isLoading,
		model: query.data && toStoryModel(query.data),
		refetch: () => void query.refetch(),
		commands: {
			save: async (draft, { notify, folderId }) => {
				const grants = toSavedGrants(draft);
				await saveSettings.mutateAsync({
					storyId,
					visibility: draft.visibility,
					projectRole: draft.projectRole,
					users: toRoleGrants(grants, 'user'),
					groups: toRoleGrants(grants, 'group'),
					folderId,
					notify,
				});
				return isShareDraftEmpty(draft) ? null : buildStoryUrl(storyId);
			},
			invalidate,
		},
	};
}

function useAutomationShareTarget(target: { automationId: string } | null, enabled: boolean): ShareTargetState {
	const id = target?.automationId ?? '';
	const queryClient = useQueryClient();
	const query = useQuery({
		...trpc.automation.getShareSettings.queryOptions({ id }),
		enabled: enabled && target !== null,
	});
	const saveSettings = useMutation(trpc.automation.saveShareSettings.mutationOptions());

	const invalidate = useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.automation.getShareSettings.queryKey({ id }) }),
				queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() }),
			]),
		[queryClient, id],
	);

	return {
		isLoading: query.isLoading,
		model: query.data && toAutomationModel(query.data),
		refetch: () => void query.refetch(),
		commands: {
			save: async (draft) => {
				const grants = toSavedGrants(draft);
				await saveSettings.mutateAsync({
					id,
					visibility: draft.visibility,
					projectRole: draft.projectRole,
					users: toRoleGrants(grants, 'user'),
					groups: toRoleGrants(grants, 'group'),
				});
				return isShareDraftEmpty(draft) ? null : buildAutomationUrl(id);
			},
			invalidate,
		},
	};
}

function useStoryShareLookup(target: StoryShareLookup | null): StoryShareLookup {
	const storyId = target && 'storyId' in target ? target.storyId : null;
	const chatId = target && 'chatId' in target ? target.chatId : '';
	const storySlug = target && 'storySlug' in target ? target.storySlug : '';
	return useMemo(() => (storyId ? { storyId } : { chatId, storySlug }), [storyId, chatId, storySlug]);
}

function toChatModel(settings: ChatShareSettings): ShareModel {
	return {
		itemLabel: 'chat',
		storyId: null,
		owner: settings.owner,
		grants: [
			...settings.groups.map((group) => ({
				key: shareSubjectKey('group', group.id),
				kind: 'group' as const,
				id: group.id,
				name: group.name,
				detail: formatMemberCount(group.memberCount),
				role: 'viewer' as const,
			})),
			...settings.users.map((user) => ({
				key: shareSubjectKey('user', user.id),
				kind: 'user' as const,
				id: user.id,
				name: user.name,
				detail: user.email,
				role: 'viewer' as const,
			})),
		],
		generalAccess: { visibility: settings.visibility, projectRole: 'viewer' },
		isShared: settings.shareId !== null,
		canManage: settings.canManage,
		withRoles: false,
		withGroups: true,
		shareUrl: settings.shareId && buildSharedChatUrl(settings.shareId),
		placement: null,
	};
}

function toStoryModel(settings: StoryShareSettings): ShareModel {
	return {
		itemLabel: 'story',
		storyId: settings.storyId,
		owner: settings.owner,
		grants: toRoleShareGrants(settings),
		generalAccess: { visibility: settings.visibility, projectRole: settings.projectRole },
		isShared: settings.isShared,
		canManage: settings.canManage,
		withRoles: true,
		withGroups: true,
		shareUrl: buildStoryUrl(settings.storyId),
		placement: { folderId: settings.folderId, lastUsedFolderId: settings.lastUsedFolderId },
	};
}

function toAutomationModel(settings: AutomationShareSettings): ShareModel {
	return {
		itemLabel: 'automation',
		storyId: null,
		owner: settings.owner,
		grants: toRoleShareGrants(settings),
		generalAccess: { visibility: settings.visibility, projectRole: settings.projectRole },
		isShared: settings.isShared,
		canManage: settings.canManage,
		withRoles: true,
		withGroups: true,
		shareUrl: buildAutomationUrl(settings.automationId),
		placement: null,
	};
}

function toRoleShareGrants(settings: {
	users: { id: string; name: string; email: string; role: ShareRole }[];
	groups: { id: string; name: string; memberCount: number; role: ShareRole }[];
}): ShareGrant[] {
	const groups: ShareGrant[] = settings.groups.map((group) => ({
		key: shareSubjectKey('group', group.id),
		kind: 'group',
		id: group.id,
		name: group.name,
		detail: formatMemberCount(group.memberCount),
		role: group.role,
	}));
	const people: ShareGrant[] = settings.users.map((user) => ({
		key: shareSubjectKey('user', user.id),
		kind: 'user',
		id: user.id,
		name: user.name,
		detail: user.email,
		role: user.role,
	}));
	return [...groups, ...people];
}

function toRoleGrants(grants: ShareGrant[], kind: ShareGrant['kind']): { id: string; role: ShareRole }[] {
	return grants.filter((grant) => grant.kind === kind).map((grant) => ({ id: grant.id, role: grant.role }));
}

function buildSharedChatUrl(shareId: string): string {
	return `${window.location.origin}/shared-chat/${shareId}`;
}

function buildStoryUrl(storyId: string): string {
	return `${window.location.origin}/stories/${storyId}`;
}

function buildAutomationUrl(automationId: string): string {
	return `${window.location.origin}/automations/${automationId}`;
}

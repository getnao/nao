import type { Visibility } from './types';

export const AUTHENTICATED_STORY_SHARE_PATH = '/stories/shared';
export const PUBLIC_STORY_SHARE_PATH = '/public/stories';
export const PUBLIC_ROUTE_PREFIX = '/public';

export function isPublicShareVisibility(visibility: Visibility): visibility is 'public' {
	return visibility === 'public';
}

export function isPublicAppRoute(pathname: string): boolean {
	return pathname === PUBLIC_ROUTE_PREFIX || pathname.startsWith(`${PUBLIC_ROUTE_PREFIX}/`);
}

export function canAccessAuthenticatedSharedStory({
	visibility,
	ownerUserId,
	viewerUserId,
	hasSpecificAccess,
}: {
	visibility: Visibility;
	ownerUserId: string;
	viewerUserId: string;
	hasSpecificAccess: boolean;
}): boolean {
	if (visibility === 'public' || visibility === 'project') {
		return true;
	}

	return ownerUserId === viewerUserId || hasSpecificAccess;
}

export function buildStorySharePath(shareId: string, visibility: Visibility): string {
	const base = isPublicShareVisibility(visibility) ? PUBLIC_STORY_SHARE_PATH : AUTHENTICATED_STORY_SHARE_PATH;
	return `${base}/${shareId}`;
}

export function buildStoryShareUrl(shareId: string, visibility: Visibility, origin: string): string {
	return `${origin}${buildStorySharePath(shareId, visibility)}`;
}

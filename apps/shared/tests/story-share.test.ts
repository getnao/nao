import { describe, expect, it } from 'vitest';

import {
	AUTHENTICATED_STORY_SHARE_PATH,
	buildStorySharePath,
	buildStoryShareUrl,
	canAccessAuthenticatedSharedStory,
	isPublicAppRoute,
	isPublicShareVisibility,
	PUBLIC_ROUTE_PREFIX,
	PUBLIC_STORY_SHARE_PATH,
} from '../src/story-share';

describe('story share urls', () => {
	it('detects public visibility', () => {
		expect(isPublicShareVisibility('public')).toBe(true);
		expect(isPublicShareVisibility('project')).toBe(false);
		expect(isPublicShareVisibility('specific')).toBe(false);
	});

	it('builds authenticated share paths for project and specific visibility', () => {
		expect(buildStorySharePath('share-1', 'project')).toBe(`${AUTHENTICATED_STORY_SHARE_PATH}/share-1`);
		expect(buildStorySharePath('share-1', 'specific')).toBe(`${AUTHENTICATED_STORY_SHARE_PATH}/share-1`);
	});

	it('builds public share paths for public visibility', () => {
		expect(buildStorySharePath('share-1', 'public')).toBe(`${PUBLIC_STORY_SHARE_PATH}/share-1`);
	});

	it('builds full share urls from an origin', () => {
		expect(buildStoryShareUrl('share-1', 'public', 'https://app.example.com')).toBe(
			'https://app.example.com/public/stories/share-1',
		);
		expect(buildStoryShareUrl('share-1', 'project', 'https://app.example.com')).toBe(
			'https://app.example.com/stories/shared/share-1',
		);
	});

	it('detects public app routes', () => {
		expect(isPublicAppRoute(PUBLIC_ROUTE_PREFIX)).toBe(true);
		expect(isPublicAppRoute(`${PUBLIC_STORY_SHARE_PATH}/share-1`)).toBe(true);
		expect(isPublicAppRoute('/stories/shared/share-1')).toBe(false);
	});

	it('checks authenticated access for shared stories', () => {
		expect(
			canAccessAuthenticatedSharedStory({
				visibility: 'public',
				ownerUserId: 'owner',
				viewerUserId: 'viewer',
				hasSpecificAccess: false,
			}),
		).toBe(true);
		expect(
			canAccessAuthenticatedSharedStory({
				visibility: 'specific',
				ownerUserId: 'owner',
				viewerUserId: 'viewer',
				hasSpecificAccess: false,
			}),
		).toBe(false);
		expect(
			canAccessAuthenticatedSharedStory({
				visibility: 'specific',
				ownerUserId: 'owner',
				viewerUserId: 'viewer',
				hasSpecificAccess: true,
			}),
		).toBe(true);
	});
});

import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import { logger } from '../utils/logger';

export type LinkPreviewMetadata = {
	title: string;
	description: string;
};

type ShareKind = 'story' | 'chat';

type SharedResource = {
	title: string;
	projectId: string;
	visibility: string;
};

const SHARE_ROUTES: Array<{ kind: ShareKind; pattern: RegExp }> = [
	{ kind: 'story', pattern: /^\/stories\/shared\/([^/]+)\/?$/ },
	{ kind: 'chat', pattern: /^\/shared-chat\/([^/]+)\/?$/ },
];

const GENERIC_PREVIEWS: Record<ShareKind, LinkPreviewMetadata> = {
	story: {
		title: 'A story was shared with you on nao',
		description: 'Sign in to nao to view the charts and insights in this story.',
	},
	chat: {
		title: 'A conversation was shared with you on nao',
		description: 'Sign in to nao to read the full conversation.',
	},
};

const TITLED_DESCRIPTIONS: Record<ShareKind, string> = {
	story: 'A story shared on nao. Sign in to view the charts and insights.',
	chat: 'A conversation shared on nao. Sign in to read the full thread.',
};

const MAX_TITLE_LENGTH = 120;

/**
 * Metadata for anonymous crawlers, so nothing here may depend on who is asking. Titles are only
 * revealed for project-wide shares when the project opted in; every other case (unknown id,
 * restricted share, opt-out, lookup failure) returns the same generic text so a share id cannot
 * be probed for existence.
 */
export async function resolveLinkPreview(requestUrl: string): Promise<LinkPreviewMetadata | null> {
	const match = matchShareRoute(requestUrl);
	if (!match) {
		return null;
	}
	try {
		const resource = await loadSharedResource(match.kind, match.shareId);
		if (resource && (await canRevealTitle(resource))) {
			return { title: truncate(resource.title), description: TITLED_DESCRIPTIONS[match.kind] };
		}
	} catch (error) {
		logger.warn(`Link preview lookup failed: ${error instanceof Error ? error.message : String(error)}`, {
			source: 'system',
		});
	}
	return GENERIC_PREVIEWS[match.kind];
}

function matchShareRoute(requestUrl: string): { kind: ShareKind; shareId: string } | null {
	const pathname = requestUrl.split(/[?#]/, 1)[0];
	for (const route of SHARE_ROUTES) {
		const shareId = route.pattern.exec(pathname)?.[1];
		if (shareId) {
			return { kind: route.kind, shareId: safeDecode(shareId) };
		}
	}
	return null;
}

function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

async function loadSharedResource(kind: ShareKind, shareId: string): Promise<SharedResource | null> {
	if (kind === 'story') {
		return sharedStoryQueries.getSharedStory(shareId);
	}
	return sharedChatQueries.getSharedChatInfo(shareId);
}

async function canRevealTitle(resource: SharedResource): Promise<boolean> {
	if (resource.visibility !== 'project' || !resource.title.trim()) {
		return false;
	}
	const displaySettings = await projectQueries.getDisplaySettings(resource.projectId);
	return displaySettings.linkPreviews?.showSharedTitles === true;
}

function truncate(title: string): string {
	const trimmed = title.trim();
	return trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}…` : trimmed;
}

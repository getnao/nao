import type { UserStoryRow } from '../queries/story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';

export type StoryTargetContext = {
	userId: string;
	projectId: string;
};

export class StoryTargetError extends Error {
	constructor(
		public readonly code: 'conflict' | 'not_found',
		message: string,
	) {
		super(message);
		this.name = 'StoryTargetError';
	}
}

export type StoryTargetDependencies = {
	createStandaloneStory: typeof storyQueries.createStandaloneStory;
	saveStoryInPrivateRoot: typeof storyFolderQueries.saveStoryInPrivateRoot;
	getStoryByIdForUser: typeof storyQueries.getStoryByIdForUser;
	getStoryProjectId: typeof storyQueries.getStoryProjectId;
	renameStory: typeof storyQueries.renameStory;
	createStoryVersion: typeof storyQueries.createStoryVersion;
	getStoryByChatAndSlug: typeof storyQueries.getStoryByChatAndSlug;
	createStandaloneVersion: typeof storyQueries.createStandaloneVersion;
	getStandaloneStoryByUserAndSlug: typeof storyQueries.getStandaloneStoryByUserAndSlug;
};

const defaultDependencies: StoryTargetDependencies = {
	createStandaloneStory: storyQueries.createStandaloneStory,
	saveStoryInPrivateRoot: storyFolderQueries.saveStoryInPrivateRoot,
	getStoryByIdForUser: storyQueries.getStoryByIdForUser,
	getStoryProjectId: storyQueries.getStoryProjectId,
	renameStory: storyQueries.renameStory,
	createStoryVersion: storyQueries.createStoryVersion,
	getStoryByChatAndSlug: storyQueries.getStoryByChatAndSlug,
	createStandaloneVersion: storyQueries.createStandaloneVersion,
	getStandaloneStoryByUserAndSlug: storyQueries.getStandaloneStoryByUserAndSlug,
};

export class StoryTargetService {
	constructor(private readonly dependencies: StoryTargetDependencies = defaultDependencies) {}

	async createStandaloneStory(
		context: StoryTargetContext,
		input: { title: string; code?: string },
	): Promise<{ id: string; title: string; slug: string; chatId: null; createdAt: Date }> {
		const slug = generateSlug(input.title);
		const story = await this.dependencies.createStandaloneStory({
			userId: context.userId,
			projectId: context.projectId,
			slug,
			title: input.title,
			code: input.code ?? `# ${input.title}\n`,
			source: 'user',
		});
		if (!story) {
			throw new StoryTargetError(
				'conflict',
				`A story with title "${input.title}" already exists. Pick a different title or update it by ID.`,
			);
		}

		await this.dependencies.saveStoryInPrivateRoot(context.userId, context.projectId, story.id);
		return { ...story, chatId: null };
	}

	async updateStoryById(
		context: StoryTargetContext,
		input: { storyId: string; title?: string; code?: string },
	): Promise<{
		story: Pick<UserStoryRow, 'id' | 'slug' | 'chatId'>;
		code: string;
		updated: { id: string; title: string; updatedAt: Date };
	}> {
		const story = await this.dependencies.getStoryByIdForUser(input.storyId, context.userId);
		if (!story || (await this.dependencies.getStoryProjectId(input.storyId)) !== context.projectId) {
			throw new StoryTargetError('not_found', `Story not found: ${input.storyId}`);
		}

		const title = input.title ?? story.title;
		const code = input.code ?? story.code;
		if (input.title !== undefined && input.title !== story.title) {
			await this.dependencies.renameStory(story.id, input.title);
		}

		const updated = await this.saveNewVersion(story, context, title, code);
		return { story, code, updated };
	}

	private async saveNewVersion(
		story: Pick<UserStoryRow, 'id' | 'slug' | 'chatId'>,
		context: StoryTargetContext,
		title: string,
		code: string,
	): Promise<{ id: string; title: string; updatedAt: Date }> {
		if (story.chatId) {
			await this.dependencies.createStoryVersion({
				chatId: story.chatId,
				slug: story.slug,
				title,
				code,
				action: 'update',
				source: 'user',
			});
			const updated = await this.dependencies.getStoryByChatAndSlug(story.chatId, story.slug);
			if (!updated) {
				throw new Error(`Failed to retrieve updated story: ${story.chatId}/${story.slug}`);
			}
			return { id: updated.id, title: updated.title, updatedAt: updated.updatedAt };
		}

		await this.dependencies.createStandaloneVersion({
			userId: context.userId,
			projectId: context.projectId,
			slug: story.slug,
			title,
			code,
			action: 'update',
			source: 'user',
		});
		const updated = await this.dependencies.getStandaloneStoryByUserAndSlug(
			context.userId,
			context.projectId,
			story.slug,
		);
		if (!updated) {
			throw new Error(`Failed to retrieve updated story: ${context.userId}/${story.slug}`);
		}
		return { id: updated.id, title: updated.title, updatedAt: updated.updatedAt };
	}
}

function generateSlug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'untitled'
	);
}

export const storyTargetService = new StoryTargetService();

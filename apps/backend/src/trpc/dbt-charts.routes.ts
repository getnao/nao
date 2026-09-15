import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import * as dbtChartsService from '../services/dbt-charts.service';
import { listProjectBoards, readProjectBoard } from '../services/dbt-charts-boards';
import { canSendProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';

const boardPathInput = z.object({ boardPath: z.string().min(1) });

const variablesInput = z.record(z.string(), z.unknown()).optional();

export const dbtChartsRoutes = {
	status: protectedProcedure.query(() => dbtChartsService.getDbtChartsStatus()),

	listProjectBoards: projectProtectedProcedure.query(({ ctx }) => {
		if (!ctx.project.path) {
			return [];
		}
		return listProjectBoards(ctx.project.path);
	}),

	getProjectBoard: projectProtectedProcedure.input(boardPathInput).query(({ input, ctx }) => {
		const board = ctx.project.path ? readProjectBoard(ctx.project.path, input.boardPath) : null;
		if (!board) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found.' });
		}
		return board;
	}),

	validate: projectProtectedProcedure
		.input(z.object({ yaml: z.string(), databaseId: z.string().optional() }))
		.mutation(({ input, ctx }) => dbtChartsService.validateBoard(ctx.project.id, input.yaml, input.databaseId)),

	/** Copies a project board into a standalone dbt Charts story the user can edit and iterate on in chat. */
	importProjectBoard: canSendProcedure.input(boardPathInput).mutation(async ({ input, ctx }) => {
		const board = ctx.project.path ? readProjectBoard(ctx.project.path, input.boardPath) : null;
		if (!board) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found.' });
		}
		const slug = await uniqueStorySlug(ctx.user.id, ctx.project.id, slugify(board.title));
		const story = await storyQueries.createStandaloneStory({
			userId: ctx.user.id,
			projectId: ctx.project.id,
			slug,
			title: board.title,
			code: board.yaml,
			source: 'user',
			format: 'dbt_charts',
		});
		if (!story) {
			throw new TRPCError({ code: 'CONFLICT', message: 'Could not create a story for this board.' });
		}
		await storyFolderQueries.saveStoryInPrivateRoot(ctx.user.id, ctx.project.id, story.id);
		return { storyId: story.id };
	}),

	render: projectProtectedProcedure
		.input(z.object({ yaml: z.string(), variables: variablesInput, databaseId: z.string().optional() }))
		.mutation(({ input, ctx }) =>
			dbtChartsService.renderBoard(ctx.project.id, input.yaml, {
				variables: input.variables,
				databaseId: input.databaseId,
			}),
		),
};

async function uniqueStorySlug(userId: string, projectId: string, base: string): Promise<string> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
		if (!(await storyQueries.getStandaloneStoryByUserAndSlug(userId, projectId, candidate))) {
			return candidate;
		}
	}
	return `${base}-${Date.now()}`;
}

function slugify(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60) || 'board'
	);
}

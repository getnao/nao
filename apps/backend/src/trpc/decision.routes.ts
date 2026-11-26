import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { DECISION_PROVIDER_META } from '../agents/decision.providers';
import { isCloud } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as decisionConfigQueries from '../queries/project-decision-config.queries';
import * as decisionService from '../services/decision.service';
import { decisionModelSchema, decisionProviderSchema } from '../types/decision';
import { assertSafeHost } from '../utils/safe-fetch';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const decisionRoutes = {
	getSettings: projectProtectedProcedure.query(({ ctx }) => {
		return decisionService.getDecisionSettings(ctx.project.id);
	}),

	upsertProvider: adminProtectedProcedure
		.input(
			z.object({
				provider: decisionProviderSchema,
				apiKey: z.string().min(1).optional(),
				baseUrl: z.url().optional().or(z.literal('')),
				credentials: z.record(z.string(), z.string()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const meta = DECISION_PROVIDER_META[input.provider];
			const saved = await decisionConfigQueries.getProjectDecisionConfigs(ctx.project.id);
			const existing = saved.find((row) => row.provider === input.provider);

			const apiKey = input.apiKey ?? existing?.apiKey ?? null;
			const baseUrl = input.baseUrl || null;
			const credentials = { ...existing?.credentials, ...dropEmptyValues(input.credentials) };
			const missingField = (meta.extraFields ?? []).find((field) => !credentials[field.name]);

			if (meta.apiKey === 'required' && !apiKey) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: `${meta.label} needs an API key.` });
			}
			if (!baseUrl && !meta.defaultBaseUrl) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: `${meta.label} needs a base URL.` });
			}
			if (missingField) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: `${meta.label} needs its ${missingField.label}.` });
			}
			if (isCloud && baseUrl) {
				await assertPublicHost(baseUrl);
			}

			await decisionConfigQueries.upsertProjectDecisionConfig({
				projectId: ctx.project.id,
				provider: input.provider,
				apiKey,
				baseUrl,
				credentials: Object.keys(credentials).length > 0 ? credentials : null,
			});
		}),

	deleteProvider: adminProtectedProcedure
		.input(z.object({ provider: decisionProviderSchema }))
		.mutation(async ({ ctx, input }) => {
			await decisionConfigQueries.deleteProjectDecisionConfig(ctx.project.id, input.provider);
		}),

	setModel: adminProtectedProcedure.input(decisionModelSchema).mutation(async ({ ctx, input }) => {
		await projectQueries.updateAgentSettings(ctx.project.id, { decision: input });
	}),

	setQuickEdits: adminProtectedProcedure
		.input(z.object({ enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await projectQueries.updateAgentSettings(ctx.project.id, { decisionQuickEdits: input.enabled });
		}),

	/** Ask one yes/no question, so an admin can check that a model answers before anything relies on it. */
	test: adminProtectedProcedure
		.input(
			z.object({
				model: decisionModelSchema.optional(),
				state: z.string().trim().min(1).max(20_000),
				question: z.string().trim().min(1).max(2_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const startedAt = performance.now();
			try {
				const result = await decisionService.decide(
					{ projectId: ctx.project.id, userId: ctx.user.id },
					{ state: input.state, questions: { answer: { type: 'boolean', instructions: input.question } } },
					input.model,
				);
				return {
					...result.answers.answer,
					model: result.model,
					durationMs: Math.round(performance.now() - startedAt),
				};
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: error instanceof Error ? error.message : 'The decision model did not answer.',
				});
			}
		}),
};

function dropEmptyValues(values: Record<string, string> = {}): Record<string, string> {
	return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
}

/** Refused up front so the admin hears why, before a decision would fail on the same check. */
async function assertPublicHost(baseUrl: string): Promise<void> {
	try {
		await assertSafeHost(new URL(baseUrl).hostname);
	} catch (error) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
	}
}

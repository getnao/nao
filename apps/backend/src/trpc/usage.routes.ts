import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as usageQueries from '../queries/usage.queries';
import * as userProjectPreferenceQueries from '../queries/user-project-preference.queries';
import type { UserProjectPreferences } from '../types/usage';
import {
	DEFAULT_USAGE_PERIOD_PREFERENCE,
	usageChartFilterSchema,
	usageFilterSchema,
	usagePeriodEntryInputSchema,
	usagePeriodEntrySchema,
	usagePeriodPreferenceSchema,
} from '../types/usage';
import { adminProtectedProcedure } from './trpc';

const projectPreferenceInputSchema = z.object({ projectId: z.string().min(1) });
const updatePeriodPreferenceInputSchema = projectPreferenceInputSchema.extend({
	preference: usagePeriodPreferenceSchema,
});
const createPeriodEntryInputSchema = projectPreferenceInputSchema.extend({
	entry: usagePeriodEntryInputSchema,
});
const updatePeriodEntryInputSchema = projectPreferenceInputSchema.extend({
	entry: usagePeriodEntrySchema,
});
const deletePeriodEntryInputSchema = projectPreferenceInputSchema.extend({
	id: usagePeriodEntrySchema.shape.id,
});

export const usageRoutes = {
	getMessagesUsage: adminProtectedProcedure.input(usageChartFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getMessagesUsage(ctx.project.id, input);
	}),

	getTotalUsage: adminProtectedProcedure.input(usageFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getTotalUsage(ctx.project.id, input);
	}),

	getUsedProviders: adminProtectedProcedure.query(async ({ ctx }) => {
		return usageQueries.getUsedProviders(ctx.project.id);
	}),

	getPeriodSettings: adminProtectedProcedure.input(projectPreferenceInputSchema).query(async ({ ctx, input }) => {
		assertPreferenceProject(input.projectId, ctx.project.id);
		const preferences = await getSanitizedPeriodPreferences(ctx.user.id, ctx.project.id);
		return {
			preference: preferences.usagePeriod ?? null,
			entries: parsePeriodEntries(preferences),
		};
	}),

	updatePeriodPreference: adminProtectedProcedure
		.input(updatePeriodPreferenceInputSchema)
		.mutation(async ({ ctx, input }) => {
			assertPreferenceProject(input.projectId, ctx.project.id);
			const nextPreference = input.preference;
			const preferences = await userProjectPreferenceQueries.mutateUserProjectPreferences(
				ctx.user.id,
				ctx.project.id,
				(current) => {
					const sanitizedCurrent = sanitizePeriodPreferences(current).preferences;
					if (nextPreference.mode !== 'saved') {
						return { ...sanitizedCurrent, usagePeriod: nextPreference };
					}
					const entries = parsePeriodEntries(sanitizedCurrent);
					if (!entries.some(({ id }) => id === nextPreference.entryId)) {
						throw new TRPCError({ code: 'NOT_FOUND', message: 'Usage period entry not found.' });
					}
					return { ...sanitizedCurrent, usagePeriod: nextPreference };
				},
			);
			return preferences.usagePeriod;
		}),

	createPeriodEntry: adminProtectedProcedure.input(createPeriodEntryInputSchema).mutation(async ({ ctx, input }) => {
		assertPreferenceProject(input.projectId, ctx.project.id);
		const entry = { id: crypto.randomUUID(), ...input.entry };
		await userProjectPreferenceQueries.mutateUserProjectPreferences(ctx.user.id, ctx.project.id, (current) => {
			const sanitizedCurrent = sanitizePeriodPreferences(current).preferences;
			return {
				...sanitizedCurrent,
				usagePeriod: { mode: 'saved', entryId: entry.id },
				usagePeriodEntries: [...parsePeriodEntries(sanitizedCurrent), entry],
			};
		});
		return entry;
	}),

	updatePeriodEntry: adminProtectedProcedure.input(updatePeriodEntryInputSchema).mutation(async ({ ctx, input }) => {
		assertPreferenceProject(input.projectId, ctx.project.id);
		const nextEntry = input.entry;
		await userProjectPreferenceQueries.mutateUserProjectPreferences(ctx.user.id, ctx.project.id, (current) => {
			const sanitizedCurrent = sanitizePeriodPreferences(current).preferences;
			const entries = parsePeriodEntries(sanitizedCurrent);
			if (!entries.some(({ id }) => id === nextEntry.id)) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Usage period entry not found.' });
			}
			return {
				...sanitizedCurrent,
				usagePeriodEntries: entries.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)),
			};
		});
		return nextEntry;
	}),

	deletePeriodEntry: adminProtectedProcedure.input(deletePeriodEntryInputSchema).mutation(async ({ ctx, input }) => {
		assertPreferenceProject(input.projectId, ctx.project.id);
		const preferences = await userProjectPreferenceQueries.mutateUserProjectPreferences(
			ctx.user.id,
			ctx.project.id,
			(current) => {
				const sanitizedCurrent = sanitizePeriodPreferences(current).preferences;
				const entries = parsePeriodEntries(sanitizedCurrent);
				if (!entries.some(({ id }) => id === input.id)) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Usage period entry not found.' });
				}
				const usagePeriod =
					sanitizedCurrent.usagePeriod?.mode === 'saved' && sanitizedCurrent.usagePeriod.entryId === input.id
						? DEFAULT_USAGE_PERIOD_PREFERENCE
						: sanitizedCurrent.usagePeriod;
				return {
					...sanitizedCurrent,
					usagePeriod,
					usagePeriodEntries: entries.filter(({ id }) => id !== input.id),
				};
			},
		);
		return { id: input.id, usagePeriod: preferences.usagePeriod };
	}),
};

function parsePeriodEntries(preferences: UserProjectPreferences) {
	if (!Array.isArray(preferences.usagePeriodEntries)) {
		return [];
	}
	return preferences.usagePeriodEntries.flatMap((entry) => {
		const parsed = usagePeriodEntrySchema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}

async function getSanitizedPeriodPreferences(userId: string, projectId: string): Promise<UserProjectPreferences> {
	const current = await userProjectPreferenceQueries.getUserProjectPreferences(userId, projectId);
	const sanitized = sanitizePeriodPreferences(current);
	if (!sanitized.changed) {
		return sanitized.preferences;
	}
	return userProjectPreferenceQueries.mutateUserProjectPreferences(
		userId,
		projectId,
		(latest) => sanitizePeriodPreferences(latest).preferences,
	);
}

function sanitizePeriodPreferences(preferences: UserProjectPreferences): {
	preferences: UserProjectPreferences;
	changed: boolean;
} {
	const entries = parsePeriodEntries(preferences);
	const parsedPreference = usagePeriodPreferenceSchema.safeParse(preferences.usagePeriod);
	const usagePeriod =
		preferences.usagePeriod === undefined
			? undefined
			: parsedPreference.success && isExistingPeriodPreference(parsedPreference.data, entries)
				? parsedPreference.data
				: DEFAULT_USAGE_PERIOD_PREFERENCE;
	const sanitized = {
		...preferences,
		usagePeriod,
		usagePeriodEntries: preferences.usagePeriodEntries === undefined ? undefined : entries,
	};
	return {
		preferences: sanitized,
		changed: JSON.stringify(sanitized) !== JSON.stringify(preferences),
	};
}

function isExistingPeriodPreference(
	preference: NonNullable<UserProjectPreferences['usagePeriod']>,
	entries: ReturnType<typeof parsePeriodEntries>,
): boolean {
	return preference.mode !== 'saved' || entries.some(({ id }) => id === preference.entryId);
}

function assertPreferenceProject(inputProjectId: string, contextProjectId: string): void {
	if (inputProjectId !== contextProjectId) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Active project changed. Retry the request.' });
	}
}

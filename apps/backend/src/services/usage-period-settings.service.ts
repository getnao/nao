import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as userPreferenceQueries from '../queries/user-preference.queries';
import {
	DEFAULT_USAGE_PERIOD_SELECTION,
	MAX_SAVED_USAGE_PERIODS,
	type SavedUsagePeriod,
	savedUsagePeriodSchema,
	type StoredUserPreferences,
	usagePeriodSelectionSchema,
	type UserProjectPreferences,
} from '../types/usage';

type PeriodSettings = {
	preferences: UserProjectPreferences;
	savedPeriods: SavedUsagePeriod[];
};

type PeriodSettingsTransform = (settings: PeriodSettings) => UserProjectPreferences;

const legacySavedPeriodSelectionSchema = z.object({
	mode: z.literal('saved'),
	entryId: z.string().min(1),
});

export async function getAndRepairPeriodSettings(userId: string, projectId: string): Promise<PeriodSettings> {
	const userPreferences = await userPreferenceQueries.getUserPreferences(userId);
	const current = getProjectPreferences(userPreferences, projectId);
	const sanitized = sanitizePeriodSettings(current);
	if (!sanitized.changed) {
		return sanitized;
	}

	const repairedUserPreferences = await userPreferenceQueries.mutateUserPreferences(userId, (latest) => {
		const preferences = getProjectPreferences(latest, projectId);
		const repaired = sanitizePeriodSettings(preferences).preferences;
		return setProjectPreferences(latest, projectId, repaired);
	});
	const preferences = getProjectPreferences(repairedUserPreferences, projectId);
	return {
		preferences,
		savedPeriods: sanitizeSavedPeriods(preferences),
	};
}

export async function mutatePeriodSettings(
	userId: string,
	projectId: string,
	transform: PeriodSettingsTransform,
): Promise<UserProjectPreferences> {
	const userPreferences = await userPreferenceQueries.mutateUserPreferences(userId, (current) => {
		const projectPreferences = getProjectPreferences(current, projectId);
		const { preferences, savedPeriods } = sanitizePeriodSettings(projectPreferences);
		const updated = transform({ preferences, savedPeriods });
		return setProjectPreferences(current, projectId, updated);
	});
	return getProjectPreferences(userPreferences, projectId);
}

export function assertSavedPeriodExists(savedPeriods: SavedUsagePeriod[], id: string): void {
	if (!savedPeriods.some((savedPeriod) => savedPeriod.id === id)) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved usage period not found.' });
	}
}

function getProjectPreferences(preferences: StoredUserPreferences, projectId: string): UserProjectPreferences {
	const projectPreferences = preferences.projectPreferences?.[projectId];
	return projectPreferences && typeof projectPreferences === 'object' ? projectPreferences : {};
}

function setProjectPreferences(
	preferences: StoredUserPreferences,
	projectId: string,
	projectPreferences: UserProjectPreferences,
): StoredUserPreferences {
	return {
		...preferences,
		projectPreferences: {
			...preferences.projectPreferences,
			[projectId]: projectPreferences,
		},
	};
}

function sanitizePeriodSettings(preferences: UserProjectPreferences): PeriodSettings & { changed: boolean } {
	const savedPeriods = sanitizeSavedPeriods(preferences);
	const parsedSelection = parsePeriodSelection(preferences.usagePeriod);
	const usagePeriod =
		preferences.usagePeriod === undefined
			? undefined
			: parsedSelection.success && isValidPeriodSelection(parsedSelection.data, savedPeriods)
				? parsedSelection.data
				: DEFAULT_USAGE_PERIOD_SELECTION;
	const sanitized = {
		...preferences,
		usagePeriod,
		savedUsagePeriods: preferences.savedUsagePeriods === undefined ? undefined : savedPeriods,
	};
	return {
		preferences: sanitized,
		savedPeriods,
		changed: JSON.stringify(sanitized) !== JSON.stringify(preferences),
	};
}

function sanitizeSavedPeriods(preferences: UserProjectPreferences): SavedUsagePeriod[] {
	if (!Array.isArray(preferences.savedUsagePeriods)) {
		return [];
	}
	return preferences.savedUsagePeriods
		.flatMap((savedPeriod) => {
			const parsed = savedUsagePeriodSchema.safeParse(savedPeriod);
			return parsed.success ? [parsed.data] : [];
		})
		.slice(0, MAX_SAVED_USAGE_PERIODS);
}

function isValidPeriodSelection(
	selection: NonNullable<UserProjectPreferences['usagePeriod']>,
	savedPeriods: SavedUsagePeriod[],
): boolean {
	return selection.mode !== 'saved' || savedPeriods.some(({ id }) => id === selection.savedPeriodId);
}

function parsePeriodSelection(value: unknown) {
	const parsed = usagePeriodSelectionSchema.safeParse(value);
	if (parsed.success) {
		return parsed;
	}
	const legacy = legacySavedPeriodSelectionSchema.safeParse(value);
	return legacy.success
		? usagePeriodSelectionSchema.safeParse({
				mode: 'saved',
				savedPeriodId: legacy.data.entryId,
			})
		: parsed;
}

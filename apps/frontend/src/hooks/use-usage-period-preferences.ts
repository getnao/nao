import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_USAGE_PERIOD_PREFERENCE, resolveUsagePeriod, resolveUsagePeriodGranularity } from '@nao/backend/usage';
import type { UsagePeriodEntry, UsagePeriodEntryInput, UsagePeriodPreference } from '@nao/backend/usage';
import type { UsageRouteSearch } from '@/components/settings/usage-route-search';
import {
	clearStoredUsagePeriodPreference,
	readStoredUsagePeriodPreference,
} from '@/components/settings/usage-route-search';
import { trpc } from '@/main';
import { getActiveProjectId } from '@/lib/active-project';

interface UseUsagePeriodPreferencesOptions {
	canViewUsage: boolean;
	usageSearch: UsageRouteSearch;
	onUpdateSearch: (next: Partial<UsageRouteSearch>) => void;
}

interface UsagePeriodSettings {
	preference: UsagePeriodPreference | null;
	entries: UsagePeriodEntry[];
}

export function useUsagePeriodPreferences({
	canViewUsage,
	usageSearch,
	onUpdateSearch,
}: UseUsagePeriodPreferencesOptions) {
	const queryClient = useQueryClient();
	const projectId = getActiveProjectId();
	const queryProjectId = projectId ?? '';
	const queriesEnabled = canViewUsage && projectId !== null;
	const legacyPeriodPreference = useMemo(() => readStoredUsagePeriodPreference(projectId), [projectId]);
	const [actionError, setActionError] = useState<ProjectActionError>();
	const [migrationStatuses, setMigrationStatuses] = useState<Record<string, MigrationStatus>>({});
	const selectionVersion = useRef(0);
	const migrationStatus = migrationStatuses[queryProjectId];

	const settingsOptions = trpc.usage.getPeriodSettings.queryOptions({ projectId: queryProjectId });
	const settingsQuery = useQuery({
		...settingsOptions,
		enabled: queriesEnabled,
	});

	const updatePreference = useMutation({
		...trpc.usage.updatePeriodPreference.mutationOptions({
			onMutate: async ({ projectId: mutationProjectId, preference: nextPreference }) => {
				const queryKey = getPeriodSettingsQueryKey(mutationProjectId);
				await queryClient.cancelQueries({ queryKey });
				const previousSettings = queryClient.getQueryData<UsagePeriodSettings>(queryKey);
				queryClient.setQueryData<UsagePeriodSettings>(queryKey, (current) =>
					current ? { ...current, preference: nextPreference } : current,
				);
				return { previousSettings };
			},
			onError: (_error, { projectId: mutationProjectId }, context) => {
				queryClient.setQueryData(getPeriodSettingsQueryKey(mutationProjectId), context?.previousSettings);
			},
			onSettled: (_data, _error, { projectId: mutationProjectId }) => {
				queryClient.invalidateQueries({ queryKey: getPeriodSettingsQueryKey(mutationProjectId) });
			},
		}),
		scope: { id: `usage-period-preference-${queryProjectId}` },
	});

	const createEntryMutation = useMutation(
		trpc.usage.createPeriodEntry.mutationOptions({
			onSuccess: (entry, { projectId: mutationProjectId }) => {
				queryClient.setQueryData<UsagePeriodSettings>(
					getPeriodSettingsQueryKey(mutationProjectId),
					(current) => ({
						preference: { mode: 'saved', entryId: entry.id },
						entries: [...(current?.entries ?? []), entry],
					}),
				);
			},
			onSettled: (_data, _error, { projectId: mutationProjectId }) => {
				queryClient.invalidateQueries({ queryKey: getPeriodSettingsQueryKey(mutationProjectId) });
			},
		}),
	);

	const updateEntryMutation = useMutation(
		trpc.usage.updatePeriodEntry.mutationOptions({
			onMutate: async ({ projectId: mutationProjectId, entry }) => {
				const queryKey = getPeriodSettingsQueryKey(mutationProjectId);
				await queryClient.cancelQueries({ queryKey });
				const previousSettings = queryClient.getQueryData<UsagePeriodSettings>(queryKey);
				queryClient.setQueryData<UsagePeriodSettings>(queryKey, (current) =>
					current
						? {
								...current,
								entries: current.entries.map((item) => (item.id === entry.id ? entry : item)),
							}
						: current,
				);
				return { previousSettings };
			},
			onError: (_error, { projectId: mutationProjectId }, context) => {
				queryClient.setQueryData(getPeriodSettingsQueryKey(mutationProjectId), context?.previousSettings);
			},
			onSettled: (_data, _error, { projectId: mutationProjectId }) => {
				queryClient.invalidateQueries({ queryKey: getPeriodSettingsQueryKey(mutationProjectId) });
			},
		}),
	);

	const deleteEntryMutation = useMutation(
		trpc.usage.deletePeriodEntry.mutationOptions({
			onMutate: async ({ projectId: mutationProjectId, id }) => {
				const queryKey = getPeriodSettingsQueryKey(mutationProjectId);
				await queryClient.cancelQueries({ queryKey });
				const previousSettings = queryClient.getQueryData<UsagePeriodSettings>(queryKey);
				queryClient.setQueryData<UsagePeriodSettings>(queryKey, (current) => {
					if (!current) {
						return current;
					}
					const preference =
						current.preference?.mode === 'saved' && current.preference.entryId === id
							? DEFAULT_USAGE_PERIOD_PREFERENCE
							: current.preference;
					return {
						preference,
						entries: current.entries.filter((entry) => entry.id !== id),
					};
				});
				return { previousSettings };
			},
			onError: (_error, { projectId: mutationProjectId }, context) => {
				queryClient.setQueryData(getPeriodSettingsQueryKey(mutationProjectId), context?.previousSettings);
			},
			onSettled: (_data, _error, { projectId: mutationProjectId }) => {
				queryClient.invalidateQueries({ queryKey: getPeriodSettingsQueryKey(mutationProjectId) });
			},
		}),
	);

	const entries = settingsQuery.data?.entries ?? [];
	const savedPreference = settingsQuery.data?.preference ?? legacyPeriodPreference ?? DEFAULT_USAGE_PERIOD_PREFERENCE;
	const preference = resolvePeriodPreference(
		savedPreference,
		settingsQuery.data?.entries,
		usageSearch.periodEntryId,
		usageSearch.periodMode,
	);

	const selectPreference = async (nextPreference: UsagePeriodPreference) => {
		const mutationProjectId = queryProjectId;
		const previousPreference = preference;
		const version = ++selectionVersion.current;
		const replacesLegacyPreference =
			migrationStatus === 'failed' &&
			settingsQuery.data?.preference === null &&
			legacyPeriodPreference !== undefined;
		setActionError(undefined);
		if (replacesLegacyPreference) {
			setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'pending' }));
		}
		onUpdateSearch(toPeriodSearch(nextPreference));
		try {
			await updatePreference.mutateAsync({ projectId: mutationProjectId, preference: nextPreference });
			if (replacesLegacyPreference) {
				clearStoredUsagePeriodPreference(mutationProjectId);
				setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'succeeded' }));
			}
		} catch (cause) {
			if (replacesLegacyPreference) {
				setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'failed' }));
			}
			if (version === selectionVersion.current && isActiveProject(mutationProjectId)) {
				onUpdateSearch(toPeriodSearch(previousPreference));
				setActionError({
					projectId: mutationProjectId,
					message: toErrorMessage(cause, 'Unable to save the selected period.'),
				});
			}
			throw cause;
		}
	};

	const createEntry = async (input: UsagePeriodEntryInput) => {
		const mutationProjectId = queryProjectId;
		setActionError(undefined);
		const entry = await createEntryMutation.mutateAsync({ projectId: mutationProjectId, entry: input });
		if (isActiveProject(mutationProjectId)) {
			onUpdateSearch(toPeriodSearch({ mode: 'saved', entryId: entry.id }));
		}
		if (
			migrationStatus === 'failed' &&
			settingsQuery.data?.preference === null &&
			legacyPeriodPreference !== undefined
		) {
			clearStoredUsagePeriodPreference(mutationProjectId);
			setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'succeeded' }));
		}
	};

	const updateEntry = async (entry: UsagePeriodEntry) => {
		setActionError(undefined);
		await updateEntryMutation.mutateAsync({ projectId: queryProjectId, entry });
	};

	const deleteEntry = async (id: string) => {
		const mutationProjectId = queryProjectId;
		setActionError(undefined);
		const isActive = preference.mode === 'saved' && preference.entryId === id;
		await deleteEntryMutation.mutateAsync({ projectId: mutationProjectId, id });
		if (isActive && isActiveProject(mutationProjectId)) {
			onUpdateSearch(toPeriodSearch(DEFAULT_USAGE_PERIOD_PREFERENCE));
		}
	};

	const retry = async () => {
		setActionError(undefined);
		if (loadError) {
			await settingsQuery.refetch();
			return;
		}
		if (migrationStatus !== 'failed' || !legacyPeriodPreference) {
			return;
		}

		const migrationProjectId = queryProjectId;
		setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'pending' }));
		try {
			const settings = await queryClient.fetchQuery(
				trpc.usage.getPeriodSettings.queryOptions({ projectId: migrationProjectId }),
			);
			if (settings.preference === null) {
				await updatePreference.mutateAsync({
					projectId: migrationProjectId,
					preference: legacyPeriodPreference,
				});
			}
			clearStoredUsagePeriodPreference(migrationProjectId);
			setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'succeeded' }));
		} catch (cause) {
			setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'failed' }));
			if (isActiveProject(migrationProjectId)) {
				setActionError({
					projectId: migrationProjectId,
					message: toErrorMessage(cause, 'Unable to migrate the saved period.'),
				});
			}
		}
	};

	useEffect(() => {
		if (!queriesEnabled || !settingsQuery.data || !legacyPeriodPreference) {
			return;
		}
		if (settingsQuery.data.preference !== null) {
			if (migrationStatus === undefined) {
				clearStoredUsagePeriodPreference(queryProjectId);
			}
			return;
		}
		if (migrationStatus !== undefined) {
			return;
		}

		const migrationProjectId = queryProjectId;
		setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'pending' }));
		void updatePreference
			.mutateAsync({ projectId: migrationProjectId, preference: legacyPeriodPreference })
			.then(() => {
				clearStoredUsagePeriodPreference(migrationProjectId);
				setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'succeeded' }));
			})
			.catch((cause) => {
				setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'failed' }));
				if (isActiveProject(migrationProjectId)) {
					setActionError({
						projectId: migrationProjectId,
						message: toErrorMessage(cause, 'Unable to migrate the saved period.'),
					});
				}
			});
	}, [legacyPeriodPreference, migrationStatus, queriesEnabled, queryProjectId, settingsQuery.data, updatePreference]);

	useEffect(() => {
		const entryId = usageSearch.periodEntryId;
		if (
			!settingsQuery.isSuccess ||
			deleteEntryMutation.isPending ||
			!entryId ||
			settingsQuery.data.entries.some((entry) => entry.id === entryId) ||
			!isActiveProject(queryProjectId)
		) {
			return;
		}
		onUpdateSearch({ periodEntryId: undefined });
	}, [
		deleteEntryMutation.isPending,
		onUpdateSearch,
		queryProjectId,
		settingsQuery.data,
		settingsQuery.isSuccess,
		usageSearch.periodEntryId,
	]);

	const loadError = settingsQuery.error;
	const currentActionError = actionError?.projectId === queryProjectId ? actionError.message : undefined;
	const migrationError = migrationStatus === 'failed' ? 'Unable to migrate the saved period.' : undefined;
	const error =
		currentActionError ??
		migrationError ??
		(loadError ? toErrorMessage(loadError, 'Unable to load saved periods.') : undefined);
	const isMigrationBlocking =
		migrationStatus === 'pending' ||
		(settingsQuery.data?.preference === null &&
			legacyPeriodPreference !== undefined &&
			migrationStatus === undefined);
	const isReady = settingsQuery.isSuccess && !isMigrationBlocking;

	return {
		entries,
		preference,
		period: resolveUsagePeriod(preference, entries),
		granularity: resolveUsagePeriodGranularity(preference, entries),
		isLoading: canViewUsage && (projectId === null || (!isReady && !loadError)),
		isReady,
		error,
		retry: loadError || migrationStatus === 'failed' ? () => void retry() : undefined,
		selectPreference,
		createEntry,
		updateEntry,
		deleteEntry,
	};
}

function resolvePeriodPreference(
	savedPreference: UsagePeriodPreference,
	entries: UsagePeriodEntry[] | undefined,
	entryId: string | undefined,
	mode: UsageRouteSearch['periodMode'],
): UsagePeriodPreference {
	if (entryId && (!entries || entries.some((entry) => entry.id === entryId))) {
		return { mode: 'saved', entryId };
	}
	if (mode) {
		return { mode };
	}
	if (savedPreference.mode === 'saved' && entries && !entries.some((entry) => entry.id === savedPreference.entryId)) {
		return DEFAULT_USAGE_PERIOD_PREFERENCE;
	}
	return savedPreference;
}

function toPeriodSearch(preference: UsagePeriodPreference): Partial<UsageRouteSearch> {
	return {
		periodMode: preference.mode === 'saved' ? undefined : preference.mode,
		periodEntryId: preference.mode === 'saved' ? preference.entryId : undefined,
	};
}

function toErrorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

function isActiveProject(projectId: string): boolean {
	return getActiveProjectId() === projectId;
}

function getPeriodSettingsQueryKey(projectId: string) {
	return trpc.usage.getPeriodSettings.queryOptions({ projectId }).queryKey;
}

type MigrationStatus = 'pending' | 'failed' | 'succeeded';
type ProjectActionError = { projectId: string; message: string };

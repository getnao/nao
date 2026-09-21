import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_USAGE_PERIOD_SELECTION, resolveUsagePeriod, resolveUsagePeriodGranularity } from '@nao/backend/usage';
import type { SavedUsagePeriod, SavedUsagePeriodInput, UsagePeriodSelection } from '@nao/backend/usage';
import type { UsageRouteSearch } from '@/components/settings/usage-route-search';
import {
	clearStoredUsagePeriodSelection,
	readStoredUsagePeriodSelection,
} from '@/components/settings/usage-route-search';
import { trpc } from '@/main';
import { getActiveProjectId } from '@/lib/active-project';

interface UseUsagePeriodSettingsOptions {
	canViewUsage: boolean;
	usageSearch: UsageRouteSearch;
	onUpdateSearch: (next: Partial<UsageRouteSearch>) => void;
}

interface UsagePeriodSettings {
	selection: UsagePeriodSelection | null;
	savedPeriods: SavedUsagePeriod[];
}

export function useUsagePeriodSettings({ canViewUsage, usageSearch, onUpdateSearch }: UseUsagePeriodSettingsOptions) {
	const queryClient = useQueryClient();
	const projectId = getActiveProjectId();
	const queryProjectId = projectId ?? '';
	const queriesEnabled = canViewUsage && projectId !== null;
	const legacyPeriodSelection = useMemo(() => readStoredUsagePeriodSelection(projectId), [projectId]);
	const [actionError, setActionError] = useState<ProjectActionError>();
	const [migrationStatuses, setMigrationStatuses] = useState<Record<string, MigrationStatus>>({});
	const selectionVersion = useRef(0);
	const migrationStatus = migrationStatuses[queryProjectId];

	const settingsOptions = trpc.usage.getPeriodSettings.queryOptions({ projectId: queryProjectId });
	const settingsQuery = useQuery({
		...settingsOptions,
		enabled: queriesEnabled,
	});

	const updateSelection = useMutation({
		...trpc.usage.updatePeriodSelection.mutationOptions({
			onMutate: async ({ projectId: mutationProjectId, selection: nextSelection }) => {
				const queryKey = getPeriodSettingsQueryKey(mutationProjectId);
				await queryClient.cancelQueries({ queryKey });
				const previousSettings = queryClient.getQueryData<UsagePeriodSettings>(queryKey);
				queryClient.setQueryData<UsagePeriodSettings>(queryKey, (current) =>
					current ? { ...current, selection: nextSelection } : current,
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
		scope: { id: `usage-period-selection-${queryProjectId}` },
	});

	const createSavedPeriodMutation = useMutation(
		trpc.usage.createSavedPeriod.mutationOptions({
			onSuccess: (savedPeriod, { projectId: mutationProjectId }) => {
				queryClient.setQueryData<UsagePeriodSettings>(
					getPeriodSettingsQueryKey(mutationProjectId),
					(current) => ({
						selection: { mode: 'saved', savedPeriodId: savedPeriod.id },
						savedPeriods: [...(current?.savedPeriods ?? []), savedPeriod],
					}),
				);
			},
			onSettled: (_data, _error, { projectId: mutationProjectId }) => {
				queryClient.invalidateQueries({ queryKey: getPeriodSettingsQueryKey(mutationProjectId) });
			},
		}),
	);

	const updateSavedPeriodMutation = useMutation(
		trpc.usage.updateSavedPeriod.mutationOptions({
			onMutate: async ({ projectId: mutationProjectId, savedPeriod }) => {
				const queryKey = getPeriodSettingsQueryKey(mutationProjectId);
				await queryClient.cancelQueries({ queryKey });
				const previousSettings = queryClient.getQueryData<UsagePeriodSettings>(queryKey);
				queryClient.setQueryData<UsagePeriodSettings>(queryKey, (current) =>
					current
						? {
								...current,
								savedPeriods: current.savedPeriods.map((item) =>
									item.id === savedPeriod.id ? savedPeriod : item,
								),
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

	const deleteSavedPeriodMutation = useMutation(
		trpc.usage.deleteSavedPeriod.mutationOptions({
			onMutate: async ({ projectId: mutationProjectId, id }) => {
				const queryKey = getPeriodSettingsQueryKey(mutationProjectId);
				await queryClient.cancelQueries({ queryKey });
				const previousSettings = queryClient.getQueryData<UsagePeriodSettings>(queryKey);
				queryClient.setQueryData<UsagePeriodSettings>(queryKey, (current) => {
					if (!current) {
						return current;
					}
					const selection =
						current.selection?.mode === 'saved' && current.selection.savedPeriodId === id
							? DEFAULT_USAGE_PERIOD_SELECTION
							: current.selection;
					return {
						selection,
						savedPeriods: current.savedPeriods.filter((savedPeriod) => savedPeriod.id !== id),
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

	const savedPeriods = settingsQuery.data?.savedPeriods ?? [];
	const savedSelection = settingsQuery.data?.selection ?? legacyPeriodSelection ?? DEFAULT_USAGE_PERIOD_SELECTION;
	const selection = resolvePeriodSelection(
		savedSelection,
		settingsQuery.data?.savedPeriods,
		usageSearch.savedPeriodId,
		usageSearch.periodMode,
	);

	const selectPeriod = async (nextSelection: UsagePeriodSelection) => {
		const mutationProjectId = queryProjectId;
		const previousSelection = selection;
		const version = ++selectionVersion.current;
		const replacesLegacySelection =
			migrationStatus === 'failed' &&
			settingsQuery.data?.selection === null &&
			legacyPeriodSelection !== undefined;
		setActionError(undefined);
		if (replacesLegacySelection) {
			setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'pending' }));
		}
		onUpdateSearch(toPeriodSearch(nextSelection));
		try {
			await updateSelection.mutateAsync({ projectId: mutationProjectId, selection: nextSelection });
			if (replacesLegacySelection) {
				clearStoredUsagePeriodSelection(mutationProjectId);
				setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'succeeded' }));
			}
		} catch (cause) {
			if (replacesLegacySelection) {
				setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'failed' }));
			}
			if (version === selectionVersion.current && isActiveProject(mutationProjectId)) {
				onUpdateSearch(toPeriodSearch(previousSelection));
				setActionError({
					projectId: mutationProjectId,
					message: toErrorMessage(cause, 'Unable to save the selected period.'),
				});
			}
			throw cause;
		}
	};

	const createSavedPeriod = async (input: SavedUsagePeriodInput) => {
		const mutationProjectId = queryProjectId;
		setActionError(undefined);
		const savedPeriod = await createSavedPeriodMutation.mutateAsync({
			projectId: mutationProjectId,
			savedPeriod: input,
		});
		if (isActiveProject(mutationProjectId)) {
			onUpdateSearch(toPeriodSearch({ mode: 'saved', savedPeriodId: savedPeriod.id }));
		}
		if (
			migrationStatus === 'failed' &&
			settingsQuery.data?.selection === null &&
			legacyPeriodSelection !== undefined
		) {
			clearStoredUsagePeriodSelection(mutationProjectId);
			setMigrationStatuses((current) => ({ ...current, [mutationProjectId]: 'succeeded' }));
		}
	};

	const updateSavedPeriod = async (savedPeriod: SavedUsagePeriod) => {
		setActionError(undefined);
		await updateSavedPeriodMutation.mutateAsync({ projectId: queryProjectId, savedPeriod });
	};

	const deleteSavedPeriod = async (id: string) => {
		const mutationProjectId = queryProjectId;
		setActionError(undefined);
		const isActive = selection.mode === 'saved' && selection.savedPeriodId === id;
		await deleteSavedPeriodMutation.mutateAsync({ projectId: mutationProjectId, id });
		if (isActive && isActiveProject(mutationProjectId)) {
			onUpdateSearch(toPeriodSearch(DEFAULT_USAGE_PERIOD_SELECTION));
		}
	};

	const retry = async () => {
		setActionError(undefined);
		if (loadError) {
			await settingsQuery.refetch();
			return;
		}
		if (migrationStatus !== 'failed' || !legacyPeriodSelection) {
			return;
		}

		const migrationProjectId = queryProjectId;
		setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'pending' }));
		try {
			const settings = await queryClient.fetchQuery(
				trpc.usage.getPeriodSettings.queryOptions({ projectId: migrationProjectId }),
			);
			if (settings.selection === null) {
				await updateSelection.mutateAsync({
					projectId: migrationProjectId,
					selection: legacyPeriodSelection,
				});
			}
			clearStoredUsagePeriodSelection(migrationProjectId);
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
		if (!queriesEnabled || !settingsQuery.data || !legacyPeriodSelection) {
			return;
		}
		if (settingsQuery.data.selection !== null) {
			if (migrationStatus === undefined) {
				clearStoredUsagePeriodSelection(queryProjectId);
			}
			return;
		}
		if (migrationStatus !== undefined) {
			return;
		}

		const migrationProjectId = queryProjectId;
		setMigrationStatuses((current) => ({ ...current, [migrationProjectId]: 'pending' }));
		void updateSelection
			.mutateAsync({ projectId: migrationProjectId, selection: legacyPeriodSelection })
			.then(() => {
				clearStoredUsagePeriodSelection(migrationProjectId);
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
	}, [legacyPeriodSelection, migrationStatus, queriesEnabled, queryProjectId, settingsQuery.data, updateSelection]);

	useEffect(() => {
		const savedPeriodId = usageSearch.savedPeriodId;
		if (
			!settingsQuery.isSuccess ||
			deleteSavedPeriodMutation.isPending ||
			!savedPeriodId ||
			settingsQuery.data.savedPeriods.some((savedPeriod) => savedPeriod.id === savedPeriodId) ||
			!isActiveProject(queryProjectId)
		) {
			return;
		}
		onUpdateSearch({ savedPeriodId: undefined });
	}, [
		deleteSavedPeriodMutation.isPending,
		onUpdateSearch,
		queryProjectId,
		settingsQuery.data,
		settingsQuery.isSuccess,
		usageSearch.savedPeriodId,
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
		(settingsQuery.data?.selection === null &&
			legacyPeriodSelection !== undefined &&
			migrationStatus === undefined);
	const isReady = settingsQuery.isSuccess && !isMigrationBlocking;

	return {
		savedPeriods,
		selection,
		period: resolveUsagePeriod(selection, savedPeriods),
		granularity: resolveUsagePeriodGranularity(selection, savedPeriods),
		isLoading: canViewUsage && (projectId === null || (!isReady && !loadError)),
		isReady,
		error,
		retry: loadError || migrationStatus === 'failed' ? () => void retry() : undefined,
		selectPeriod,
		createSavedPeriod,
		updateSavedPeriod,
		deleteSavedPeriod,
	};
}

function resolvePeriodSelection(
	savedSelection: UsagePeriodSelection,
	savedPeriods: SavedUsagePeriod[] | undefined,
	savedPeriodId: string | undefined,
	mode: UsageRouteSearch['periodMode'],
): UsagePeriodSelection {
	if (savedPeriodId && (!savedPeriods || savedPeriods.some(({ id }) => id === savedPeriodId))) {
		return { mode: 'saved', savedPeriodId };
	}
	if (mode) {
		return { mode };
	}
	if (
		savedSelection.mode === 'saved' &&
		savedPeriods &&
		!savedPeriods.some(({ id }) => id === savedSelection.savedPeriodId)
	) {
		return DEFAULT_USAGE_PERIOD_SELECTION;
	}
	return savedSelection;
}

function toPeriodSearch(selection: UsagePeriodSelection): Partial<UsageRouteSearch> {
	return {
		periodMode: selection.mode === 'saved' ? undefined : selection.mode,
		savedPeriodId: selection.mode === 'saved' ? selection.savedPeriodId : undefined,
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

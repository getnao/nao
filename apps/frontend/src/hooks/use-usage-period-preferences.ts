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

	const preferenceOptions = trpc.usage.getPeriodPreference.queryOptions({ projectId: queryProjectId });
	const entriesOptions = trpc.usage.getPeriodEntries.queryOptions({ projectId: queryProjectId });
	const preferenceQueryKey = preferenceOptions.queryKey;
	const entriesQueryKey = entriesOptions.queryKey;
	const preferenceQuery = useQuery({
		...preferenceOptions,
		enabled: queriesEnabled,
	});
	const entriesQuery = useQuery({
		...entriesOptions,
		enabled: queriesEnabled,
	});

	const updatePreference = useMutation({
		...trpc.usage.updatePeriodPreference.mutationOptions({
			onMutate: async ({ preference: nextPreference }) => {
				await queryClient.cancelQueries({ queryKey: preferenceQueryKey });
				const previousPreference = queryClient.getQueryData<UsagePeriodPreference | null>(preferenceQueryKey);
				queryClient.setQueryData(preferenceQueryKey, nextPreference);
				return { previousPreference };
			},
			onError: (_error, _input, context) => {
				queryClient.setQueryData(preferenceQueryKey, context?.previousPreference);
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: preferenceQueryKey });
			},
		}),
		scope: { id: `usage-period-preference-${queryProjectId}` },
	});

	const createEntryMutation = useMutation(
		trpc.usage.createPeriodEntry.mutationOptions({
			onSuccess: (entry) => {
				queryClient.setQueryData<UsagePeriodEntry[]>(entriesQueryKey, (current = []) => [...current, entry]);
				queryClient.setQueryData(preferenceQueryKey, { mode: 'saved', entryId: entry.id });
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: entriesQueryKey });
				queryClient.invalidateQueries({ queryKey: preferenceQueryKey });
			},
		}),
	);

	const updateEntryMutation = useMutation(
		trpc.usage.updatePeriodEntry.mutationOptions({
			onMutate: async ({ entry }) => {
				await queryClient.cancelQueries({ queryKey: entriesQueryKey });
				const previousEntries = queryClient.getQueryData<UsagePeriodEntry[]>(entriesQueryKey);
				queryClient.setQueryData<UsagePeriodEntry[]>(entriesQueryKey, (current = []) =>
					current.map((item) => (item.id === entry.id ? entry : item)),
				);
				return { previousEntries };
			},
			onError: (_error, _input, context) => {
				queryClient.setQueryData(entriesQueryKey, context?.previousEntries);
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: entriesQueryKey });
			},
		}),
	);

	const deleteEntryMutation = useMutation(
		trpc.usage.deletePeriodEntry.mutationOptions({
			onMutate: async ({ id }) => {
				await Promise.all([
					queryClient.cancelQueries({ queryKey: entriesQueryKey }),
					queryClient.cancelQueries({ queryKey: preferenceQueryKey }),
				]);
				const previousEntries = queryClient.getQueryData<UsagePeriodEntry[]>(entriesQueryKey);
				const previousPreference = queryClient.getQueryData<UsagePeriodPreference | null>(preferenceQueryKey);
				queryClient.setQueryData<UsagePeriodEntry[]>(entriesQueryKey, (current = []) =>
					current.filter((entry) => entry.id !== id),
				);
				if (previousPreference?.mode === 'saved' && previousPreference.entryId === id) {
					queryClient.setQueryData(preferenceQueryKey, DEFAULT_USAGE_PERIOD_PREFERENCE);
				}
				return { previousEntries, previousPreference };
			},
			onError: (_error, _input, context) => {
				queryClient.setQueryData(entriesQueryKey, context?.previousEntries);
				queryClient.setQueryData(preferenceQueryKey, context?.previousPreference);
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: entriesQueryKey });
				queryClient.invalidateQueries({ queryKey: preferenceQueryKey });
			},
		}),
	);

	const entries = entriesQuery.data ?? [];
	const savedPreference = preferenceQuery.data ?? DEFAULT_USAGE_PERIOD_PREFERENCE;
	const preference = resolvePeriodPreference(
		savedPreference,
		entriesQuery.data,
		usageSearch.periodEntryId,
		usageSearch.periodMode,
	);

	const selectPreference = async (nextPreference: UsagePeriodPreference) => {
		const mutationProjectId = queryProjectId;
		const previousPreference = preference;
		const version = ++selectionVersion.current;
		setActionError(undefined);
		onUpdateSearch(toPeriodSearch(nextPreference));
		try {
			await updatePreference.mutateAsync({ projectId: mutationProjectId, preference: nextPreference });
		} catch (cause) {
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

	const retry = () => {
		setActionError(undefined);
		if (migrationStatus === 'failed') {
			setMigrationStatuses((current) => omitProjectStatus(current, queryProjectId));
		}
		if (loadError) {
			void Promise.all([preferenceQuery.refetch(), entriesQuery.refetch()]);
		}
	};

	useEffect(() => {
		if (
			!queriesEnabled ||
			preferenceQuery.data !== null ||
			!legacyPeriodPreference ||
			migrationStatus !== undefined
		) {
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
	}, [
		legacyPeriodPreference,
		migrationStatus,
		preferenceQuery.data,
		queriesEnabled,
		queryProjectId,
		updatePreference,
	]);

	useEffect(() => {
		const entryId = usageSearch.periodEntryId;
		if (
			!entriesQuery.isSuccess ||
			deleteEntryMutation.isPending ||
			!entryId ||
			entriesQuery.data.some((entry) => entry.id === entryId) ||
			!isActiveProject(queryProjectId)
		) {
			return;
		}
		onUpdateSearch({ periodEntryId: undefined });
	}, [
		deleteEntryMutation.isPending,
		entriesQuery.data,
		entriesQuery.isSuccess,
		onUpdateSearch,
		queryProjectId,
		usageSearch.periodEntryId,
	]);

	const loadError = preferenceQuery.error ?? entriesQuery.error;
	const currentActionError = actionError?.projectId === queryProjectId ? actionError.message : undefined;
	const migrationError = migrationStatus === 'failed' ? 'Unable to migrate the saved period.' : undefined;
	const error =
		currentActionError ??
		migrationError ??
		(loadError ? toErrorMessage(loadError, 'Unable to load saved periods.') : undefined);
	const isMigrationBlocking =
		migrationStatus === 'pending' ||
		(preferenceQuery.data === null && legacyPeriodPreference !== undefined && migrationStatus === undefined);
	const isReady = preferenceQuery.isSuccess && entriesQuery.isSuccess && !isMigrationBlocking;

	return {
		entries,
		preference,
		period: resolveUsagePeriod(preference, entries),
		granularity: resolveUsagePeriodGranularity(preference, entries),
		isLoading: canViewUsage && (projectId === null || (!isReady && !loadError)),
		isReady,
		error,
		retry: loadError || migrationStatus === 'failed' ? retry : undefined,
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

function omitProjectStatus(
	statuses: Record<string, MigrationStatus>,
	projectId: string,
): Record<string, MigrationStatus> {
	const nextStatuses = { ...statuses };
	delete nextStatuses[projectId];
	return nextStatuses;
}

type MigrationStatus = 'pending' | 'failed' | 'succeeded';
type ProjectActionError = { projectId: string; message: string };

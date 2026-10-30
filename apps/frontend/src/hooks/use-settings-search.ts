import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import { useMemo } from 'react';

import type { SettingsSearchEntry } from '@/components/settings-search-index';
import { settingsSearchIndex } from '@/components/settings-search-index';
import { useCanSeeAdvancedSettings } from '@/hooks/use-can-see-advanced-settings';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

export function useSettingsSearch(query: string): SettingsSearchEntry[] {
	const visibleEntries = useVisibleSettingsEntries();

	const fuse = useMemo(
		() =>
			new Fuse(visibleEntries, {
				keys: [
					{ name: 'title', weight: 0.4 },
					{ name: 'pageLabel', weight: 0.25 },
					{ name: 'description', weight: 0.2 },
					{ name: 'keywords', weight: 0.15 },
				],
				threshold: 0.4,
				includeScore: true,
			}),
		[visibleEntries],
	);

	return useMemo(() => {
		if (query.length < 2) {
			return [];
		}

		const matches = fuse.search(query, { limit: 8 }).map((result) => result.item);
		return dedupeByDestination(matches);
	}, [fuse, query]);
}

export function useSettingsSuggestions(): SettingsSearchEntry[] {
	const visibleEntries = useVisibleSettingsEntries();

	return useMemo(
		() =>
			settingsSuggestionPages.flatMap((page) => {
				const entry = visibleEntries.find((candidate) => candidate.page === page);
				return entry ? [entry] : [];
			}),
		[visibleEntries],
	);
}

function useVisibleSettingsEntries(): SettingsSearchEntry[] {
	const { canViewUsage, isAdmin, isContextAdmin, isOrgAdmin } = usePermissions();
	const canSeeAdvancedSettings = useCanSeeAdvancedSettings();
	const isCloud = useIsCloud();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const betaSubagentsEnabled = config.data?.betaSubagentsEnabled === true;
	const betaAutomationsEnabled = config.data?.betaAutomationsEnabled === true;
	const cloudBillingEnabled = config.data?.cloudBillingEnabled;
	const billingAccess = useCloudBillingAccess({ enabled: cloudBillingEnabled === true && isOrgAdmin });
	const cloudFreeTierEnabled = billingAccess.data?.freeTierEnabled === true;
	const licenseFeatures = useLicenseFeatures();
	const enabledLicenseFeatures = licenseFeatures.data as Record<string, boolean> | undefined;

	return useMemo(
		() =>
			settingsSearchIndex
				.filter(
					(entry) =>
						(!entry.adminOnly || isAdmin) &&
						(!entry.nonAdminOnly || !isAdmin) &&
						(!entry.licenseFeature || enabledLicenseFeatures?.[entry.licenseFeature] === true) &&
						(!entry.orgAdminOnly || isOrgAdmin) &&
						(!entry.adminOrContextAdmin || isAdmin || isContextAdmin) &&
						(!entry.requiresUsageAccess || canViewUsage) &&
						(!entry.cloudHidden || !isCloud) &&
						(!entry.cloudOnly || isCloud) &&
						(!entry.cloudBillingOnly || cloudBillingEnabled === true) &&
						(!entry.cloudFreeTierOnly || cloudFreeTierEnabled) &&
						(!entry.betaSubagentsOnly || betaSubagentsEnabled) &&
						(!entry.betaAutomationsOnly || betaAutomationsEnabled),
				)
				.filter((entry) => canSeeAdvancedSettings || viewerVisiblePages.includes(entry.page)),
		[
			betaAutomationsEnabled,
			betaSubagentsEnabled,
			canViewUsage,
			canSeeAdvancedSettings,
			cloudBillingEnabled,
			cloudFreeTierEnabled,
			enabledLicenseFeatures,
			isAdmin,
			isCloud,
			isContextAdmin,
			isOrgAdmin,
		],
	);
}

function dedupeByDestination(entries: SettingsSearchEntry[]): SettingsSearchEntry[] {
	const seenDestinations = new Set<string>();
	return entries.filter((entry) => {
		const destination = `${entry.page}:${JSON.stringify(entry.search ?? {})}`;
		if (seenDestinations.has(destination)) {
			return false;
		}

		seenDestinations.add(destination);
		return true;
	});
}

const settingsSuggestionPages = [
	'/settings/account',
	'/settings/organization',
	'/settings/project',
	'/settings/context-explorer',
	'/settings/project/agent',
	'/settings/usage',
];

const viewerVisiblePages = ['/settings/account', '/settings/usage'];

import { useMemo } from 'react';
import Fuse from 'fuse.js';

import type { SettingsSearchEntry } from '@/components/settings-search-index';

import { settingsSearchIndex } from '@/components/settings-search-index';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';

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
	const { isAdmin, isContextAdmin, isOrgAdmin, isViewer } = usePermissions();
	const isCloud = useIsCloud();

	return useMemo(
		() =>
			settingsSearchIndex
				.filter(
					(entry) =>
						(!entry.adminOnly || isAdmin) &&
						(!entry.orgAdminOnly || isOrgAdmin) &&
						(!entry.adminOrContextAdmin || isAdmin || isContextAdmin) &&
						(!entry.cloudHidden || !isCloud) &&
						(!entry.cloudOnly || isCloud),
				)
				.filter((entry) => !isViewer || viewerVisiblePages.includes(entry.page)),
		[isAdmin, isCloud, isContextAdmin, isOrgAdmin, isViewer],
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

const viewerVisiblePages = ['/settings/account'];

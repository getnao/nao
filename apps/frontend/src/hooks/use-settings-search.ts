import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';

import type { SettingsSearchEntry } from '@/components/settings-search-index';

import { settingsSearchIndex } from '@/components/settings-search-index';
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
		return dedupeByPage(matches);
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
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const license = useQuery(trpc.license.getStatus.queryOptions());
	const { isAdmin, isContextAdmin, isViewer } = usePermissions();
	const isCloud = config.data?.naoMode === 'cloud';
	const hasLicense = license.data?.tokenProvided === true;

	return useMemo(
		() =>
			settingsSearchIndex
				.filter(
					(entry) =>
						(!entry.adminOnly || isAdmin) &&
						(!entry.adminOrContextAdmin || isAdmin || isContextAdmin) &&
						(!entry.cloudHidden || !isCloud) &&
						(!entry.cloudOnly || isCloud) &&
						(!entry.licenseRequired || hasLicense),
				)
				.filter((entry) => !isViewer || viewerVisiblePages.includes(entry.page)),
		[hasLicense, isAdmin, isCloud, isContextAdmin, isViewer],
	);
}

function dedupeByPage(entries: SettingsSearchEntry[]): SettingsSearchEntry[] {
	const seenPages = new Set<string>();
	return entries.filter((entry) => {
		if (seenPages.has(entry.page)) {
			return false;
		}

		seenPages.add(entry.page);
		return true;
	});
}

const settingsSuggestionPages = [
	'/settings/account',
	'/settings/organization',
	'/settings/project',
	'/settings/project/models',
	'/settings/project/agent',
	'/settings/usage',
];

const viewerVisiblePages = ['/settings/account'];

import {
	isDatabaseContextTableGranted,
	isDocsContextFileGranted,
	isFilesContextFileGranted,
	USER_GROUP_FEATURE_DEFINITIONS,
} from '@nao/shared';
import type { DatabaseContextAccess, DocsContextAccess, FilesContextAccess, UserGroupFeature } from '@nao/shared';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { DocsContextCatalogEntry } from '@/components/settings/user-group-docs-context-access';
import type { FilesContextCatalogEntry } from '@/components/settings/user-group-files-context-access';
import type { UserGroupEditorGroup } from '@/components/settings/user-group-editor';
import { getDatabaseContextTableSelectionSummary } from '@/components/settings/user-group-context-access';
import { getDocsContextSelectionSummary } from '@/components/settings/user-group-docs-context-access';
import { getFilesContextSelectionSummary } from '@/components/settings/user-group-files-context-access';

export type UserGroupCatalogState = 'loading' | 'error' | 'ready';

export function getUserGroupAccessSummary(
	group: UserGroupEditorGroup,
	contextObjects: DatabaseContextObject[],
	docsEntries: DocsContextCatalogEntry[],
	filesEntries: FilesContextCatalogEntry[],
	catalogStates: {
		database: UserGroupCatalogState;
		docs: UserGroupCatalogState;
		files: UserGroupCatalogState;
	} = { database: 'ready', docs: 'ready', files: 'ready' },
): string {
	const featureCount = group.featureGrants.length;
	const featureSummary =
		featureCount === 0 ? 'No features' : `${featureCount} ${featureCount === 1 ? 'feature' : 'features'}`;
	const tableSummary =
		catalogStates.database === 'loading'
			? 'Loading tables...'
			: catalogStates.database === 'error'
				? 'Tables unavailable'
				: group.databaseAccess.mode === 'all'
					? 'All tables'
					: getDatabaseContextTableSelectionSummary(group.databaseAccess, contextObjects);
	const docsSummary =
		catalogStates.docs === 'loading'
			? 'Loading docs...'
			: catalogStates.docs === 'error'
				? 'Docs unavailable'
				: group.docsAccess.mode === 'all'
					? 'All docs'
					: getDocsContextSelectionSummary(group.docsAccess, docsEntries);
	const filesSummary =
		catalogStates.files === 'loading'
			? 'Loading files...'
			: catalogStates.files === 'error'
				? 'Files unavailable'
				: group.filesAccess.mode === 'all'
					? 'All files'
					: getFilesContextSelectionSummary(group.filesAccess, filesEntries);

	return `${featureSummary} · ${tableSummary === '0 tables' ? 'No tables' : tableSummary} · ${
		group.databaseAccess.strict ? 'Strict' : 'Not strict'
	} · ${docsSummary.startsWith('0 docs') ? 'No docs' : docsSummary} · ${
		filesSummary.startsWith('0 files') ? 'No files' : filesSummary
	}`;
}

export function getEffectiveUserGroupAccessSummary(
	access: {
		features: Record<UserGroupFeature, boolean>;
		databaseAccess: DatabaseContextAccess;
		docsAccess: DocsContextAccess;
		filesAccess: FilesContextAccess;
	},
	contextObjects: DatabaseContextObject[],
	docsEntries: DocsContextCatalogEntry[],
	filesEntries: FilesContextCatalogEntry[],
): string {
	const featureCount = USER_GROUP_FEATURE_DEFINITIONS.filter((feature) => access.features[feature.key]).length;
	const tableCount = new Set(
		contextObjects
			.filter((object) => isDatabaseContextTableGranted(access.databaseAccess, object))
			.map((object) => [object.databaseType, object.database, object.schema, object.table].join('\0')),
	).size;
	const docsCount = new Set(
		docsEntries
			.filter((entry) => entry.kind === 'file' && isDocsContextFileGranted(access.docsAccess, entry.path))
			.map((entry) => entry.path),
	).size;
	const filesCount = new Set(
		filesEntries
			.filter((entry) => entry.kind === 'file' && isFilesContextFileGranted(access.filesAccess, entry.path))
			.map((entry) => entry.path),
	).size;

	return [
		formatCount(featureCount, 'feature'),
		formatCount(tableCount, 'table'),
		formatCount(docsCount, 'doc'),
		formatCount(filesCount, 'file'),
		access.databaseAccess.strict ? 'Strict' : 'Not strict',
	].join(' · ');
}

function formatCount(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

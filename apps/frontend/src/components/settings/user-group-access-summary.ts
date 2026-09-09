import { isDatabaseContextTableGranted, isDocsContextFileGranted, USER_GROUP_FEATURE_DEFINITIONS } from '@nao/shared';
import type { DatabaseContextAccess, DocsContextAccess, UserGroupFeature } from '@nao/shared';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { DocsContextCatalogEntry } from '@/components/settings/user-group-docs-context-access';
import type { UserGroupEditorGroup } from '@/components/settings/user-group-editor';
import { getDatabaseContextTableSelectionSummary } from '@/components/settings/user-group-context-access';
import { getDocsContextSelectionSummary } from '@/components/settings/user-group-docs-context-access';

export function getUserGroupAccessSummary(
	group: UserGroupEditorGroup,
	contextObjects: DatabaseContextObject[],
	docsEntries: DocsContextCatalogEntry[],
): string {
	const featureCount = group.featureGrants.length;
	const featureSummary =
		featureCount === 0 ? 'No features' : `${featureCount} ${featureCount === 1 ? 'feature' : 'features'}`;
	const tableSummary =
		group.databaseAccess.mode === 'all'
			? 'All tables'
			: getDatabaseContextTableSelectionSummary(group.databaseAccess, contextObjects);
	const docsSummary =
		group.docsAccess.mode === 'all' ? 'All docs' : getDocsContextSelectionSummary(group.docsAccess, docsEntries);

	return `${featureSummary} · ${tableSummary === '0 tables' ? 'No tables' : tableSummary} · ${
		group.databaseAccess.strict ? 'Strict' : 'Not strict'
	} · ${docsSummary.startsWith('0 docs') ? 'No docs' : docsSummary}`;
}

export function getEffectiveUserGroupAccessSummary(
	access: {
		features: Record<UserGroupFeature, boolean>;
		databaseAccess: DatabaseContextAccess;
		docsAccess: DocsContextAccess;
	},
	contextObjects: DatabaseContextObject[],
	docsEntries: DocsContextCatalogEntry[],
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

	return [
		formatCount(featureCount, 'feature'),
		formatCount(tableCount, 'table'),
		formatCount(docsCount, 'doc'),
		access.databaseAccess.strict ? 'Strict' : 'Not strict',
	].join(' · ');
}

function formatCount(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

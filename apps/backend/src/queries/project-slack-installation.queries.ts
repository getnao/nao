import { and, eq } from 'drizzle-orm';

import s, { type DBProjectSlackInstallation, type NewProjectSlackInstallation } from '../db/abstractSchema';
import { db } from '../db/db';
import { takeFirstOrThrow } from '../utils/queries';

export async function getSlackInstallationByProjectId(projectId: string): Promise<DBProjectSlackInstallation | null> {
	const [installation] = await db
		.select()
		.from(s.projectSlackInstallation)
		.where(eq(s.projectSlackInstallation.projectId, projectId))
		.limit(1)
		.execute();
	return installation ?? null;
}

export async function getSlackInstallationByTeamId(teamId: string): Promise<DBProjectSlackInstallation | null> {
	const [installation] = await db
		.select()
		.from(s.projectSlackInstallation)
		.where(eq(s.projectSlackInstallation.teamId, teamId))
		.limit(1)
		.execute();
	return installation ?? null;
}

export async function upsertSlackInstallation(
	installation: NewProjectSlackInstallation,
): Promise<DBProjectSlackInstallation> {
	return takeFirstOrThrow(
		db
			.insert(s.projectSlackInstallation)
			.values(installation)
			.onConflictDoUpdate({
				target: s.projectSlackInstallation.projectId,
				set: {
					teamId: installation.teamId,
					teamName: installation.teamName,
					enterpriseId: installation.enterpriseId ?? null,
					botUserId: installation.botUserId,
					encryptedBotToken: installation.encryptedBotToken,
					scopes: installation.scopes,
					installedByUserId: installation.installedByUserId ?? null,
					updatedAt: new Date(),
				},
			})
			.returning()
			.execute(),
		'Failed to save Slack installation',
	);
}

export async function deleteSlackInstallationByProjectId(projectId: string): Promise<void> {
	await db.delete(s.projectSlackInstallation).where(eq(s.projectSlackInstallation.projectId, projectId)).execute();
}

export async function deleteSlackInstallationIfCurrent(
	projectId: string,
	teamId: string,
	updatedAt: Date,
): Promise<boolean> {
	const deleted = await db
		.delete(s.projectSlackInstallation)
		.where(
			and(
				eq(s.projectSlackInstallation.projectId, projectId),
				eq(s.projectSlackInstallation.teamId, teamId),
				eq(s.projectSlackInstallation.updatedAt, updatedAt),
			),
		)
		.returning({ projectId: s.projectSlackInstallation.projectId })
		.execute();

	return deleted.length > 0;
}

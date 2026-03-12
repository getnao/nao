import { hashPassword } from 'better-auth/crypto';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { env } from '../src/env';

const ADMIN_EMAIL = 'test@test.test';
const ADMIN_PASSWORD = 'test1234';
const ADMIN_NAME = 'Test';
const ORG_NAME = 'Test Organization';
const ORG_SLUG = 'test';
const PROJECT_NAME = 'Test Project';
const PROJECT_PATH = env.NAO_DEFAULT_PROJECT_PATH ?? './';

const useGithubAuth = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

/**
 * Seeds the database with the test admin user and their project.
 * When GitHub auth is configured, only the org and project are seeded — users sign in via GitHub.
 */
async function seed() {
	console.log('Seeding database...');

	const existingUser = useGithubAuth
		? null
		: await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, ADMIN_EMAIL) });
	const existingOrg = await db.query.organization.findFirst({ where: (o, { eq }) => eq(o.slug, ORG_SLUG) });
	const existingProject = await db.query.project.findFirst({ where: (p, { eq }) => eq(p.path, PROJECT_PATH) });

	if ((existingUser || useGithubAuth) && existingOrg && existingProject) {
		console.log('Seed data already present. Skipping.');
		return;
	}

	const userId = existingUser?.id ?? crypto.randomUUID();
	const accountId = crypto.randomUUID();
	const hashedPassword = await hashPassword(ADMIN_PASSWORD);

	await db.transaction(async (tx) => {
		if (!existingUser && !useGithubAuth) {
			await tx
				.insert(s.user)
				.values({ id: userId, name: ADMIN_NAME, email: ADMIN_EMAIL, emailVerified: true })
				.execute();

			await tx
				.insert(s.account)
				.values({
					id: accountId,
					accountId: userId,
					providerId: 'credential',
					userId,
					password: hashedPassword,
				})
				.execute();
		}

		const [org] = existingOrg
			? [existingOrg]
			: await tx.insert(s.organization).values({ name: ORG_NAME, slug: ORG_SLUG }).returning().execute();

		if (!useGithubAuth) {
			const existingOrgMember = await tx.query.orgMember.findFirst({
				where: (m, { and, eq }) => and(eq(m.orgId, org.id), eq(m.userId, userId)),
			});
			if (!existingOrgMember) {
				await tx.insert(s.orgMember).values({ orgId: org.id, userId, role: 'admin' }).execute();
			}
		}

		const [project] = existingProject
			? [existingProject]
			: await tx
					.insert(s.project)
					.values({ name: PROJECT_NAME, type: 'local', path: PROJECT_PATH, orgId: org.id })
					.returning()
					.execute();

		if (!useGithubAuth) {
			const existingProjectMember = await tx.query.projectMember.findFirst({
				where: (m, { and, eq }) => and(eq(m.projectId, project.id), eq(m.userId, userId)),
			});
			if (!existingProjectMember) {
				await tx.insert(s.projectMember).values({ projectId: project.id, userId, role: 'admin' }).execute();
			}
		}
	});

	console.log('Done.');
	if (!existingUser && !useGithubAuth) {
		console.log(`  Email:    ${ADMIN_EMAIL}`);
		console.log(`  Password: ${ADMIN_PASSWORD}`);
	}
	if (!existingProject) {
		console.log(`  Project:  ${PROJECT_NAME} (${PROJECT_PATH})`);
	}
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});

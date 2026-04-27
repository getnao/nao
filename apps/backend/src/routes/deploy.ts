import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import type { App } from '../app';
import { env } from '../env';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import { validateApiKey } from '../services/api-key.service';

export const deployRoutes = async (app: App) => {
	app.post('/deploy', async (request, reply) => {
		const authHeader = request.headers.authorization;
		if (!authHeader?.startsWith('Bearer ')) {
			return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
		}

		const org = await validateApiKey(authHeader.slice(7));
		if (!org) {
			return reply.status(401).send({ error: 'Invalid API key' });
		}

		const file = await request.file();
		if (!file) {
			return reply.status(400).send({ error: 'No file uploaded. Send a tar.gz as multipart field "context".' });
		}

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-deploy-'));
		const tarPath = path.join(tmpDir, 'context.tar.gz');

		try {
			const chunks: Buffer[] = [];
			for await (const chunk of file.file) {
				chunks.push(chunk);
			}
			fs.writeFileSync(tarPath, Buffer.concat(chunks));

			const extractDir = path.join(tmpDir, 'extracted');
			fs.mkdirSync(extractDir, { recursive: true });
			execFileSync('tar', ['xzf', tarPath, '-C', extractDir], { timeout: 30_000 });

			const configPath = path.join(extractDir, 'nao_config.yaml');
			if (!fs.existsSync(configPath)) {
				return reply.status(400).send({ error: 'nao_config.yaml not found in uploaded archive' });
			}

			const configContent = fs.readFileSync(configPath, 'utf-8');
			const config = yaml.load(configContent) as { project_name?: string };
			const projectName = config?.project_name;
			if (!projectName) {
				return reply.status(400).send({ error: 'project_name not found in nao_config.yaml' });
			}

			const existing = await projectQueries.getProjectByOrgAndName(org.id, projectName);
			let projectId: string;
			let status: 'created' | 'updated';

			if (existing) {
				projectId = existing.id;
				status = 'updated';

				if (existing.path && fs.existsSync(existing.path)) {
					fs.rmSync(existing.path, { recursive: true, force: true });
				}
				fs.mkdirSync(existing.path!, { recursive: true });
				copyDirectoryContents(extractDir, existing.path!);
				await projectQueries.touchProjectUpdatedAt(projectId);
			} else {
				const projectId_ = crypto.randomUUID();
				const projectDir = path.resolve(env.NAO_PROJECTS_DIR, projectId_);
				fs.mkdirSync(projectDir, { recursive: true });
				copyDirectoryContents(extractDir, projectDir);

				const project = await projectQueries.createProject({
					name: projectName,
					type: 'local',
					path: projectDir,
					orgId: org.id,
				});
				projectId = project.id;
				status = 'created';

				const orgMembers = await orgQueries.listOrgMembersWithUsers(org.id);
				for (const member of orgMembers) {
					await projectQueries.addProjectMember({
						projectId,
						userId: member.id,
						role: member.role,
					});
				}
			}

			return reply.send({ projectId, projectName, status });
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
};

function copyDirectoryContents(src: string, dest: string): void {
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(destPath, { recursive: true });
			copyDirectoryContents(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

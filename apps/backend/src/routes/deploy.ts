import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import type { App } from '../app';
import { env } from '../env';
import { ensureContextRecommendationsScheduleForNewProject } from '../handlers/context-recommendations.handler';
import * as projectQueries from '../queries/project.queries';
import { validateApiKey } from '../services/api-key.service';
import { createProject, recordProjectDeployment } from '../services/project.service';

export const deployRoutes = async (app: App) => {
	app.post('/deploy', async (request, reply) => {
		const authHeader = request.headers.authorization;
		if (!authHeader?.startsWith('Bearer ')) {
			return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
		}

		const apiKey = await validateApiKey(authHeader.slice(7));
		if (!apiKey) {
			return reply.status(401).send({ error: 'Invalid API key' });
		}
		request.actorUserId = apiKey.createdBy;
		const org = apiKey.organization;

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

			const rejection = findArchiveRejection(extractDir);
			if (rejection) {
				return reply.status(400).send({ error: rejection });
			}

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
				await recordProjectDeployment(projectId);
			} else {
				const projectId_ = crypto.randomUUID();
				const projectDir = path.resolve(env.NAO_PROJECTS_DIR, projectId_);
				fs.mkdirSync(projectDir, { recursive: true });
				copyDirectoryContents(extractDir, projectDir);

				const project = await createProject({
					name: projectName,
					type: 'local',
					path: projectDir,
					orgId: org.id,
					deployedAt: new Date(),
				});
				projectId = project.id;
				status = 'created';

				await ensureContextRecommendationsScheduleForNewProject(projectId);
			}

			return reply.send({ projectId, projectName, status });
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
};

/**
 * Why the archive cannot become a project folder, if it cannot. Git metadata is refused because the
 * server runs git in project folders, and a repository's own config and hooks can make git run commands.
 */
function findArchiveRejection(root: string, relativeDir = ''): string | null {
	const entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
	if (isGitDirectoryLayout(entries)) {
		return `Archive folder "${relativeDir || '.'}" is laid out as a Git repository. Git metadata is not allowed.`;
	}

	for (const entry of entries) {
		const relativePath = path.join(relativeDir, entry.name);
		if (isGitMetadataName(entry.name)) {
			return `Archive entry "${relativePath}" is Git metadata, which is not allowed. Deploy the project files without it.`;
		}
		if (entry.isDirectory()) {
			const nested = findArchiveRejection(root, relativePath);
			if (nested) {
				return nested;
			}
		} else if (!entry.isFile()) {
			return `Archive entry "${relativePath}" is not a regular file or directory. Symlinks and special files are not allowed.`;
		}
	}
	return null;
}

function isGitMetadataName(name: string): boolean {
	return name.toLowerCase() === '.git';
}

/** Git also treats a folder as a repository, whatever its name, when it holds what a `.git` folder holds. */
function isGitDirectoryLayout(entries: fs.Dirent[]): boolean {
	const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
	return names.has('head') && (names.has('commondir') || (names.has('objects') && names.has('refs')));
}

function copyDirectoryContents(src: string, dest: string): void {
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(destPath, { recursive: true });
			copyDirectoryContents(srcPath, destPath);
		} else if (entry.isFile()) {
			fs.copyFileSync(srcPath, destPath);
		} else {
			throw new Error(`Refusing to copy non-regular file: ${srcPath}`);
		}
	}
}

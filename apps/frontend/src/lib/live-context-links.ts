export type GitPlatform = 'github' | 'gitlab' | 'bitbucket';

export interface LiveContextRepository {
	repositoryUrl: string | null;
	platform: GitPlatform | null;
}

const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/i;

export function buildCommitUrl(repository: LiveContextRepository, commit: string | null): string | null {
	const baseUrl = getSafeRepositoryUrl(repository, commit);
	if (!baseUrl || !commit) {
		return null;
	}
	return appendRepositoryPath(baseUrl, getCommitPath(repository.platform, commit));
}

function getSafeRepositoryUrl(repository: LiveContextRepository, commit: string | null): URL | null {
	if (!repository.repositoryUrl || !repository.platform || !commit || !COMMIT_PATTERN.test(commit)) {
		return null;
	}
	try {
		const url = new URL(repository.repositoryUrl);
		if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname || url.username || url.password) {
			return null;
		}
		url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
		url.search = '';
		url.hash = '';
		return url.pathname !== '/' ? url : null;
	} catch {
		return null;
	}
}

function getCommitPath(platform: GitPlatform | null, commit: string): string {
	if (platform === 'gitlab') {
		return `-/commit/${commit}`;
	}
	if (platform === 'bitbucket') {
		return `commits/${commit}`;
	}
	return `commit/${commit}`;
}

function appendRepositoryPath(baseUrl: URL, suffix: string): string {
	const url = new URL(baseUrl);
	url.pathname = `${url.pathname}/${suffix}`;
	return url.toString();
}

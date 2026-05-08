import { env } from '../env';

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/getnao/nao/releases/latest';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface VersionCheckResult {
	currentVersion: string;
	latestVersion: string | null;
	updateAvailable: boolean;
}

let cachedResult: VersionCheckResult | null = null;
let cachedAt = 0;

export async function checkForUpdate(): Promise<VersionCheckResult> {
	const now = Date.now();
	if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
		return cachedResult;
	}

	const currentVersion = env.APP_VERSION;
	const latestVersion = await fetchLatestVersion();
	const updateAvailable = latestVersion !== null && isNewerVersion(currentVersion, latestVersion);

	cachedResult = { currentVersion, latestVersion, updateAvailable };
	cachedAt = now;
	return cachedResult;
}

async function fetchLatestVersion(): Promise<string | null> {
	try {
		const response = await fetch(GITHUB_RELEASES_URL, {
			headers: { Accept: 'application/vnd.github.v3+json' },
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) {
			return null;
		}
		const data = (await response.json()) as { tag_name?: string };
		return data.tag_name?.replace(/^v/, '') ?? null;
	} catch {
		return null;
	}
}

function isNewerVersion(current: string, latest: string): boolean {
	if (current === 'dev' || current === 'unknown') {
		return true;
	}

	const currentParts = parseVersion(current);
	const latestParts = parseVersion(latest);
	if (!currentParts || !latestParts) {
		return current !== latest;
	}

	for (let i = 0; i < 3; i++) {
		if (latestParts[i] > currentParts[i]) {
			return true;
		}
		if (latestParts[i] < currentParts[i]) {
			return false;
		}
	}
	if (currentParts[3] && !latestParts[3]) {
		return true;
	}
	return false;
}

function parseVersion(version: string): [number, number, number, string] | null {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)/);
	if (!match) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
}

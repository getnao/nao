import { readResponseWithLimit } from './request';

type RobotsRule = {
	path: string;
	allow: boolean;
};

type RobotsGroup = {
	agents: string[];
	rules: RobotsRule[];
};

export class RobotsTxtPolicy {
	private readonly cache = new Map<string, Promise<RobotsGroup[] | null>>();

	constructor(private readonly fetchRobotsTxt: (robotsUrl: string) => Promise<string | null>) {}

	async assertAllowed(url: string, userAgent = 'nao-web-robot'): Promise<void> {
		const parsed = new URL(url);
		const robotsUrl = `${parsed.origin}/robots.txt`;
		const groups = await this.load(robotsUrl);
		if (!groups || groups.length === 0) {
			return;
		}

		const group = bestGroup(groups, userAgent);
		if (!group) {
			return;
		}

		const decision = pathDecision(group.rules, parsed.pathname + parsed.search);
		if (decision === false) {
			throw new Error(`robots.txt disallows ${url} for ${userAgent}`);
		}
	}

	private load(robotsUrl: string): Promise<RobotsGroup[] | null> {
		let cached = this.cache.get(robotsUrl);
		if (!cached) {
			cached = this.fetchRobotsTxt(robotsUrl).then((content) => (content ? parseRobotsTxt(content) : null));
			this.cache.set(robotsUrl, cached);
		}
		return cached;
	}
}

export const fetchRobotsTxt = async (robotsUrl: string): Promise<string | null> => {
	const response = await fetch(robotsUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
	if (response.status >= 400) {
		return null;
	}
	return readResponseWithLimit(response, 256 * 1024);
};

export const parseRobotsTxt = (content: string): RobotsGroup[] => {
	const groups: RobotsGroup[] = [];
	let current: RobotsGroup | null = null;
	let seenRule = false;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, '').trim();
		const match = line.match(/^([^:]+):\s*(.*)$/);
		if (!match) {
			continue;
		}

		const field = match[1]!.trim().toLowerCase();
		const value = match[2]!.trim();
		if (field === 'user-agent') {
			if (!current || seenRule) {
				current = { agents: [], rules: [] };
				groups.push(current);
				seenRule = false;
			}
			current.agents.push(value.toLowerCase());
			continue;
		}

		if (!current || (field !== 'allow' && field !== 'disallow')) {
			continue;
		}
		seenRule = true;
		if (field === 'disallow' && value === '') {
			continue;
		}
		current.rules.push({ path: value, allow: field === 'allow' });
	}

	return groups;
};

const bestGroup = (groups: RobotsGroup[], userAgent: string): RobotsGroup | null => {
	const normalizedAgent = userAgent.toLowerCase();
	let best: { group: RobotsGroup; score: number } | null = null;

	for (const group of groups) {
		for (const agent of group.agents) {
			if (agent !== '*' && !normalizedAgent.includes(agent)) {
				continue;
			}
			const score = agent === '*' ? 0 : agent.length;
			if (!best || score > best.score) {
				best = { group, score };
			}
		}
	}

	return best?.group ?? null;
};

const pathDecision = (rules: RobotsRule[], path: string): boolean | null => {
	let best: { allow: boolean; length: number } | null = null;

	for (const rule of rules) {
		if (!matchesRulePath(rule.path, path)) {
			continue;
		}
		if (!best || rule.path.length >= best.length) {
			best = { allow: rule.allow, length: rule.path.length };
		}
	}

	return best?.allow ?? null;
};

const matchesRulePath = (rulePath: string, path: string): boolean => {
	if (rulePath === '/') {
		return true;
	}
	if (rulePath.endsWith('$')) {
		return wildcardMatch(path, rulePath.slice(0, -1));
	}
	return wildcardMatch(path, `${rulePath}*`);
};

const wildcardMatch = (value: string, pattern: string): boolean => {
	const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}`);
	return regex.test(value);
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

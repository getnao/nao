import dns from 'node:dns/promises';
import net from 'node:net';

export class WebRobotUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WebRobotUrlError';
	}
}

export const normalizeHttpUrl = (value: string, baseUrl?: string): URL => {
	let url: URL;
	try {
		url = baseUrl ? new URL(value, baseUrl) : new URL(value);
	} catch {
		throw new WebRobotUrlError(`Invalid URL: ${value}`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new WebRobotUrlError(`Only http and https URLs are allowed: ${value}`);
	}

	url.hash = '';
	url.hostname = url.hostname.toLowerCase();
	return url;
};

export const canonicalHttpUrl = (value: string, baseUrl?: string): string => {
	const url = normalizeHttpUrl(value, baseUrl);
	url.hash = '';
	return url.toString();
};

export const isAllowedHostname = (hostname: string, allowedHosts: string[]): boolean => {
	const normalized = hostname.toLowerCase();
	return allowedHosts.some((allowed) => {
		const host = allowed.toLowerCase();
		return host.startsWith('*.')
			? normalized === host.slice(2) || normalized.endsWith(`.${host.slice(2)}`)
			: normalized === host;
	});
};

export const assertPublicHttpUrl = async (
	value: string,
	allowedHosts: string[],
	options: { baseUrl?: string; resolveDns?: boolean } = {},
): Promise<URL> => {
	const url = normalizeHttpUrl(value, options.baseUrl);

	if (!isAllowedHostname(url.hostname, allowedHosts)) {
		throw new WebRobotUrlError(`Host is not allowed by this robot: ${url.hostname}`);
	}

	if (isUnsafeHostname(url.hostname)) {
		throw new WebRobotUrlError(`Host is not safe for web robots: ${url.hostname}`);
	}

	if (net.isIP(url.hostname)) {
		assertPublicIp(url.hostname, url.hostname);
		return url;
	}

	if (options.resolveDns !== false) {
		const addresses = await lookupPublicAddresses(url.hostname);
		for (const address of addresses) {
			assertPublicIp(address, url.hostname);
		}
	}

	return url;
};

export const lookupPublicAddresses = async (hostname: string): Promise<string[]> => {
	try {
		const results = await dns.lookup(hostname, { all: true, verbatim: true });
		if (results.length === 0) {
			throw new WebRobotUrlError(`Host did not resolve: ${hostname}`);
		}
		return results.map((result) => result.address);
	} catch (error) {
		if (error instanceof WebRobotUrlError) {
			throw error;
		}
		throw new WebRobotUrlError(`Host did not resolve: ${hostname}`);
	}
};

export const isUnsafeHostname = (hostname: string): boolean => {
	const normalized = hostname.toLowerCase();
	return (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized === 'metadata.google.internal' ||
		normalized === '169.254.169.254'
	);
};

export const assertPublicIp = (address: string, hostname = address): void => {
	if (net.isIPv4(address)) {
		if (isPrivateIpv4(address)) {
			throw new WebRobotUrlError(`Host '${hostname}' resolves to a private or reserved address: ${address}`);
		}
		return;
	}

	if (net.isIPv6(address)) {
		if (isPrivateIpv6(address)) {
			throw new WebRobotUrlError(`Host '${hostname}' resolves to a private or reserved address: ${address}`);
		}
		return;
	}

	throw new WebRobotUrlError(`Host '${hostname}' resolved to an unsupported address: ${address}`);
};

const isPrivateIpv4 = (address: string): boolean => {
	const parts = address.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return true;
	}

	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && parts[2] === 100) ||
		(a === 203 && b === 0 && parts[2] === 113) ||
		a >= 224
	);
};

const isPrivateIpv6 = (address: string): boolean => {
	const normalized = address.toLowerCase();
	const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	if (mapped) {
		return isPrivateIpv4(mapped);
	}
	return (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe8') ||
		normalized.startsWith('fe9') ||
		normalized.startsWith('fea') ||
		normalized.startsWith('feb') ||
		normalized.startsWith('ff')
	);
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// MCP_VALID_AUDIENCES / MCP_PUBLIC_SERVER_URL / resolveMcpFacingOrigin are derived from env at
// module load (like MCP_SERVER_URL), so each case resets the module registry and re-imports env
// against the current process.env.
describe('MCP_PUBLIC_URL', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.BETTER_AUTH_URL = 'https://nao.internal.example';
		delete process.env.MCP_PUBLIC_URL;
		vi.resetModules();
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it('leaves audiences and origin single-host when unset', async () => {
		const env = await import('../src/env');
		expect(env.MCP_PUBLIC_SERVER_URL).toBeUndefined();
		expect(env.MCP_VALID_AUDIENCES).toEqual(['https://nao.internal.example', 'https://nao.internal.example/mcp']);
		expect(env.MCP_TOKEN_AUDIENCES).toEqual(['https://nao.internal.example/mcp']);
		expect(env.resolveMcpFacingOrigin('nao-mcp.public.example')).toBe('https://nao.internal.example');
	});

	it('adds the public /mcp URL to the token and endpoint audiences when set', async () => {
		process.env.MCP_PUBLIC_URL = 'https://nao-mcp.public.example';
		const env = await import('../src/env');
		expect(env.MCP_PUBLIC_SERVER_URL).toBe('https://nao-mcp.public.example/mcp');
		expect(env.MCP_VALID_AUDIENCES).toContain('https://nao-mcp.public.example/mcp');
		expect(env.MCP_VALID_AUDIENCES).toContain('https://nao.internal.example/mcp');
		// Bearer verification must accept a token minted for either host's /mcp resource,
		// but not the bare UI origin.
		expect(env.MCP_TOKEN_AUDIENCES).toEqual([
			'https://nao.internal.example/mcp',
			'https://nao-mcp.public.example/mcp',
		]);
		expect(env.MCP_TOKEN_AUDIENCES).not.toContain('https://nao.internal.example');
	});

	it('advertises the public origin only for requests on the public host', async () => {
		process.env.MCP_PUBLIC_URL = 'https://nao-mcp.public.example/';
		const env = await import('../src/env');
		expect(env.resolveMcpFacingOrigin('nao-mcp.public.example')).toBe('https://nao-mcp.public.example');
		// Host is case-insensitive — an upper/mixed-case host still resolves to the public origin.
		expect(env.resolveMcpFacingOrigin('NAO-MCP.Public.Example')).toBe('https://nao-mcp.public.example');
		expect(env.resolveMcpFacingOrigin('nao.internal.example')).toBe('https://nao.internal.example');
		expect(env.resolveMcpFacingOrigin(undefined)).toBe('https://nao.internal.example');
		// An arbitrary Host header is never echoed back — only known origins are advertised.
		expect(env.resolveMcpFacingOrigin('evil.attacker.example')).toBe('https://nao.internal.example');
	});

	it('rejects a non-URL MCP_PUBLIC_URL at parse time', async () => {
		process.env.MCP_PUBLIC_URL = 'not-a-url';
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			throw new Error(`process.exit(${code})`);
		}) as never);
		await expect(import('../src/env')).rejects.toThrow(/process\.exit/);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

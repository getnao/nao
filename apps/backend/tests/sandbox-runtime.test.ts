import { constants } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentSettings } from '../src/types/agent-settings';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

type KvmAccess = 'missing' | 'denied' | 'usable';

const sandboxEnabledSettings = {
	experimental: { sandboxes: true },
} as AgentSettings;

async function loadSandboxModules(kvmAccess: KvmAccess, platform = 'linux') {
	vi.resetModules();
	Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });

	const accessSync = vi.fn(() => {
		if (kvmAccess !== 'usable') {
			const error = new Error(kvmAccess === 'missing' ? 'ENOENT' : 'EACCES') as NodeJS.ErrnoException;
			error.code = kvmAccess === 'missing' ? 'ENOENT' : 'EACCES';
			throw error;
		}
	});

	vi.doMock('fs', async (importOriginal) => {
		const actual = await importOriginal<typeof import('fs')>();
		return {
			...actual,
			accessSync,
			default: { ...actual.default, accessSync },
		};
	});
	vi.doMock('@boxlite-ai/boxlite', () => ({
		CodeBox: class FakeCodeBox {},
		ExecError: class FakeExecError extends Error {},
		TimeoutError: class FakeTimeoutError extends Error {},
	}));
	vi.doMock('../src/db/db', () => ({ db: {} }));

	const runtime = await import('../src/services/sandbox-runtime');
	const sandboxTool = await import('../src/agents/tools/execute-sandboxed-code');
	const { getTools } = await import('../src/agents/tools');
	const { default: loadSkillTool } = await import('../src/agents/tools/load-skill');

	return { accessSync, getTools, loadSkillTool, runtime, sandboxTool: sandboxTool.default };
}

async function loadPdfSkill(loadSkillTool: Awaited<ReturnType<typeof loadSandboxModules>>['loadSkillTool']) {
	return (await loadSkillTool.execute!(
		{ name: 'pdf-handling' },
		{
			experimental_context: { agentSettings: sandboxEnabledSettings },
			toolCallId: 'sandbox-capability-test',
			messages: [],
		},
	)) as { body: string };
}

afterEach(() => {
	Object.defineProperty(process, 'platform', originalPlatform);
	vi.restoreAllMocks();
	vi.resetModules();
	vi.doUnmock('fs');
	vi.doUnmock('@boxlite-ai/boxlite');
	vi.doUnmock('../src/db/db');
});

describe('sandbox runtime host capability', () => {
	it.each(['missing', 'denied'] as const)(
		'should not expose the sandbox when /dev/kvm is %s - regression for ENG-9189',
		async (kvmAccess) => {
			// Arrange
			const modules = await loadSandboxModules(kvmAccess);

			// Act
			const tools = modules.getTools(sandboxEnabledSettings, undefined, { mcpEnabled: false });
			const pdfSkill = await loadPdfSkill(modules.loadSkillTool);

			// Assert
			expect(modules.accessSync).toHaveBeenCalledWith('/dev/kvm', constants.R_OK | constants.W_OK);
			expect(modules.runtime.sandboxRuntime).toBeNull();
			expect(modules.runtime.isSandboxAvailable).toBe(false);
			expect(modules.sandboxTool).toBeNull();
			expect(tools).not.toHaveProperty('execute_sandboxed_code');
			expect(pdfSkill.body).not.toContain('pdfplumber');
		},
	);

	it('should expose the sandbox when /dev/kvm is usable', async () => {
		// Arrange
		const modules = await loadSandboxModules('usable');

		// Act
		const tools = modules.getTools(sandboxEnabledSettings, undefined, { mcpEnabled: false });
		const pdfSkill = await loadPdfSkill(modules.loadSkillTool);

		// Assert
		expect(modules.accessSync).toHaveBeenCalledWith('/dev/kvm', constants.R_OK | constants.W_OK);
		expect(modules.runtime.sandboxRuntime).not.toBeNull();
		expect(modules.runtime.isSandboxAvailable).toBe(true);
		expect(modules.sandboxTool).not.toBeNull();
		expect(tools).toHaveProperty('execute_sandboxed_code');
		expect(pdfSkill.body).toContain('pdfplumber');
	});

	it('should preserve the native runtime check on non-Linux hosts', async () => {
		// Arrange
		const modules = await loadSandboxModules('missing', 'darwin');

		// Act
		const tools = modules.getTools(sandboxEnabledSettings, undefined, { mcpEnabled: false });

		// Assert
		expect(modules.accessSync).not.toHaveBeenCalled();
		expect(modules.runtime.isSandboxAvailable).toBe(true);
		expect(tools).toHaveProperty('execute_sandboxed_code');
	});
});

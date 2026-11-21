// Compiles the sidecar into one executable per target with Bun, named the way Tauri's `externalBin`
// expects: src-tauri/binaries/nao-agent-<target triple>[.exe]. Targets come from the arguments, then
// from the target Tauri builds for, then from the host.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const BUN_TARGETS = {
	'aarch64-apple-darwin': 'bun-darwin-arm64',
	'x86_64-apple-darwin': 'bun-darwin-x64',
	'x86_64-unknown-linux-gnu': 'bun-linux-x64',
	'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
	'x86_64-pc-windows-msvc': 'bun-windows-x64',
};

const agentDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const binariesDirectory = join(agentDirectory, '..', 'src-tauri', 'binaries');
const targets = readTargets();

installDependencies();
mkdirSync(binariesDirectory, { recursive: true });
for (const target of targets) {
	buildTarget(target);
}
if (targets.includes('aarch64-apple-darwin') && targets.includes('x86_64-apple-darwin')) {
	buildUniversalMacBinary();
}

/** The sidecar is not an npm workspace: the SDK's optional bundled Claude binaries are never installed. */
function installDependencies() {
	if (existsSync(join(agentDirectory, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'))) {
		return;
	}
	execFileSync('npm', ['ci', '--omit=optional', '--no-workspaces', '--ignore-scripts', '--no-audit', '--no-fund'], {
		stdio: 'inherit',
		cwd: agentDirectory,
		shell: process.platform === 'win32',
	});
}

function readTargets() {
	const requested = process.argv.slice(2);
	const targets = requested.length > 0 ? requested : [process.env.TAURI_ENV_TARGET_TRIPLE || hostTarget()];
	if (targets.includes('universal-apple-darwin')) {
		return ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
	}
	return targets;
}

function hostTarget() {
	const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
	const host = output.match(/^host: (.+)$/m)?.[1];
	if (!host) {
		throw new Error('Could not read the host target from `rustc -vV`.');
	}
	return host;
}

function buildTarget(target) {
	const bunTarget = BUN_TARGETS[target];
	if (!bunTarget) {
		throw new Error(`No Bun target for ${target}. Known targets: ${Object.keys(BUN_TARGETS).join(', ')}`);
	}
	const extension = target.includes('windows') ? '.exe' : '';
	execFileSync(
		'bun',
		[
			'build',
			'--compile',
			'--minify',
			'--no-compile-autoload-dotenv',
			'--no-compile-autoload-bunfig',
			`--target=${bunTarget}`,
			join(agentDirectory, 'src', 'main.ts'),
			'--outfile',
			join(binariesDirectory, `nao-agent-${target}${extension}`),
		],
		{ stdio: 'inherit', cwd: agentDirectory },
	);
}

function buildUniversalMacBinary() {
	execFileSync(
		'lipo',
		[
			'-create',
			join(binariesDirectory, 'nao-agent-aarch64-apple-darwin'),
			join(binariesDirectory, 'nao-agent-x86_64-apple-darwin'),
			'-output',
			join(binariesDirectory, 'nao-agent-universal-apple-darwin'),
		],
		{ stdio: 'inherit' },
	);
}

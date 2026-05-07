#!/usr/bin/env node
/* @license Enterprise */
/**
 * Build-time lockdown for the bundled license public key.
 *
 * Invoked by the Dockerfile after the backend source has been copied into
 * the runtime image. Extracts the bundled public key literal from the
 * committed source and rewrites the file with a stripped-down version that
 * has no env override path and no test hook.
 *
 * Why: at runtime the source's `process.env.NAO_LICENSE_PUBLIC_KEY`
 * branch lets a developer point the backend at a local license server
 * with its own keypair. That same branch in a production image would let
 * an attacker hand-roll a license signed with their own key, just by
 * setting an env var. Removing the branch from the image — not gating
 * it on NODE_ENV or similar — is the only honest way to close that hole.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultTarget = resolve(here, '..', 'apps', 'backend', 'src', 'services', 'license-public-key.ts');
const targetPath = argv[2] ?? defaultTarget;

if (!existsSync(targetPath)) {
	console.warn(`[lock-license-key] ${targetPath} not found; skipping.`);
	exit(0);
}

const source = readFileSync(targetPath, 'utf-8');

const match = source.match(/BUNDLED_PUBLIC_KEY_PEM\s*=\s*`([^`]+)`/);
if (!match) {
	console.error(`[lock-license-key] could not find BUNDLED_PUBLIC_KEY_PEM literal in ${targetPath}`);
	exit(1);
}

const pem = match[1];

const locked = `/* @license Enterprise */
// Production build — rewritten by docker/lock-license-key.mjs at image
// build time. The dev env-override branch has been stripped so
// NAO_LICENSE_PUBLIC_KEY is a no-op in production images.
const BUNDLED_PUBLIC_KEY_PEM = \`${pem}\`;

export function getBundledPublicKey(): string {
\treturn BUNDLED_PUBLIC_KEY_PEM;
}

export function __setBundledPublicKeyForTesting(_pem: string | null): void {
\t// no-op in production builds
}
`;

writeFileSync(targetPath, locked);
console.log(`[lock-license-key] locked down ${targetPath}`);

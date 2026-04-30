#!/usr/bin/env bun
/**
 * Generate a signed NAO_LICENSE file for local development / testing.
 *
 *   bun scripts/license-generate-dev.ts \
 *     --company "Acme Corp" \
 *     --features sso \
 *     --days 30 \
 *     [--trial] \
 *     [--subscription-id sub_abc] \
 *     [--output ./license.key] \
 *     [--private-key ./dev-private.pem] \
 *     [--public-key ./dev-public.pem]
 *
 * When no --private-key / --public-key is provided, a fresh Ed25519 key pair
 * is generated and written next to the license file. The public key is the
 * value you need to set for `NAO_LICENSE_PUBLIC_KEY` so the backend can
 * verify the dev license (it will NOT match the bundled production key).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose';

const ALG = 'EdDSA';

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const company = args.get('company') ?? 'Dev Corp';
	const features = (args.get('features') ?? 'sso')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const days = Number(args.get('days') ?? '30');
	const isTrial = args.has('trial');
	const subscriptionId = args.get('subscription-id') ?? `sub_dev_${Date.now()}`;
	const output = path.resolve(args.get('output') ?? './license.key');

	const { privateKey, publicKeyPem } = await resolveKeys(args);

	const now = Math.floor(Date.now() / 1000);
	const token = await new SignJWT({
		subscriptionId,
		companyName: company,
		isTrial,
		features,
	})
		.setProtectedHeader({ alg: ALG })
		.setIssuer('getnao')
		.setIssuedAt(now)
		.setExpirationTime(now + days * 24 * 60 * 60)
		.sign(privateKey);

	writeFileSync(output, token);

	console.log(`License written to: ${output}`);
	console.log(`Company:        ${company}`);
	console.log(`Subscription:   ${subscriptionId}`);
	console.log(`Trial:          ${isTrial}`);
	console.log(`Expires in:     ${days} days`);
	console.log(`Features:       ${features.join(', ')}`);
	console.log('');
	console.log('Add this to your .env:');
	console.log(`NAO_LICENSE=${output}`);
	if (!args.has('private-key')) {
		console.log('NAO_LICENSE_PUBLIC_KEY="', publicKeyPem.trim(), '"');
	}
}

async function resolveKeys(args: Map<string, string> & { has(key: string): boolean }) {
	const privateKeyPath = args.get('private-key');
	const publicKeyPath = args.get('public-key');

	if (privateKeyPath && existsSync(privateKeyPath)) {
		const pem = readFileSync(privateKeyPath, 'utf-8');
		const privateKey = await importPKCS8(pem, ALG);
		const publicKeyPem = publicKeyPath && existsSync(publicKeyPath) ? readFileSync(publicKeyPath, 'utf-8') : '';
		return { privateKey, publicKeyPem };
	}

	const { privateKey, publicKey } = await generateKeyPair(ALG, { crv: 'Ed25519', extractable: true });
	const privatePem = await exportPKCS8(privateKey);
	const publicPem = await exportSPKI(publicKey);

	const outDir = path.dirname(path.resolve(args.get('output') ?? './license.key'));
	writeFileSync(path.join(outDir, 'dev-private.pem'), privatePem);
	writeFileSync(path.join(outDir, 'dev-public.pem'), publicPem);

	console.log(`Generated dev key pair: ${outDir}/dev-private.pem, ${outDir}/dev-public.pem`);
	return { privateKey, publicKeyPem: publicPem };
}

function parseArgs(argv: string[]): Map<string, string> & { has(key: string): boolean } {
	const map = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			continue;
		}
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--')) {
			map.set(key, next);
			i += 1;
		} else {
			map.set(key, 'true');
		}
	}
	return map as Map<string, string> & { has(key: string): boolean };
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

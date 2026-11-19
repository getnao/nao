import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { logger } from './logger';

const FILE_REFERENCE_KEY = 'from_file';
const SECRET_REFERENCE_PATTERN = /\{\{\s*(?:env|aws|k8s)\(/;
const UNRESOLVED = Symbol('unresolved file reference');

type FileReference = { [FILE_REFERENCE_KEY]: string };

/**
 * Replaces each `{ from_file: <path> }` value of a parsed nao_config.yaml by the content of that file of the project,
 * under the rules of the CLI (`nao_core/config/file_references.py`). A reference the CLI would refuse is left out with
 * a warning, as the backend reads the config leniently.
 */
export function resolveFileReferences(node: unknown, projectFolder: string): unknown {
	const resolved = resolveNode(node, projectFolder);
	return resolved === UNRESOLVED ? null : resolved;
}

export function holdsFileReference(node: unknown): boolean {
	return someNode(node, isFileReference);
}

function resolveNode(node: unknown, projectFolder: string): unknown {
	if (isFileReference(node)) {
		return readReferencedFile(node[FILE_REFERENCE_KEY], projectFolder);
	}
	if (Array.isArray(node)) {
		return node.map((item) => resolveNode(item, projectFolder)).filter((item) => item !== UNRESOLVED);
	}
	if (!isPlainRecord(node)) {
		return node;
	}
	const entries = Object.entries(node).map(([key, value]) => [key, resolveNode(value, projectFolder)] as const);
	return Object.fromEntries(entries.filter(([, value]) => value !== UNRESOLVED));
}

function readReferencedFile(file: string, projectFolder: string): unknown {
	try {
		const value = yaml.load(fs.readFileSync(resolveInsideProject(file, projectFolder), 'utf-8'));
		if (someNode(value, isSecretReference)) {
			throw new Error('it holds a secret reference, which only nao_config.yaml itself can use');
		}
		if (holdsFileReference(value)) {
			throw new Error(`it holds another ${FILE_REFERENCE_KEY} reference, which is not supported`);
		}
		return value;
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		logger.warn(`Ignoring ${FILE_REFERENCE_KEY} '${file}' of nao_config.yaml: ${reason}`, { source: 'system' });
		return UNRESOLVED;
	}
}

function resolveInsideProject(file: string, projectFolder: string): string {
	const relativeFile = file.trim();
	const isRelative = relativeFile !== '' && !relativeFile.startsWith('/') && !relativeFile.includes('\\');
	if (!isRelative || relativeFile.split('/').includes('..')) {
		throw new Error("it must be a relative path with forward slashes and no '..'");
	}

	const projectRoot = fs.realpathSync(projectFolder);
	const filePath = fs.realpathSync(path.resolve(projectRoot, relativeFile));
	const relativePath = path.relative(projectRoot, filePath);
	if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		throw new Error('it points outside the project');
	}
	return filePath;
}

/** Checked on parsed strings, as a YAML escape would hide the reference from a check of the file's text. */
function isSecretReference(node: unknown): boolean {
	return typeof node === 'string' && SECRET_REFERENCE_PATTERN.test(node);
}

function someNode(node: unknown, predicate: (node: unknown) => boolean): boolean {
	if (predicate(node)) {
		return true;
	}
	if (Array.isArray(node)) {
		return node.some((child) => someNode(child, predicate));
	}
	return (
		isPlainRecord(node) &&
		Object.entries(node)
			.flat()
			.some((child) => someNode(child, predicate))
	);
}

function isFileReference(node: unknown): node is FileReference {
	return isPlainRecord(node) && Object.keys(node).length === 1 && typeof node[FILE_REFERENCE_KEY] === 'string';
}

/** Leaves out the dates that js-yaml builds, which have no entries to walk. */
function isPlainRecord(node: unknown): node is Record<string, unknown> {
	return typeof node === 'object' && node !== null && Object.getPrototypeOf(node) === Object.prototype;
}

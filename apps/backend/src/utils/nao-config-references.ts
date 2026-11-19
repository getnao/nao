import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { logger } from './logger';

const MAX_CONFIG_NODES = 100_000;
const FILE_REFERENCE_KEY = 'from_file';
const SECRET_REFERENCE_PATTERN = /\{\{\s*(?:env|aws|k8s)\(/;
const UNRESOLVED = Symbol('unresolved file reference');

type FileReference = { [FILE_REFERENCE_KEY]: string };
type Resolution = { projectFolder: string; remainingNodes: number };

/**
 * Replaces each `{ from_file: <path> }` value of a parsed nao_config.yaml by the content of that file of the project,
 * under the rules of the CLI (`nao_core/config/file_references.py`). A reference the CLI would refuse is left out with
 * a warning, as the backend reads the config leniently. A config larger than MAX_CONFIG_NODES is refused whole.
 */
export function resolveFileReferences(node: unknown, projectFolder: string): unknown {
	const resolution = { projectFolder, remainingNodes: MAX_CONFIG_NODES };
	spendNodes(node, resolution);
	const resolved = resolveNode(node, resolution);
	return resolved === UNRESOLVED ? null : resolved;
}

export function holdsFileReference(node: unknown): boolean {
	return someNode(node, isFileReference);
}

function resolveNode(node: unknown, resolution: Resolution): unknown {
	if (isFileReference(node)) {
		const content = readReferencedFile(node[FILE_REFERENCE_KEY], resolution.projectFolder);
		spendNodes(content, resolution);
		return content;
	}
	if (Array.isArray(node)) {
		return node.map((item) => resolveNode(item, resolution)).filter((item) => item !== UNRESOLVED);
	}
	if (!isPlainRecord(node)) {
		return node;
	}
	const entries = Object.entries(node).map(([key, value]) => [key, resolveNode(value, resolution)] as const);
	return Object.fromEntries(entries.filter(([, value]) => value !== UNRESOLVED));
}

/**
 * A YAML alias is parsed into one shared object, which a walk visits again at each of its uses: a few lines of
 * nested aliases expand into billions of nodes. The config is refused before any walk that would visit them all.
 */
function spendNodes(node: unknown, resolution: Resolution): void {
	resolution.remainingNodes -= countWalkedNodes(node, new Map());
	if (resolution.remainingNodes < 0) {
		throw new Error(
			`nao_config.yaml holds more than ${MAX_CONFIG_NODES} values, once its YAML aliases and its ${FILE_REFERENCE_KEY} files are expanded`,
		);
	}
}

/** A node met again while it is being counted is an alias to one of its own parents, which no walk can finish. */
function countWalkedNodes(node: unknown, counted: Map<unknown, number>): number {
	if (!isContainer(node)) {
		return 1;
	}
	const known = counted.get(node);
	if (known !== undefined) {
		return known;
	}
	counted.set(node, Infinity);
	const count = childrenOf(node).reduce<number>((total, child) => total + countWalkedNodes(child, counted), 1);
	counted.set(node, count);
	return count;
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

/** Visits a node shared through YAML aliases once, whatever the number of its uses. */
function someNode(node: unknown, predicate: (node: unknown) => boolean, visited = new Set<unknown>()): boolean {
	if (predicate(node)) {
		return true;
	}
	if (!isContainer(node) || visited.has(node)) {
		return false;
	}
	visited.add(node);
	return childrenOf(node).some((child) => someNode(child, predicate, visited));
}

function childrenOf(node: unknown[] | Record<string, unknown>): unknown[] {
	return Array.isArray(node) ? node : Object.entries(node).flat();
}

function isContainer(node: unknown): node is unknown[] | Record<string, unknown> {
	return Array.isArray(node) || isPlainRecord(node);
}

function isFileReference(node: unknown): node is FileReference {
	return isPlainRecord(node) && Object.keys(node).length === 1 && typeof node[FILE_REFERENCE_KEY] === 'string';
}

/** Leaves out the dates that js-yaml builds, which have no entries to walk. */
function isPlainRecord(node: unknown): node is Record<string, unknown> {
	return typeof node === 'object' && node !== null && Object.getPrototypeOf(node) === Object.prototype;
}

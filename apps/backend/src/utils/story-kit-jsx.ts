import { isDeepStrictEqual } from 'node:util';

import { parse } from '@babel/parser';
import type { Expression, ImportDeclaration, JSXAttribute, JSXElement, Node } from '@babel/types';
import { traverseFast } from '@babel/types';
import type { StoryKitBlockChange, StoryKitBlockRef, StoryKitEditableBlock } from '@nao/shared/story-app';
import { isStoryKitEditableBlock } from '@nao/shared/story-app';

export interface KitElement {
	component: StoryKitEditableBlock;
	attributes: KitAttribute[];
	hasSpread: boolean;
	nameRanges: SourceRange[];
	attributesEnd: number;
}

interface KitAttribute extends SourceRange {
	name: string;
	value: unknown;
}

interface SourceRange {
	start: number;
	end: number;
}

interface KitImport {
	localNames: Map<StoryKitEditableBlock, string>;
	namespace: string | null;
	lastSpecifierEnd: number | null;
}

export interface KitSource {
	elements: KitElement[];
	kitImport: KitImport;
}

interface SourceEdit extends SourceRange {
	text: string;
}

export class StoryKitJsxEditError extends Error {}

export const STORY_KIT_MODULE = '@nao/story-kit';
const DYNAMIC = Symbol('dynamic');
const IGNORED_ATTRIBUTES = new Set(['key', 'ref']);
const JS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const PLAIN_JSX_STRING = /^[^"\\{}<>&\r\n]*$/;

/** Every kit block rendered by a script file, with where its tag name and props sit in the source. */
export function parseKitSource(path: string, source: string): KitSource | null {
	const program = parseScript(path, source);
	if (!program) {
		return null;
	}
	const kitImport = readKitImport(program);
	if (kitImport.localNames.size === 0 && kitImport.namespace === null) {
		return { elements: [], kitImport };
	}
	const elements: KitElement[] = [];
	traverseFast(program, (node) => {
		if (node.type === 'JSXElement') {
			const element = toKitElement(node, kitImport);
			if (element) {
				elements.push(element);
			}
		}
	});
	return { elements, kitImport };
}

/**
 * A rendered block matches a source element when every literal prop in the source equals what the block
 * received. Props computed in code cannot be compared, so they never rule an element out.
 */
export function matchesKitBlock(element: KitElement, block: StoryKitBlockRef): boolean {
	if (element.component !== block.component) {
		return false;
	}
	const attributeNames = new Set(element.attributes.map((attribute) => attribute.name));
	const literalsMatch = element.attributes.every(
		(attribute) =>
			attribute.value === DYNAMIC ||
			(attribute.name in block.props && isDeepStrictEqual(toJson(attribute.value), block.props[attribute.name])),
	);
	const everyPropWritten = element.hasSpread || Object.keys(block.props).every((name) => attributeNames.has(name));
	return literalsMatch && everyPropWritten;
}

export function applyKitBlockChange(
	source: string,
	kitSource: KitSource,
	element: KitElement,
	change: StoryKitBlockChange,
): string {
	const edits: SourceEdit[] = [];
	const insertions: string[] = [];

	for (const name of change.unset) {
		const attribute = findEditableAttribute(element, name);
		if (attribute) {
			edits.push({ start: startOfLeadingWhitespace(source, attribute.start), end: attribute.end, text: '' });
		}
	}
	for (const [name, value] of Object.entries(change.set)) {
		if (!JS_IDENTIFIER.test(name)) {
			throw new StoryKitJsxEditError(`"${name}" is not a valid prop name.`);
		}
		const attribute = findEditableAttribute(element, name);
		const text = `${name}=${toJsxAttributeValue(value)}`;
		if (attribute) {
			edits.push({ start: attribute.start, end: attribute.end, text });
		} else {
			insertions.push(` ${text}`);
		}
	}
	if (insertions.length > 0) {
		edits.push({ start: element.attributesEnd, end: element.attributesEnd, text: insertions.join('') });
	}
	if (change.component && change.component !== element.component) {
		edits.push(...renameElement(kitSource.kitImport, element, change.component));
	}

	return applyEdits(source, edits);
}

export function parseScript(path: string, source: string): Node | null {
	const isTypeScript = /\.tsx?$/i.test(path);
	const hasJsx = !/\.ts$/i.test(path);
	try {
		return parse(source, {
			sourceType: 'module',
			plugins: [...(isTypeScript ? (['typescript'] as const) : []), ...(hasJsx ? (['jsx'] as const) : [])],
		}).program;
	} catch {
		return null;
	}
}

function readKitImport(program: Node): KitImport {
	const kitImport: KitImport = { localNames: new Map(), namespace: null, lastSpecifierEnd: null };
	if (program.type !== 'Program') {
		return kitImport;
	}
	const declarations = program.body.filter(
		(statement): statement is ImportDeclaration =>
			statement.type === 'ImportDeclaration' && statement.source.value === STORY_KIT_MODULE,
	);
	for (const declaration of declarations) {
		for (const specifier of declaration.specifiers) {
			if (specifier.type === 'ImportNamespaceSpecifier') {
				kitImport.namespace = specifier.local.name;
				continue;
			}
			if (specifier.type !== 'ImportSpecifier') {
				continue;
			}
			kitImport.lastSpecifierEnd = specifier.end ?? kitImport.lastSpecifierEnd;
			const imported =
				specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
			if (isStoryKitEditableBlock(imported)) {
				kitImport.localNames.set(imported, specifier.local.name);
			}
		}
	}
	return kitImport;
}

function toKitElement(node: JSXElement, kitImport: KitImport): KitElement | null {
	const opening = node.openingElement;
	const component = resolveComponent(opening.name, kitImport);
	if (!component) {
		return null;
	}
	const attributes: KitAttribute[] = [];
	let hasSpread = false;
	for (const attribute of opening.attributes) {
		if (attribute.type === 'JSXSpreadAttribute') {
			hasSpread = true;
			continue;
		}
		const name = attribute.name.type === 'JSXIdentifier' ? attribute.name.name : null;
		if (name && !IGNORED_ATTRIBUTES.has(name)) {
			attributes.push({ name, start: attribute.start!, end: attribute.end!, value: attributeValue(attribute) });
		}
	}
	const nameRanges = [opening.name, node.closingElement?.name]
		.filter((name) => name !== undefined)
		.map((name) => ({ start: name.start!, end: name.end! }));
	const lastAttribute = opening.attributes.at(-1);
	return {
		component,
		attributes,
		hasSpread,
		nameRanges,
		attributesEnd: lastAttribute?.end ?? opening.name.end!,
	};
}

function resolveComponent(name: JSXElement['openingElement']['name'], kitImport: KitImport) {
	if (name.type === 'JSXIdentifier') {
		for (const [component, localName] of kitImport.localNames) {
			if (localName === name.name) {
				return component;
			}
		}
		return null;
	}
	if (
		name.type === 'JSXMemberExpression' &&
		name.object.type === 'JSXIdentifier' &&
		name.object.name === kitImport.namespace &&
		isStoryKitEditableBlock(name.property.name)
	) {
		return name.property.name;
	}
	return null;
}

function attributeValue(attribute: JSXAttribute): unknown {
	const { value } = attribute;
	if (value === null || value === undefined) {
		return true;
	}
	if (value.type === 'StringLiteral') {
		return value.value;
	}
	if (value.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression') {
		return literalValue(value.expression);
	}
	return DYNAMIC;
}

function literalValue(node: Expression): unknown {
	switch (node.type) {
		case 'StringLiteral':
		case 'NumericLiteral':
		case 'BooleanLiteral':
			return node.value;
		case 'NullLiteral':
			return null;
		case 'TemplateLiteral':
			return node.expressions.length === 0 ? node.quasis[0].value.cooked : DYNAMIC;
		case 'UnaryExpression':
			return node.operator === '-' && node.argument.type === 'NumericLiteral' ? -node.argument.value : DYNAMIC;
		case 'ArrayExpression':
			return literalArray(node.elements);
		case 'ObjectExpression':
			return literalObject(node.properties);
		default:
			return DYNAMIC;
	}
}

function literalArray(elements: (Node | null)[]): unknown {
	const values = elements.map((element) =>
		element && element.type !== 'SpreadElement' ? literalValue(element as Expression) : DYNAMIC,
	);
	return values.includes(DYNAMIC) ? DYNAMIC : values;
}

function literalObject(properties: Node[]): unknown {
	const entries: [string, unknown][] = [];
	for (const property of properties) {
		if (property.type !== 'ObjectProperty' || property.computed) {
			return DYNAMIC;
		}
		const key = property.key;
		const name = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : undefined;
		const value = literalValue(property.value as Expression);
		if (name === undefined || value === DYNAMIC) {
			return DYNAMIC;
		}
		entries.push([name, value]);
	}
	return Object.fromEntries(entries);
}

function findEditableAttribute(element: KitElement, name: string): KitAttribute | undefined {
	const attribute = element.attributes.find((candidate) => candidate.name === name);
	if (attribute?.value === DYNAMIC) {
		throw new StoryKitJsxEditError(`"${name}" is computed in the story's code. Ask the agent to change it.`);
	}
	return attribute;
}

function renameElement(kitImport: KitImport, element: KitElement, component: StoryKitEditableBlock): SourceEdit[] {
	const edits: SourceEdit[] = [];
	let localName = kitImport.localNames.get(component);
	if (!localName && kitImport.namespace) {
		localName = `${kitImport.namespace}.${component}`;
	}
	if (!localName) {
		if (kitImport.lastSpecifierEnd === null) {
			throw new StoryKitJsxEditError(`Could not import ${component} from ${STORY_KIT_MODULE}.`);
		}
		edits.push({ start: kitImport.lastSpecifierEnd, end: kitImport.lastSpecifierEnd, text: `, ${component}` });
		localName = component;
	}
	for (const range of element.nameRanges) {
		edits.push({ ...range, text: localName });
	}
	return edits;
}

function applyEdits(source: string, edits: SourceEdit[]): string {
	return [...edits]
		.sort((left, right) => right.start - left.start)
		.reduce((text, edit) => `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`, source);
}

function startOfLeadingWhitespace(source: string, index: number): number {
	let start = index;
	while (start > 0 && /\s/.test(source[start - 1])) {
		start--;
	}
	return start;
}

function toJsxAttributeValue(value: unknown): string {
	if (typeof value === 'string' && PLAIN_JSX_STRING.test(value)) {
		return `"${value}"`;
	}
	return `{${toJsLiteral(value)}}`;
}

function toJsLiteral(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(toJsLiteral).join(', ')}]`;
	}
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value).map(
			([key, entry]) => `${JS_IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${toJsLiteral(entry)}`,
		);
		return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{}';
	}
	return JSON.stringify(value) ?? 'undefined';
}

function toJson(value: unknown): unknown {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

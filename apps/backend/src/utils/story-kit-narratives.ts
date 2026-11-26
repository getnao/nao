import type { ImportSpecifier, JSXAttribute, JSXElement, Node } from '@babel/types';
import { traverseFast } from '@babel/types';
import { STORY_KIT_NARRATIVE_COMPONENT } from '@nao/shared/story-app';

import { parseScript, STORY_KIT_MODULE } from './story-kit-jsx';

export interface StoryNarrativeSource {
	id: string;
	text: string;
}

interface StoryNarrativeElement {
	id: string;
	text: string | null;
}

interface NarrativeImport {
	localName: string | null;
	namespace: string | null;
}

const SCRIPT_FILE = /\.(jsx?|tsx?)$/i;

/** Every `<Narrative>` whose id and text are written as literals, the only ones a refresh can rewrite. */
export function extractStoryNarratives(files: { path: string; content: string }[]): StoryNarrativeSource[] {
	const narratives = new Map<string, string>();
	for (const file of files.filter((candidate) => SCRIPT_FILE.test(candidate.path))) {
		for (const narrative of extractFileNarrativeElements(file.path, file.content)) {
			if (narrative.text !== null && !narratives.has(narrative.id)) {
				narratives.set(narrative.id, narrative.text);
			}
		}
	}
	return [...narratives].map(([id, text]) => ({ id, text }));
}

export function extractStoryNarrativeIds(files: { path: string; content: string }[]): string[] {
	const ids = new Set<string>();
	for (const file of files.filter((candidate) => SCRIPT_FILE.test(candidate.path))) {
		for (const { id } of extractFileNarrativeElements(file.path, file.content)) {
			ids.add(id);
		}
	}
	return [...ids];
}

function extractFileNarrativeElements(path: string, source: string): StoryNarrativeElement[] {
	const program = parseScript(path, source);
	if (!program) {
		return [];
	}
	const narrativeImport = readNarrativeImport(program);
	if (!narrativeImport.localName && !narrativeImport.namespace) {
		return [];
	}
	const narratives: StoryNarrativeElement[] = [];
	traverseFast(program, (node) => {
		if (node.type === 'JSXElement' && isNarrativeElement(node, narrativeImport)) {
			const narrative = toNarrativeElement(node);
			if (narrative) {
				narratives.push(narrative);
			}
		}
	});
	return narratives;
}

function readNarrativeImport(program: Node): NarrativeImport {
	const narrativeImport: NarrativeImport = { localName: null, namespace: null };
	if (program.type !== 'Program') {
		return narrativeImport;
	}
	for (const statement of program.body) {
		if (statement.type !== 'ImportDeclaration' || statement.source.value !== STORY_KIT_MODULE) {
			continue;
		}
		for (const specifier of statement.specifiers) {
			if (specifier.type === 'ImportNamespaceSpecifier') {
				narrativeImport.namespace = specifier.local.name;
			} else if (
				specifier.type === 'ImportSpecifier' &&
				importedName(specifier) === STORY_KIT_NARRATIVE_COMPONENT
			) {
				narrativeImport.localName = specifier.local.name;
			}
		}
	}
	return narrativeImport;
}

function importedName(specifier: ImportSpecifier): string {
	return specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
}

function isNarrativeElement(node: JSXElement, narrativeImport: NarrativeImport): boolean {
	const name = node.openingElement.name;
	if (name.type === 'JSXIdentifier') {
		return name.name === narrativeImport.localName;
	}
	return (
		name.type === 'JSXMemberExpression' &&
		name.object.type === 'JSXIdentifier' &&
		name.object.name === narrativeImport.namespace &&
		name.property.name === STORY_KIT_NARRATIVE_COMPONENT
	);
}

function toNarrativeElement(node: JSXElement): StoryNarrativeElement | null {
	const idAttribute = node.openingElement.attributes.find(
		(attribute): attribute is JSXAttribute =>
			attribute.type === 'JSXAttribute' &&
			attribute.name.type === 'JSXIdentifier' &&
			attribute.name.name === 'id',
	);
	const id = idAttribute ? literalString(idAttribute.value) : null;
	return id ? { id, text: literalChildrenText(node.children) } : null;
}

function literalString(node: JSXAttribute['value'] | Node | null | undefined): string | null {
	if (!node) {
		return null;
	}
	if (node.type === 'StringLiteral') {
		return node.value;
	}
	if (node.type === 'JSXExpressionContainer') {
		return literalString(node.expression);
	}
	if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
		return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
	}
	return null;
}

/** Text computed in code is already live, so a narrative with any non-literal child is left to render as written. */
function literalChildrenText(children: JSXElement['children']): string | null {
	const parts: string[] = [];
	for (const child of children) {
		const text = child.type === 'JSXText' ? child.value : literalString(child);
		if (text === null) {
			return null;
		}
		parts.push(text);
	}
	return parts.join('').replace(/\s+/g, ' ').trim() || null;
}

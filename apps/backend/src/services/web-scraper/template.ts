export type TemplateScope = Record<string, unknown>;

const TEMPLATE_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_-]*)((?:\.[A-Za-z0-9_-]+|\[\d+\])*)\s*}}/g;
const WHOLE_TEMPLATE_PATTERN = /^{{\s*([A-Za-z][A-Za-z0-9_-]*)((?:\.[A-Za-z0-9_-]+|\[\d+\])*)\s*}}$/;

export const renderTemplate = <T>(value: T, scope: TemplateScope): T => {
	if (typeof value === 'string') {
		return renderStringTemplate(value, scope) as T;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => renderTemplate(entry, scope)) as T;
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, renderTemplate(entry, scope)]),
		) as T;
	}
	return value;
};

export const renderStringTemplate = (template: string, scope: TemplateScope): string => {
	const whole = template.match(WHOLE_TEMPLATE_PATTERN);
	if (whole) {
		const value = getTemplateValue(scope, whole[1]!, whole[2] ?? '');
		return value === undefined || value === null ? '' : String(value);
	}

	return template.replace(TEMPLATE_PATTERN, (_, name: string, path: string) => {
		const value = getTemplateValue(scope, name, path);
		return value === undefined || value === null ? '' : String(value);
	});
};

export const getTemplateValue = (scope: TemplateScope, name: string, pathExpression: string): unknown => {
	const root = scope[name];
	if (pathExpression === '') {
		return root;
	}
	return getPathValue(root, parsePath(pathExpression.replace(/^\./, '')));
};

export const parsePath = (path: string): Array<string | number> => {
	const matches = path.match(/[A-Za-z0-9_-]+|\[\d+\]/g) ?? [];
	return matches.map((part) => (part.startsWith('[') ? Number(part.slice(1, -1)) : part));
};

export const getPathValue = (value: unknown, path: Array<string | number> | string): unknown => {
	const parts = typeof path === 'string' ? parsePath(path) : path;
	let current = value;

	for (const part of parts) {
		if (current === null || current === undefined) {
			return undefined;
		}
		if (Array.isArray(current) && typeof part === 'number') {
			current = current[part];
			continue;
		}
		if (typeof current === 'object' && typeof part === 'string') {
			current = (current as Record<string, unknown>)[part];
			continue;
		}
		return undefined;
	}

	return current;
};

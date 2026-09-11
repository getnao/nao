import type { WebRobotElementFingerprint } from '@nao/shared/web-robot';

export type WebRobotElementDescriptor = {
	tag: string;
	attributes: Record<string, string>;
	classes: string[];
	childTags: string[];
	text?: string;
};

export const elementFingerprintScore = (
	expected: WebRobotElementFingerprint,
	actual: WebRobotElementDescriptor,
): number => {
	if (!expected.tag || !actual.tag || expected.tag !== actual.tag) {
		return 0;
	}
	let score = 30;
	let attributeScore = 0;
	for (const [name, value] of Object.entries(expected.attributes)) {
		if (actual.attributes[name] === value) {
			attributeScore += 16;
		}
	}
	score += Math.min(attributeScore, 32);

	const actualClasses = new Set(actual.classes);
	score += Math.min(expected.classes.filter((name) => actualClasses.has(name)).length * 5, 20);

	const actualChildren = new Set(actual.childTags);
	score += Math.min(expected.childTags.filter((tag) => actualChildren.has(tag)).length * 10, 30);

	const expectedText = normalizeFingerprintText(expected.text);
	const actualText = normalizeFingerprintText(actual.text);
	if (expectedText && actualText && (expectedText === actualText || actualText.includes(expectedText))) {
		score += 12;
	}
	return Math.min(100, score);
};

export const normalizeFingerprintText = (value: string | undefined): string => {
	return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
};

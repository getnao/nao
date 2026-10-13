import { STORY_FRAME_CONTAINER, STORY_STYLE_ATTRIBUTE } from '@nao/shared/story-app';
import { useLayoutEffect } from 'react';

const REBASED_ATTRIBUTE = 'data-nao-frame-rebased';
const MEDIA_RULE = /@media\s*([^{]+)\{/g;
const MEDIA_TYPE_PREFIX = /^\s*(only\s+)?(screen|all)\s+and\s+/i;
const FRAME_FEATURE =
	/^\(\s*(((min|max)-)?(width|height|aspect-ratio)\b|orientation\b|(width|height)\s*[<>=]|[^()<>=]+[<>]=?\s*(width|height)\b)/i;
const CONDITION_PART = /\([^()]*\)|\s+(and|or)\s+|\s*not\s+/gi;
const CONTAINER_UNITS: Record<string, string> = {
	vw: 'cqw',
	vh: 'cqh',
	vi: 'cqi',
	vb: 'cqb',
	vmin: 'cqmin',
	vmax: 'cqmax',
};
const VIEWPORT_UNIT_NAMES = Object.keys(CONTAINER_UNITS)
	.sort((left, right) => right.length - left.length)
	.join('|');
const STRING_COMMENT_OR_URL = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|url\(\s*[^)]*\))/gi;
const VIEWPORT_UNIT = new RegExp(`(?<![\\w.]|\\w-)(\\d*\\.?\\d+)[sld]?(${VIEWPORT_UNIT_NAMES})\\b`, 'gi');

/**
 * A Slide or a Canvas is laid out at a fixed size inside a window of any size, so the story's window-based rules
 * (width media queries, vw/vh) would reflow it. Once one is on the page, they are rebased on the frame instead.
 */
export function useFrameRelativeStoryStyles(): void {
	useLayoutEffect(() => {
		rebaseStoryStylesOnFrame();
	}, []);
}

export function rebaseStoryStylesOnFrame(): void {
	for (const style of document.querySelectorAll<HTMLStyleElement>(`style[${STORY_STYLE_ATTRIBUTE}]`)) {
		if (style.hasAttribute(REBASED_ATTRIBUTE)) {
			continue;
		}
		style.textContent = rebaseCssOnFrame(style.textContent ?? '');
		style.setAttribute(REBASED_ATTRIBUTE, '');
	}
}

export function rebaseCssOnFrame(css: string): string {
	return css
		.split(STRING_COMMENT_OR_URL)
		.map((part, index) => (index % 2 === 0 ? rebaseCssCode(part) : part))
		.join('');
}

function rebaseCssCode(code: string): string {
	return code
		.replace(MEDIA_RULE, (rule, condition: string) => {
			const frameCondition = condition.replace(MEDIA_TYPE_PREFIX, '').trim();
			return isFrameCondition(frameCondition) ? `@container ${STORY_FRAME_CONTAINER} ${frameCondition} {` : rule;
		})
		.replace(
			VIEWPORT_UNIT,
			(_length, value: string, unit: string) => `${value}${CONTAINER_UNITS[unit.toLowerCase()]}`,
		);
}

/** Only size features translate to container queries; print, colour scheme or comma lists stay media queries. */
function isFrameCondition(condition: string): boolean {
	if (!condition.startsWith('(') || condition.includes(',')) {
		return false;
	}
	const features = condition.match(/\([^()]*\)/g) ?? [];
	const leftover = condition.replace(CONDITION_PART, '').trim();
	return features.length > 0 && leftover === '' && features.every((feature) => FRAME_FEATURE.test(feature));
}

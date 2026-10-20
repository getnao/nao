import { z } from 'zod';

export const STORY_TEXT_ROLES = [
	'wordmark',
	'display',
	'heading',
	'subheading',
	'body',
	'label',
	'button',
	'figure',
] as const;
export type StoryTextRole = (typeof STORY_TEXT_ROLES)[number];

export const STORY_ROLE_FONTS = ['heading', 'body'] as const;
export const STORY_TEXT_CASES = ['none', 'uppercase', 'lowercase', 'capitalize'] as const;

export const ROLE_LIMITS = {
	weight: { min: 300, max: 800 },
	tracking: { min: -0.06, max: 0.3 },
	size: { min: 0.6, max: 2 },
} as const;

export const STORY_TEXT_ROLE_LABELS: Record<StoryTextRole, { label: string; description: string; sample: string }> = {
	wordmark: {
		label: 'Brand name',
		description: 'The brand name in the header, when there is no logo.',
		sample: 'Acme',
	},
	display: { label: 'Title', description: 'Story title.', sample: 'Revenue overview' },
	heading: { label: 'Heading', description: 'Section headings.', sample: 'What changed this quarter' },
	subheading: { label: 'Subheading', description: 'Chart, table and card titles.', sample: 'Revenue by region' },
	body: { label: 'Body', description: 'Paragraphs, lists and table cells.', sample: 'Every region grew.' },
	label: {
		label: 'Label',
		description: 'KPI names, legends, table headers, axis ticks.',
		sample: 'Total revenue',
	},
	button: { label: 'Button', description: 'Buttons, filter chips and tabs.', sample: 'All regions' },
	figure: { label: 'Figure', description: 'KPI values.', sample: '1,352,000' },
};

type RoleDefaults = {
	font: (typeof STORY_ROLE_FONTS)[number];
	weight: number;
	case: (typeof STORY_TEXT_CASES)[number];
	italic: boolean;
	tracking: number;
	size: number;
};

const ROLE_DEFAULTS: Record<StoryTextRole, RoleDefaults> = {
	wordmark: { font: 'heading', weight: 700, case: 'none', italic: false, tracking: 0, size: 1 },
	display: { font: 'heading', weight: 600, case: 'none', italic: false, tracking: -0.02, size: 1 },
	heading: { font: 'heading', weight: 600, case: 'none', italic: false, tracking: -0.02, size: 1 },
	subheading: { font: 'heading', weight: 600, case: 'none', italic: false, tracking: -0.01, size: 1 },
	body: { font: 'body', weight: 400, case: 'none', italic: false, tracking: 0, size: 1 },
	label: { font: 'body', weight: 400, case: 'none', italic: false, tracking: 0, size: 1 },
	button: { font: 'body', weight: 500, case: 'none', italic: false, tracking: 0, size: 1 },
	figure: { font: 'heading', weight: 500, case: 'none', italic: false, tracking: -0.02, size: 1 },
};

function textRoleSchema(defaults: RoleDefaults) {
	return z
		.object({
			font: z.enum(STORY_ROLE_FONTS).default(defaults.font),
			weight: z.number().int().min(ROLE_LIMITS.weight.min).max(ROLE_LIMITS.weight.max).default(defaults.weight),
			case: z.enum(STORY_TEXT_CASES).default(defaults.case),
			italic: z.boolean().default(defaults.italic),
			/** Letter spacing in em. */
			tracking: z.number().min(ROLE_LIMITS.tracking.min).max(ROLE_LIMITS.tracking.max).default(defaults.tracking),
			size: z.number().min(ROLE_LIMITS.size.min).max(ROLE_LIMITS.size.max).default(defaults.size),
		})
		.default(defaults);
}

export const storyTypographySchema = z.object({
	wordmark: textRoleSchema(ROLE_DEFAULTS.wordmark),
	display: textRoleSchema(ROLE_DEFAULTS.display),
	heading: textRoleSchema(ROLE_DEFAULTS.heading),
	subheading: textRoleSchema(ROLE_DEFAULTS.subheading),
	body: textRoleSchema(ROLE_DEFAULTS.body),
	label: textRoleSchema(ROLE_DEFAULTS.label),
	button: textRoleSchema(ROLE_DEFAULTS.button),
	figure: textRoleSchema(ROLE_DEFAULTS.figure),
});

export type StoryTypography = z.infer<typeof storyTypographySchema>;
export type StoryTextRoleStyle = StoryTypography[StoryTextRole];

export const DEFAULT_STORY_TYPOGRAPHY: StoryTypography = ROLE_DEFAULTS;

const legacyTextSchema = z.looseObject({
	headingTracking: z.number(),
	typography: z.never().optional(),
});

export function seedTypographyFromLegacy(raw: unknown): unknown {
	const legacy = legacyTextSchema.safeParse(raw);
	if (!legacy.success) {
		return raw;
	}
	const tracking = { tracking: legacy.data.headingTracking };
	return {
		...legacy.data,
		typography: { display: tracking, heading: tracking, subheading: tracking, figure: tracking },
	};
}

export function typographyCssVars(typography: StoryTypography): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const role of STORY_TEXT_ROLES) {
		const style = typography[role];
		vars[`--story-type-${role}-font`] = style.font === 'heading' ? 'var(--font-heading)' : 'var(--font-sans)';
		vars[`--story-type-${role}-weight`] = String(style.weight);
		vars[`--story-type-${role}-case`] = style.case;
		vars[`--story-type-${role}-style`] = style.italic ? 'italic' : 'normal';
		vars[`--story-type-${role}-tracking`] = `${style.tracking}em`;
		vars[`--story-type-${role}-size`] = String(style.size);
	}
	vars['--story-heading-tracking'] = `${typography.heading.tracking}em`;
	return vars;
}

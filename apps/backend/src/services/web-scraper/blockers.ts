import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';

import type { WebRobotLoadedSource, WebRobotSourceBlocker } from './types';

const CAPTCHA_PATTERN = /captcha|recaptcha|hcaptcha|turnstile/i;
const BOT_CHALLENGE_PATTERN =
	/cloudflare|cf-chl|challenge-platform|checking your browser|verify you are human|attention required|bot detection/i;
const CONSENT_PATTERN = /cookie consent|accept (all )?cookies|cookie preferences|privacy preferences|consent required/i;
const LOGIN_URL_PATTERN = /(login|log-in|signin|sign-in|auth|sso)/i;

export const detectLoadedSourceBlockers = (
	loaded: WebRobotLoadedSource,
	loader: 'http' | 'browser',
	hasCandidates: boolean,
	$?: CheerioAPI,
): WebRobotSourceBlocker[] => {
	const blockers = statusBlockers(loaded, loader);
	if (!loaded.bodyText?.includes('<')) {
		return blockers;
	}
	const dom = $ ?? cheerio.load(loaded.bodyText);
	return [...blockers, ...contentBlockers(loaded, loader, hasCandidates, dom)];
};

const statusBlockers = (loaded: WebRobotLoadedSource, loader: 'http' | 'browser'): WebRobotSourceBlocker[] => {
	if (loaded.status === 429) {
		return [blocker(loaded, loader, 'rate_limited', 'The source is rate limiting requests.')];
	}
	if (loaded.status === 401 || loaded.status === 403) {
		return [blocker(loaded, loader, 'access_denied', `The source denied access with HTTP ${loaded.status}.`)];
	}
	if (loaded.status >= 500) {
		return [blocker(loaded, loader, 'site_error', `The source returned HTTP ${loaded.status}.`)];
	}
	return [];
};

const contentBlockers = (
	loaded: WebRobotLoadedSource,
	loader: 'http' | 'browser',
	hasCandidates: boolean,
	$: CheerioAPI,
): WebRobotSourceBlocker[] => {
	const blockers: WebRobotSourceBlocker[] = [];
	const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
	const title = $('title').first().text().trim();
	const text = `${title} ${bodyText}`.slice(0, 50_000);

	const captcha = evidenceFor(text, CAPTCHA_PATTERN);
	if (captcha) {
		blockers.push(
			blocker(loaded, loader, 'captcha', 'The page appears to require a CAPTCHA or human verification.', captcha),
		);
	}

	const challenge = evidenceFor(text, BOT_CHALLENGE_PATTERN);
	if (challenge) {
		blockers.push(
			blocker(
				loaded,
				loader,
				'bot_challenge',
				'The page appears to be a bot-protection or browser challenge.',
				challenge,
			),
		);
	}

	if (hasPasswordForm($) || LOGIN_URL_PATTERN.test(new URL(loaded.finalUrl).pathname)) {
		blockers.push(
			blocker(
				loaded,
				loader,
				'login',
				'The source appears to require a sign-in before catalogue data is visible.',
			),
		);
	}

	const consent = evidenceFor(text, CONSENT_PATTERN);
	if (consent && hasConsentSurface($)) {
		blockers.push(
			blocker(loaded, loader, 'consent', 'The page appears to require cookie or privacy consent.', consent),
		);
	}

	if (!hasCandidates && bodyText.length < 80 && $('script').length > 0 && $('a[href]').length === 0) {
		blockers.push(
			blocker(
				loaded,
				loader,
				'empty_shell',
				'The page appears to render a client-side application shell without catalogue content.',
			),
		);
	}

	return blockers;
};

const blocker = (
	loaded: WebRobotLoadedSource,
	loader: 'http' | 'browser',
	kind: WebRobotSourceBlocker['kind'],
	message: string,
	evidence?: string,
): WebRobotSourceBlocker => ({
	kind,
	loader,
	message: `${loader === 'browser' ? 'Browser' : 'HTTP'} inspection: ${message}`,
	status: loaded.status || undefined,
	evidence,
});

const evidenceFor = (text: string, pattern: RegExp): string | undefined => {
	const match = pattern.exec(text);
	return match?.[0]?.slice(0, 120);
};

const hasPasswordForm = ($: CheerioAPI): boolean => {
	return $('input[type="password"]').length > 0;
};

const hasConsentSurface = ($: CheerioAPI): boolean => {
	return $('[id], [class], [role="dialog"], [aria-modal="true"]')
		.toArray()
		.some((element) => {
			const marker = `${$(element).attr('id') ?? ''} ${$(element).attr('class') ?? ''} ${$(element).attr('role') ?? ''}`;
			return /cookie|consent|privacy/i.test(marker);
		});
};

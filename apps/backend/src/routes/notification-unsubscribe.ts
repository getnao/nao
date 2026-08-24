import { NOTIFICATION_CHANNELS, type NotificationChannel } from '@nao/shared/types';
import { z } from 'zod/v4';

import type { App } from '../app';
import * as notificationUnsubscribeQueries from '../queries/notification-unsubscribe.queries';
import { getActiveBranding } from '../services/branding.service';
import { verifyUnsubscribeSignature } from '../services/notification-unsubscribe';

const unsubscribeSchema = z.object({ u: z.string(), s: z.string(), sig: z.string() });

const DEFAULT_APP_NAME = 'nao';
const DEFAULT_BRAND_COLOR = '#522bff';

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
	in_app: 'in-app',
	email: 'email',
	slack: 'Slack',
};

const CHANNEL_DELIVERY: Record<NotificationChannel, string> = {
	in_app: 'in the app',
	email: 'by email',
	slack: 'on Slack',
};

function channelFromScope(scope: string): NotificationChannel | null {
	const [channel] = scope.split(':');
	return (NOTIFICATION_CHANNELS as readonly string[]).includes(channel) ? (channel as NotificationChannel) : null;
}

interface Branding {
	appName: string;
	brandColor: string;
	logoUrl: string | null;
}

export const notificationUnsubscribeRoutes = async (app: App) => {
	app.get('/unsubscribe', { schema: { querystring: unsubscribeSchema } }, async (request, reply) => {
		const { u: userId, s: scope, sig } = request.query;
		const branding = await resolveBranding();

		if (!verifyUnsubscribeSignature(userId, scope, sig)) {
			return reply
				.code(400)
				.type('text/html')
				.send(renderResultPage(branding, 'This unsubscribe link is invalid or has expired.', false));
		}

		return reply.type('text/html').send(renderConfirmPage(branding, userId, scope, sig));
	});

	app.post('/unsubscribe', { schema: { body: unsubscribeSchema } }, async (request, reply) => {
		const { u: userId, s: scope, sig } = request.body;
		const branding = await resolveBranding();

		if (!verifyUnsubscribeSignature(userId, scope, sig)) {
			return reply
				.code(400)
				.type('text/html')
				.send(renderResultPage(branding, 'This unsubscribe link is invalid or has expired.', false));
		}

		await notificationUnsubscribeQueries.addUnsubscribe(userId, scope);
		return reply
			.type('text/html')
			.send(renderResultPage(branding, 'You have been unsubscribed from these notifications.', true));
	});
};

async function resolveBranding(): Promise<Branding> {
	const branding = await getActiveBranding();
	return {
		appName: branding?.appName ?? DEFAULT_APP_NAME,
		brandColor: branding?.brandColor ?? DEFAULT_BRAND_COLOR,
		logoUrl: branding?.logo ? `/branding/logo?v=${branding.updatedAt.getTime()}` : null,
	};
}

function renderConfirmPage(branding: Branding, userId: string, scope: string, sig: string): string {
	const channel = channelFromScope(scope);
	const title = channel
		? `Unsubscribe from ${CHANNEL_LABELS[channel]} notifications?`
		: 'Unsubscribe from notifications?';
	const description = channel
		? `You will stop receiving these notifications ${CHANNEL_DELIVERY[channel]}.`
		: 'You will stop receiving these notifications.';
	const card = `<div class="card">
			<h2 class="card-title">${escapeHtml(title)}</h2>
			<p class="card-desc">${escapeHtml(description)}</p>
			<form class="card-footer" method="post" action="/api/notifications/unsubscribe">
				<input type="hidden" name="u" value="${escapeHtml(userId)}" />
				<input type="hidden" name="s" value="${escapeHtml(scope)}" />
				<input type="hidden" name="sig" value="${escapeHtml(sig)}" />
				<button type="submit" class="btn-primary">Unsubscribe</button>
			</form>
		</div>`;
	return renderPage(branding, 'Unsubscribe', card);
}

function renderResultPage(branding: Branding, message: string, ok: boolean): string {
	const title = ok ? 'Unsubscribed' : 'Unsubscribe failed';
	const icon = ok ? CHECK_ICON : X_ICON;
	const iconClass = ok ? 'icon-ok' : 'icon-error';
	const result = `<div class="result">
			<span class="${iconClass}">${icon}</span>
			<div class="result-text">
				<h2>${escapeHtml(title)}</h2>
				<p>${escapeHtml(message)}</p>
			</div>
		</div>`;
	return renderPage(branding, title, result);
}

function renderPage(branding: Branding, title: string, body: string): string {
	const { appName, brandColor } = branding;
	const gradientEnd = lightenHex(brandColor, 15);
	const gradientHoverStart = lightenHex(brandColor, 8);
	const gradientHoverEnd = lightenHex(brandColor, 23);
	const brandMark = branding.logoUrl
		? `<img class="brand-logo" src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(appName)}" />`
		: DEFAULT_LOGO_SVG;

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(title)} — ${escapeHtml(appName)}</title>
		<style>
			:root {
				--brand: ${brandColor};
				--gradient-brand: linear-gradient(180deg, ${brandColor} 0%, ${gradientEnd} 100%);
				--gradient-brand-hover: linear-gradient(180deg, ${gradientHoverStart} 0%, ${gradientHoverEnd} 100%);
				--foreground: rgba(0, 0, 0, 0.85);
				--muted-foreground: rgba(0, 0, 0, 0.5);
				--border: rgba(0, 0, 0, 0.1);
			}
			* { box-sizing: border-box; }
			body {
				font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
				background: #fff;
				color: var(--foreground);
				margin: 0;
				min-height: 100vh;
				display: flex;
				align-items: center;
				justify-content: center;
				-webkit-font-smoothing: antialiased;
			}
			.container { width: 100%; max-width: 448px; padding: 32px; margin: auto; }
			.header {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 32px;
				margin-bottom: 40px;
				padding-bottom: 8px;
			}
			.header .brand-logo, .header svg { width: 80px; height: auto; display: block; }
			.header .brand-logo { max-height: 40px; width: auto; }
			.header h1 {
				font-family: 'Borna', 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
				font-size: 24px;
				font-weight: 500;
				text-align: center;
				margin: 0;
			}
			.card {
				background: #fff;
				border: 1px solid var(--border);
				border-radius: 10px;
				padding: 24px;
				box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
			}
			.card-title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
			.card-desc { font-size: 14px; color: var(--muted-foreground); line-height: 1.5; margin: 6px 0 0; }
			.card-footer { display: flex; justify-content: flex-end; margin: 24px 0 0; }
			.btn-primary {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				height: 36px;
				padding: 0 16px;
				border: 0;
				border-radius: 8px;
				font: inherit;
				font-size: 14px;
				font-weight: 500;
				color: #fff;
				background: var(--gradient-brand);
				cursor: pointer;
				transition: background 0.15s ease, transform 0.05s ease;
			}
			.btn-primary:hover { background: var(--gradient-brand-hover); }
			.btn-primary:active { transform: translateY(0.5px); }
			.result { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
			.result svg { width: 40px; height: 40px; }
			.icon-ok { color: var(--brand); }
			.icon-error { color: var(--muted-foreground); }
			.result-text { display: flex; flex-direction: column; gap: 8px; }
			.result h2 { font-size: 18px; font-weight: 600; margin: 0; }
			.result p { font-size: 14px; color: var(--muted-foreground); line-height: 1.5; margin: 0; }
		</style>
	</head>
	<body>
		<div class="container">
			<div class="header">
				${brandMark}
			</div>
			${body}
		</div>
	</body>
</html>`;
}

const DEFAULT_LOGO_SVG = `<svg viewBox="0 0 293 66" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="nao">
<path d="M64.3619 0V16.8954L55.9142 48.0853L47.4665 16.8954V0H64.3619Z" fill="#522bff"/>
<path d="M43.9762 59.4619L16.8954 64.9753H0V48.0853H16.8954L43.9762 59.4619Z" fill="#522bff"/>
<path d="M111.826 48.0853V64.9753H94.9418L67.8501 59.4619L94.9418 48.0853H111.826Z" fill="#522bff"/>
<path d="M47.4844 51.0305L11.0379 31.4631V14.5731H27.9279L47.4844 51.0305Z" fill="#522bff"/>
<path d="M100.799 14.5731V31.4631L64.3468 51.0305L83.9033 14.5731H100.799Z" fill="#522bff"/>
<path d="M163.426 13.8623C156.592 13.8623 151.135 16.6782 148.122 21.6648V14.6442H137.569V64.9911H148.122V37.7672C148.122 29.4672 153.448 23.4418 160.785 23.4418C167.363 23.4418 171.786 28.494 171.786 36.0066V64.9911H182.339V34.1476C182.339 22.0147 174.739 13.8623 163.426 13.8623Z" fill="currentColor"/>
<path d="M212.613 13.8623C200.825 13.8623 191.677 21.1836 190.863 31.2661L190.813 31.8457H200.699L200.726 31.3426C201.016 26.4162 206.107 22.556 212.313 22.556C219.339 22.556 223.707 26.2084 223.707 32.0917C223.707 34.0711 222.193 34.4921 220.919 34.4921H210.656C198.692 34.4921 190.961 40.7253 190.961 50.3758C190.961 60.0264 197.894 65.773 208.212 65.773C214.899 65.773 220.738 62.9844 223.707 58.5173V64.9911H234.26V32.6822C234.26 21.4296 225.561 13.8623 212.608 13.8623H212.613ZM223.713 42.2125V42.8522C223.713 51.8248 218.611 57.1777 210.071 57.1777C204.893 57.1777 201.415 54.3673 201.415 50.1845C201.415 45.34 205.39 42.2125 211.536 42.2125H223.713Z" fill="currentColor"/>
<path d="M267.261 13.8623C252.225 13.8623 241.306 24.7759 241.306 39.8176C241.306 54.8594 252.219 65.773 267.261 65.773C282.303 65.773 293.118 54.8594 293.118 39.8176C293.118 24.7759 282.243 13.8623 267.261 13.8623ZM267.261 56.3903C258.168 56.3903 252.055 49.7306 252.055 39.8176C252.055 29.9046 258.168 23.2449 267.261 23.2449C276.354 23.2449 282.368 30.0577 282.368 39.8176C282.368 49.5775 276.157 56.3903 267.261 56.3903Z" fill="currentColor"/>
</svg>`;

const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;

function lightenHex(hex: string, amount: number): string {
	const [h, s, l] = hexToHsl(hex);
	return hslToHex(h, s, clamp(l + amount, 0, 100));
}

function hexToHsl(hex: string): [number, number, number] {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) {
		return [0, 0, Math.round(l * 100)];
	}
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	switch (max) {
		case r:
			h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
			break;
		case g:
			h = ((b - r) / d + 2) / 6;
			break;
		case b:
			h = ((r - g) / d + 4) / 6;
			break;
	}
	return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
	const ls = l / 100;
	const ss = s / 100;
	const a = ss * Math.min(ls, 1 - ls);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = ls - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(Math.max(n, min), max);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

import type { EmailBranding } from '../../utils/email-branding';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';
import { emailColors } from './email-theme';

interface BudgetLimitReachedProps {
	userName: string;
	providerLabel: string;
	limitUsd: number;
	currentSpendUsd: number;
	period: string;
	resetLabel: string;
	unsubscribeUrl?: string;
	branding: EmailBranding;
}

export function BudgetLimitReached({
	userName,
	providerLabel,
	limitUsd,
	currentSpendUsd,
	period,
	resetLabel,
	unsubscribeUrl,
	branding,
}: BudgetLimitReachedProps) {
	return (
		<EmailLayout title={`Budget limit reached for ${providerLabel} on ${branding.appName}`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				The <strong>{providerLabel}</strong> budget limit for your {branding.appName} project has been reached.
				Chat requests using this provider are blocked until the budget resets {resetLabel}.
			</EmailParagraph>

			<EmailParagraph>
				Budget limit: <strong>${limitUsd.toFixed(2)}</strong> / {period}
				<br />
				Current spend: <strong>${currentSpendUsd.toFixed(2)}</strong>
			</EmailParagraph>

			<EmailParagraph>
				To unblock users, you can increase the budget limit in your project settings.
			</EmailParagraph>

			{unsubscribeUrl && (
				<EmailParagraph muted>
					<a href={unsubscribeUrl} style={{ color: emailColors.muted }}>
						Unsubscribe from budget alert emails
					</a>
				</EmailParagraph>
			)}
		</EmailLayout>
	);
}

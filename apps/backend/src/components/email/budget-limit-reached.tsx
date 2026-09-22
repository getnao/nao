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
}

export function BudgetLimitReached({
	userName,
	providerLabel,
	limitUsd,
	currentSpendUsd,
	period,
	resetLabel,
	unsubscribeUrl,
}: BudgetLimitReachedProps) {
	return (
		<EmailLayout title={`Budget limit reached for ${providerLabel} on nao`}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				The <strong>{providerLabel}</strong> budget limit for your nao project has been reached. Chat requests
				using this provider are blocked until the budget resets {resetLabel}.
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

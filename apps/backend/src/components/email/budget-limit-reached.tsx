import { EmailLayout } from './email-layout';
import { WarningBox } from './warning-box';

interface BudgetLimitReachedProps {
	userName: string;
	providerLabel: string;
	limitUsd: number;
	currentSpendUsd: number;
	period: string;
	resetLabel: string;
}

export function BudgetLimitReached({
	userName,
	providerLabel,
	limitUsd,
	currentSpendUsd,
	period,
	resetLabel,
}: BudgetLimitReachedProps) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				The <strong>{providerLabel}</strong> budget limit for your nao project has been reached. Chat requests
				using this provider are now blocked until the budget resets.
			</p>

			<div className='credentials'>
				<p>
					<strong>Budget limit:</strong> ${limitUsd.toFixed(2)} / {period}
				</p>
				<p>
					<strong>Current spend:</strong> ${currentSpendUsd.toFixed(2)}
				</p>
			</div>

			<WarningBox>
				New chat requests using {providerLabel} will be blocked until the budget resets {resetLabel}.
			</WarningBox>

			<p>To unblock users, you can increase the budget limit in your project settings.</p>

			<div className='footer'>
				<p>This is an automated message from nao.</p>
			</div>
		</EmailLayout>
	);
}

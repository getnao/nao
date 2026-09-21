import { getEmailDomain } from '../../utils/utils';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailCode, EmailParagraph } from './email-text';

interface UserAddedToProjectProps {
	userName: string;
	teamName?: string;
	teamLabel?: string;
	loginUrl: string;
	to: string;
	temporaryPassword?: string;
	invitedBy?: string;
}

export function UserAddedToProject({
	userName,
	teamName,
	teamLabel = 'project',
	loginUrl,
	to,
	temporaryPassword,
	invitedBy,
}: UserAddedToProjectProps) {
	const isNewUser = !!temporaryPassword;
	const inviterDomain = invitedBy ? getEmailDomain(invitedBy) : null;
	const recipientDomain = getEmailDomain(to);
	const isForeignInviter = !!inviterDomain && inviterDomain !== recipientDomain;

	return (
		<EmailLayout title={`You've been added to ${teamName} on nao`}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			{isForeignInviter && (
				<EmailParagraph>
					<strong>Please check that you recognize this inviter before continuing.</strong> The inviter's email
					domain, <strong>{inviterDomain}</strong>, does not match your domain,{' '}
					<strong>{recipientDomain}</strong>.
				</EmailParagraph>
			)}

			<EmailParagraph>
				{invitedBy ? (
					<>
						<strong>{invitedBy}</strong> {isNewUser ? 'invited you to join' : 'added you to'} the{' '}
						{teamLabel} <strong>{teamName}</strong> on nao.
					</>
				) : isNewUser ? (
					<>
						You've been invited to join the {teamLabel} <strong>{teamName}</strong> on nao.
					</>
				) : (
					<>
						You've been added to the {teamLabel} <strong>{teamName}</strong> on nao.
					</>
				)}
			</EmailParagraph>

			{isNewUser ? (
				<EmailParagraph>
					Log in with your email address <strong>{to}</strong> and the temporary password{' '}
					<EmailCode>{temporaryPassword}</EmailCode>. You will be asked to choose a new password the first
					time you log in.
				</EmailParagraph>
			) : (
				<EmailParagraph>You can access it right away with your existing nao account.</EmailParagraph>
			)}

			<EmailButton href={loginUrl}>{isNewUser ? 'Log in to nao' : 'Open nao'}</EmailButton>

			<EmailParagraph>
				If you have any questions{isNewUser ? '' : ` about this ${teamLabel}`}, please contact your {teamLabel}{' '}
				administrator.
			</EmailParagraph>
		</EmailLayout>
	);
}

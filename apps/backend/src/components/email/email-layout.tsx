import type { ReactNode } from 'react';

import { EMAIL_LOGO_CID, emailLogoAttachment } from '../../utils/email-logo';
import { emailColors, emailFonts, emailFontsUrl, emailText } from './email-theme';

interface EmailLayoutProps {
	title: string;
	children: ReactNode;
}

export function EmailLayout({ title, children }: EmailLayoutProps) {
	return (
		<html lang='en'>
			<head>
				<meta charSet='utf-8' />
				<meta name='viewport' content='width=device-width, initial-scale=1' />
				<meta name='color-scheme' content='light' />
				<meta name='supported-color-schemes' content='light' />
				<title>{title}</title>
				<link href={emailFontsUrl} rel='stylesheet' />
			</head>
			<body style={{ margin: 0, padding: 0, backgroundColor: '#ffffff', fontFamily: emailFonts.sans }}>
				<table role='presentation' width='100%' cellPadding={0} cellSpacing={0}>
					<tbody>
						<tr>
							<td align='center' style={{ padding: '40px 24px' }}>
								<table
									role='presentation'
									width='100%'
									cellPadding={0}
									cellSpacing={0}
									style={{ maxWidth: '560px' }}
								>
									<tbody>
										<tr>
											<td style={{ paddingBottom: '36px' }}>
												<EmailBrand />
											</td>
										</tr>
										<tr>
											<td>{children}</td>
										</tr>
										<tr>
											<td style={{ paddingTop: '28px' }}>
												<EmailFooter />
											</td>
										</tr>
									</tbody>
								</table>
							</td>
						</tr>
					</tbody>
				</table>
			</body>
		</html>
	);
}

function EmailBrand() {
	return (
		<table role='presentation' cellPadding={0} cellSpacing={0}>
			<tbody>
				<tr>
					{emailLogoAttachment && (
						<td style={{ paddingRight: '10px', verticalAlign: 'middle' }}>
							<img
								src={`cid:${EMAIL_LOGO_CID}`}
								alt=''
								width={32}
								height={32}
								style={{ display: 'block', width: '32px', height: '32px', borderRadius: '8px' }}
							/>
						</td>
					)}
					<td style={{ verticalAlign: 'middle' }}>
						<span
							style={{
								fontFamily: emailFonts.sans,
								fontSize: '22px',
								lineHeight: '32px',
								fontWeight: 600,
								letterSpacing: '-0.02em',
								color: emailColors.foreground,
							}}
						>
							nao
						</span>
					</td>
				</tr>
			</tbody>
		</table>
	);
}

function EmailFooter() {
	return (
		<p style={{ ...emailText.muted, margin: 0 }}>
			This is an automated message from{' '}
			<a href='https://getnao.io' style={{ color: emailColors.muted }}>
				nao
			</a>
			, the open-source analytics agent.
		</p>
	);
}

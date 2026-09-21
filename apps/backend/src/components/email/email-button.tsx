import type { ReactNode } from 'react';

import { emailColors, emailFonts } from './email-theme';

interface EmailButtonProps {
	href: string;
	children: ReactNode;
}

export function EmailButton({ href, children }: EmailButtonProps) {
	return (
		<table role='presentation' cellPadding={0} cellSpacing={0} style={{ margin: '4px 0 24px' }}>
			<tbody>
				<tr>
					<td style={{ borderRadius: '6px', backgroundColor: emailColors.brand }}>
						<a
							href={href}
							style={{
								display: 'inline-block',
								padding: '12px 22px',
								fontFamily: emailFonts.sans,
								fontSize: '15px',
								lineHeight: '20px',
								fontWeight: 500,
								color: '#ffffff',
								textDecoration: 'none',
								borderRadius: '6px',
							}}
						>
							{children}
						</a>
					</td>
				</tr>
			</tbody>
		</table>
	);
}

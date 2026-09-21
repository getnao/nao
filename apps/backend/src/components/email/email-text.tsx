import type { ReactNode } from 'react';

import { emailColors, emailFonts, emailText } from './email-theme';

export function EmailParagraph({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
	return <p style={muted ? emailText.muted : emailText.body}>{children}</p>;
}

export function EmailCode({ children }: { children: ReactNode }) {
	return (
		<span
			style={{
				fontFamily: emailFonts.mono,
				fontSize: '15px',
				fontWeight: 600,
				letterSpacing: '0.04em',
				color: emailColors.foreground,
			}}
		>
			{children}
		</span>
	);
}

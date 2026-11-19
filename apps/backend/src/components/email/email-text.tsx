import type { CSSProperties, ReactNode } from 'react';

import type { NotificationTable } from '../../types/notification';
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

export function EmailTable({ table }: { table: NotificationTable }) {
	return (
		<table style={{ width: '100%', margin: '0 0 24px', borderCollapse: 'collapse' }}>
			<thead>
				<tr>
					{table.headers.map((header) => (
						<th key={header} style={{ ...tableCellStyle, fontWeight: 600 }}>
							{header}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{table.rows.map((row, rowIndex) => (
					<tr key={rowIndex}>
						{row.map((cell, cellIndex) => (
							<td key={cellIndex} style={tableCellStyle}>
								{cell}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

const tableCellStyle: CSSProperties = {
	padding: '6px 8px',
	borderBottom: '1px solid #e5e7eb',
	textAlign: 'left',
	verticalAlign: 'top',
	fontFamily: emailFonts.sans,
	fontSize: '13px',
	lineHeight: '18px',
	color: emailColors.foreground,
};

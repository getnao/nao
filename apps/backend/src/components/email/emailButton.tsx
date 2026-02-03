import type { ReactNode } from 'react';

interface EmailButtonProps {
	href: string;
	children: ReactNode;
}

export function EmailButton({ href, children }: EmailButtonProps) {
	return (
		<div style={{ textAlign: 'center' }}>
			<a href={href} className='button'>
				{children}
			</a>
		</div>
	);
}

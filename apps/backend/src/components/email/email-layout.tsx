import type { ReactNode } from 'react';

const emailStyles = `
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
.credentials { background-color: #fff; padding: 20px; margin: 20px 0; border-left: 4px solid #4F46E5; border-radius: 4px; }
.info-box { background-color: #fff; padding: 20px; margin: 20px 0; border-left: 4px solid #6B7280; border-radius: 4px; }
.password { font-family: monospace; font-size: 18px; font-weight: bold; color: #4F46E5; letter-spacing: 2px; }
.button { display: inline-block; padding: 12px 30px; background-color: #4F46E5; color: white !important; text-decoration: none; border-radius: 6px; margin: 20px 0; }
.warning { background-color: #FEF3C7; padding: 15px; margin: 20px 0; border-left: 4px solid #F59E0B; border-radius: 4px; }
.footer { text-align: center; margin-top: 30px; color: #6B7280; font-size: 14px; }
`;

export function EmailLayout({ children }: { children: ReactNode }) {
	return (
		<html>
			<head>
				<style>{emailStyles}</style>
			</head>
			<body>
				<div className='container'>
					<div className='content'>{children}</div>
				</div>
			</body>
		</html>
	);
}

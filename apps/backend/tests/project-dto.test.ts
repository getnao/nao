import { describe, expect, it } from 'vitest';

import { toCurrentProjectDto } from '../src/utils/project-dto';

describe('current project DTO', () => {
	it('returns only fields used by frontend callers', () => {
		const project = {
			id: 'project-1',
			name: 'Finance',
			path: '/srv/nao/finance',
			envVars: { DATABASE_PASSWORD: 'secret' },
			slackSettings: { botToken: 'secret' },
		};

		expect(toCurrentProjectDto(project, 'viewer')).toEqual({
			id: 'project-1',
			name: 'Finance',
			path: '/srv/nao/finance',
			userRole: 'viewer',
		});
	});
});

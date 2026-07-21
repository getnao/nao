import type { UserRole } from '@nao/shared/types';

import type { DBProject } from '../db/abstractSchema';

export interface CurrentProjectDto {
	id: string;
	name: string;
	path: string | null;
	userRole: UserRole | null;
}

export function toCurrentProjectDto(
	project: Pick<DBProject, 'id' | 'name' | 'path'>,
	userRole: UserRole | null,
): CurrentProjectDto {
	return {
		id: project.id,
		name: project.name,
		path: project.path,
		userRole,
	};
}

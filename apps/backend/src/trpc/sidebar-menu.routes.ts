/* @license Enterprise */

import { sidebarMenuSchema } from '@nao/shared/sidebar-menu';
import { TRPCError } from '@trpc/server';

import {
	getProjectSidebarMenu,
	isSidebarMenuCustomizable,
	saveProjectSidebarMenu,
} from '../services/sidebar-menu.service';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const sidebarMenuRoutes = {
	get: projectProtectedProcedure.query(({ ctx }) => getProjectSidebarMenu(ctx.project.id)),

	update: adminProtectedProcedure.input(sidebarMenuSchema).mutation(async ({ ctx, input }) => {
		await assertCanCustomizeSidebarMenu(ctx.project.id);
		await saveProjectSidebarMenu(ctx.project.id, input);
		return { ok: true };
	}),

	reset: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await assertCanCustomizeSidebarMenu(ctx.project.id);
		await saveProjectSidebarMenu(ctx.project.id, null);
		return { ok: true };
	}),
};

async function assertCanCustomizeSidebarMenu(projectId: string) {
	if (!(await isSidebarMenuCustomizable(projectId))) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Customizing the sidebar menu requires the Enterprise white-label feature.',
		});
	}
}

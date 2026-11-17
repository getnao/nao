import { useState } from 'react';

import type { UserSections } from '@/lib/user-sections-pagination';
import { countUsers, paginateUserSections } from '@/lib/user-sections-pagination';

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

export interface UserSectionsPagination {
	isVisible: boolean;
	totalRows: number;
	pageIndex: number;
	pageSize: number;
	pageCount: number;
	pageSizeOptions: number[];
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
}

/** Pagination only shows once the unfiltered list outgrows the smallest page, so it doesn't flicker while filtering. */
export function usePaginatedUserSections<User>(
	sections: UserSections<User>,
	totalUserCount: number,
): { page: UserSections<User>; goToFirstPage: () => void; pagination: UserSectionsPagination } {
	const [requestedPageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSizeValue] = useState(DEFAULT_PAGE_SIZE);

	const userCount = countUsers(sections);
	const pageCount = Math.ceil(userCount / pageSize);
	const pageIndex = Math.max(0, Math.min(requestedPageIndex, pageCount - 1));

	const setPageSize = (size: number) => {
		setPageSizeValue(size);
		setPageIndex(0);
	};

	return {
		page: paginateUserSections(sections, pageIndex, pageSize),
		goToFirstPage: () => setPageIndex(0),
		pagination: {
			isVisible: totalUserCount > PAGE_SIZE_OPTIONS[0],
			totalRows: userCount,
			pageIndex,
			pageSize,
			pageCount,
			pageSizeOptions: PAGE_SIZE_OPTIONS,
			onPageChange: setPageIndex,
			onPageSizeChange: setPageSize,
		},
	};
}

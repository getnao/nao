import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserWithRole } from '../../../backend/src/types/project';

interface UserPageContextType {
	userInfo: Partial<UserWithRole>;
	setUserInfo: (userInfo: Partial<UserWithRole>) => void;
	isModifyUserFormOpen: boolean;
	setIsModifyUserFormOpen: (isOpen: boolean) => void;
	isAddUserFormOpen: boolean;
	setIsAddUserFormOpen: (isOpen: boolean) => void;
	isResetUserPasswordOpen: boolean;
	setIsResetUserPasswordOpen: (isOpen: boolean) => void;
	isRemoveUserFromProjectOpen: boolean;
	setIsRemoveUserFromProjectOpen: (isOpen: boolean) => void;
	isNewUserDialogOpen: boolean;
	setIsNewUserDialogOpen: (isOpen: boolean) => void;
	newUser: { email: string; password: string } | null;
	setNewUser: (newUser: { email: string; password: string } | null) => void;
	error: string;
	setError: (error: string) => void;
}

const UserPageContext = createContext<UserPageContextType | undefined>(undefined);

export function UserPageProvider({ children }: { children: ReactNode }) {
	const [userInfo, setUserInfo] = useState<Partial<UserWithRole>>({
		id: '',
		role: 'user',
		name: '',
		email: '',
	});
	const [isModifyUserFormOpen, setIsModifyUserFormOpen] = useState(false);
	const [isAddUserFormOpen, setIsAddUserFormOpen] = useState(false);
	const [isResetUserPasswordOpen, setIsResetUserPasswordOpen] = useState(false);
	const [isRemoveUserFromProjectOpen, setIsRemoveUserFromProjectOpen] = useState(false);
	const [newUser, setNewUser] = useState<{ email: string; password: string } | null>(null);
	const [isNewUserDialogOpen, setIsNewUserDialogOpen] = useState(false);
	const [error, setError] = useState('');

	return (
		<UserPageContext.Provider
			value={{
				userInfo,
				setUserInfo,
				isModifyUserFormOpen,
				setIsModifyUserFormOpen,
				isAddUserFormOpen,
				setIsAddUserFormOpen,
				isResetUserPasswordOpen,
				setIsResetUserPasswordOpen,
				isRemoveUserFromProjectOpen,
				setIsRemoveUserFromProjectOpen,
				newUser,
				setNewUser,
				isNewUserDialogOpen,
				setIsNewUserDialogOpen,
				error,
				setError,
			}}
		>
			{children}
		</UserPageContext.Provider>
	);
}

export function useUserPageContext() {
	const context = useContext(UserPageContext);
	if (context === undefined) {
		throw new Error('useUserPageContext must be used within a UserPageProvider');
	}
	return context;
}

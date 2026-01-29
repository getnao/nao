import * as yup from 'yup';

export const USER_VALIDATION_SCHEMA = yup.object({
	name: yup.string().required('Name is required').min(2, 'Name must be at least 2 characters'),
	email: yup.string().required('Email is required').email('Enter a valid email address'),
});

export const USER_FORM_INITIAL_VALUES = {
	name: '',
	email: '',
};

export const CREATE_USER_TEXT = {
	TITLE: 'Create User',
	EMAIL_PLACEHOLDER: 'Enter the email address',
	NAME_PLACEHOLDER: 'Enter the name',
};

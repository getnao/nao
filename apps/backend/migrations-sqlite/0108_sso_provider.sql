CREATE TABLE `sso_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`domain_verified` integer DEFAULT false NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`user_id` text,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_provider_id_unique` ON `sso_provider` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_organization_id_unique` ON `sso_provider` (`organization_id`);
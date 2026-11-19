CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "sso_provider_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
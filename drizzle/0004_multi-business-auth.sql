CREATE TABLE `auth_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`locked_until` integer,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `business_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`invited_by_user_id` integer,
	`joined_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`deactivated_at` integer,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_members_business_user_unique` ON `business_members` (`business_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `business_members_user_active_idx` ON `business_members` (`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `business_members_business_role_active_idx` ON `business_members` (`business_id`,`role`,`is_active`);--> statement-breakpoint
CREATE TABLE `invitation_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`code_hash` text NOT NULL,
	`created_by_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`redeemed_by_user_id` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_codes_code_hash_unique` ON `invitation_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `invitation_codes_business_expiry_idx` ON `invitation_codes` (`business_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `purchase_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`purchase_id` integer NOT NULL,
	`purchase_version` integer NOT NULL,
	`action` text NOT NULL,
	`actor_user_id` integer NOT NULL,
	`occurred_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchase_audit_business_purchase_idx` ON `purchase_audit_events` (`business_id`,`purchase_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `purchase_audit_actor_idx` ON `purchase_audit_events` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`business_id` integer,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_active_idx` ON `sessions` (`user_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_business_active_idx` ON `sessions` (`business_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_iterations` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `currency_code` text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `time_zone` text DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `branding_json` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `created_by_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `purchases` ADD `updated_by_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `purchases` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `business_seed_default_categories`
AFTER INSERT ON `businesses`
FOR EACH ROW
BEGIN
	INSERT INTO `categories` (`business_id`, `name`, `is_active`, `created_at`, `updated_at`)
	VALUES
		(NEW.`id`, 'Fruits', 1, NEW.`created_at`, NEW.`updated_at`),
		(NEW.`id`, 'Dairy', 1, NEW.`created_at`, NEW.`updated_at`),
		(NEW.`id`, 'Ingredients', 1, NEW.`created_at`, NEW.`updated_at`),
		(NEW.`id`, 'Packaging', 1, NEW.`created_at`, NEW.`updated_at`),
		(NEW.`id`, 'Consumables', 1, NEW.`created_at`, NEW.`updated_at`),
		(NEW.`id`, 'Other', 1, NEW.`created_at`, NEW.`updated_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_audit_created`
AFTER INSERT ON `purchases`
WHEN NEW.`created_by_user_id` IS NOT NULL
BEGIN
	INSERT INTO `purchase_audit_events`
		(`business_id`, `purchase_id`, `purchase_version`, `action`, `actor_user_id`, `occurred_at`)
	VALUES
		(NEW.`business_id`, NEW.`id`, NEW.`version`, 'created', NEW.`created_by_user_id`, NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_audit_updated`
AFTER UPDATE OF `version` ON `purchases`
WHEN NEW.`version` > OLD.`version` AND NEW.`updated_by_user_id` IS NOT NULL
BEGIN
	INSERT INTO `purchase_audit_events`
		(`business_id`, `purchase_id`, `purchase_version`, `action`, `actor_user_id`, `occurred_at`)
	VALUES
		(NEW.`business_id`, NEW.`id`, NEW.`version`, 'updated', NEW.`updated_by_user_id`, NEW.`updated_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_audit_deleted`
AFTER DELETE ON `purchases`
WHEN OLD.`updated_by_user_id` IS NOT NULL
BEGIN
	INSERT INTO `purchase_audit_events`
		(`business_id`, `purchase_id`, `purchase_version`, `action`, `actor_user_id`, `occurred_at`)
	VALUES
		(OLD.`business_id`, OLD.`id`, OLD.`version`, 'deleted', OLD.`updated_by_user_id`, OLD.`updated_at`);
END;
DROP TRIGGER `purchase_audit_created`;--> statement-breakpoint
DROP TRIGGER `purchase_audit_updated`;--> statement-breakpoint
DROP TRIGGER `purchase_audit_deleted`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`purchase_id` integer NOT NULL,
	`purchase_version` integer NOT NULL,
	`action` text NOT NULL,
	`actor_user_id` integer,
	`occurred_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_audit_events`("id", "business_id", "purchase_id", "purchase_version", "action", "actor_user_id", "occurred_at") SELECT "id", "business_id", "purchase_id", "purchase_version", "action", "actor_user_id", "occurred_at" FROM `purchase_audit_events`;--> statement-breakpoint
DROP TABLE `purchase_audit_events`;--> statement-breakpoint
ALTER TABLE `__new_purchase_audit_events` RENAME TO `purchase_audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `purchase_audit_business_purchase_idx` ON `purchase_audit_events` (`business_id`,`purchase_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `purchase_audit_actor_idx` ON `purchase_audit_events` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
INSERT INTO `purchase_audit_events`
	(`business_id`, `purchase_id`, `purchase_version`, `action`, `actor_user_id`, `occurred_at`)
SELECT `business_id`, `id`, `version`, 'legacy_baseline', NULL,
       (strftime('%s','now') * 1000)
FROM `purchases`
WHERE `created_by_user_id` IS NULL;--> statement-breakpoint
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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`business_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`item_name_snapshot` text NOT NULL,
	`category_name_snapshot` text NOT NULL,
	`quantity` real,
	`unit` text,
	`amount_paise` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_items`("id", "purchase_id", "business_id", "item_id", "category_id", "item_name_snapshot", "category_name_snapshot", "quantity", "unit", "amount_paise", "created_at") SELECT "id", "purchase_id", "business_id", "item_id", "category_id", "item_name_snapshot", "category_name_snapshot", "quantity", "unit", "amount_paise", "created_at" FROM `purchase_items`;--> statement-breakpoint
DROP TABLE `purchase_items`;--> statement-breakpoint
ALTER TABLE `__new_purchase_items` RENAME TO `purchase_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `purchase_items_purchase_idx` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_business_idx` ON `purchase_items` (`business_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_item_idx` ON `purchase_items` (`item_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_category_idx` ON `purchase_items` (`category_id`);
--> statement-breakpoint
CREATE TRIGGER `purchase_amount_insert`
BEFORE INSERT ON `purchases`
FOR EACH ROW
WHEN NEW.`total_amount_paise` <= 0
BEGIN
	SELECT RAISE(ABORT, 'purchase amount must be greater than zero');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_amount_update`
BEFORE UPDATE OF `total_amount_paise` ON `purchases`
FOR EACH ROW
WHEN NEW.`total_amount_paise` <= 0
BEGIN
	SELECT RAISE(ABORT, 'purchase amount must be greater than zero');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_items_same_business_insert`
BEFORE INSERT ON `purchase_items`
FOR EACH ROW
WHEN NEW.`amount_paise` <= 0
  OR NEW.`item_name_snapshot` = ''
  OR NEW.`category_name_snapshot` = ''
  OR NEW.`quantity` IS NOT NULL AND NEW.`quantity` <= 0
  OR NOT EXISTS (
	SELECT 1 FROM `purchases`
	WHERE `id` = NEW.`purchase_id`
	  AND `business_id` = NEW.`business_id`
  )
  OR NOT EXISTS (
	SELECT 1 FROM `items`
	WHERE `id` = NEW.`item_id`
	  AND `business_id` = NEW.`business_id`
  )
  OR NOT EXISTS (
	SELECT 1 FROM `categories`
	WHERE `id` = NEW.`category_id`
	  AND `business_id` = NEW.`business_id`
  )
BEGIN
	SELECT RAISE(ABORT, 'invalid purchase item');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_items_same_business_update`
BEFORE UPDATE ON `purchase_items`
FOR EACH ROW
WHEN NEW.`amount_paise` <= 0
  OR NEW.`item_name_snapshot` = ''
  OR NEW.`category_name_snapshot` = ''
  OR NEW.`quantity` IS NOT NULL AND NEW.`quantity` <= 0
  OR NOT EXISTS (
	SELECT 1 FROM `purchases`
	WHERE `id` = NEW.`purchase_id`
	  AND `business_id` = NEW.`business_id`
  )
  OR NOT EXISTS (
	SELECT 1 FROM `items`
	WHERE `id` = NEW.`item_id`
	  AND `business_id` = NEW.`business_id`
  )
  OR NOT EXISTS (
	SELECT 1 FROM `categories`
	WHERE `id` = NEW.`category_id`
	  AND `business_id` = NEW.`business_id`
  )
BEGIN
	SELECT RAISE(ABORT, 'invalid purchase item');
END;
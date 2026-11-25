CREATE TABLE `businesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_business_name_unique` ON `categories` (`business_id`,`name`);--> statement-breakpoint
CREATE INDEX `categories_business_active_idx` ON `categories` (`business_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`default_unit` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_business_category_name_unique` ON `items` (`business_id`,`category_id`,`name`);--> statement-breakpoint
CREATE INDEX `items_business_active_idx` ON `items` (`business_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `items` (`category_id`);--> statement-breakpoint
CREATE INDEX `items_name_idx` ON `items` (`name`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`business_id` integer NOT NULL,
	`item_id` integer,
	`category_id` integer,
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
CREATE INDEX `purchase_items_purchase_idx` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_business_idx` ON `purchase_items` (`business_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_item_idx` ON `purchase_items` (`item_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_category_idx` ON `purchase_items` (`category_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`purchase_date` text NOT NULL,
	`supplier_name` text,
	`notes` text,
	`total_amount_paise` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchases_business_date_idx` ON `purchases` (`business_id`,`purchase_date`);--> statement-breakpoint
CREATE INDEX `purchases_business_created_idx` ON `purchases` (`business_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `businesses` (`name`) VALUES ('Co Cane Cabana');
--> statement-breakpoint
INSERT INTO `categories` (`business_id`, `name`, `is_active`) VALUES
	((SELECT `id` FROM `businesses` WHERE `name` = 'Co Cane Cabana'), 'Fruits', 1),
	((SELECT `id` FROM `businesses` WHERE `name` = 'Co Cane Cabana'), 'Dairy', 1),
	((SELECT `id` FROM `businesses` WHERE `name` = 'Co Cane Cabana'), 'Ingredients', 1),
	((SELECT `id` FROM `businesses` WHERE `name` = 'Co Cane Cabana'), 'Packaging', 1),
	((SELECT `id` FROM `businesses` WHERE `name` = 'Co Cane Cabana'), 'Consumables', 1),
	((SELECT `id` FROM `businesses` WHERE `name` = 'Co Cane Cabana'), 'Other', 1);
--> statement-breakpoint
CREATE TRIGGER `items_same_business_insert`
BEFORE INSERT ON `items`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `categories`
	WHERE `id` = NEW.`category_id`
	  AND `business_id` = NEW.`business_id`
	  AND `is_active` = 1
)
BEGIN
	SELECT RAISE(ABORT, 'item category must belong to the same business');
END;
--> statement-breakpoint
CREATE TRIGGER `items_same_business_update`
BEFORE UPDATE OF `business_id`, `category_id` ON `items`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `categories`
	WHERE `id` = NEW.`category_id`
	  AND `business_id` = NEW.`business_id`
	  AND `is_active` = 1
)
BEGIN
	SELECT RAISE(ABORT, 'item category must belong to the same business');
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
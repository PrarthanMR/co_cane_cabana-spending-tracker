import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const appMetadata = sqliteTable('app_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const businesses = sqliteTable('businesses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
}, (table) => [
  uniqueIndex('categories_business_name_unique').on(table.businessId, table.name),
  index('categories_business_active_idx').on(table.businessId, table.isActive),
])

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  defaultUnit: text('default_unit'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
}, (table) => [
  uniqueIndex('items_business_category_name_unique').on(table.businessId, table.categoryId, table.name),
  index('items_business_active_idx').on(table.businessId, table.isActive),
  index('items_category_idx').on(table.categoryId),
  index('items_name_idx').on(table.name),
])

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  purchaseDate: text('purchase_date').notNull(),
  supplierName: text('supplier_name'),
  notes: text('notes'),
  totalAmountPaise: integer('total_amount_paise').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (table) => [
  index('purchases_business_date_idx').on(table.businessId, table.purchaseDate),
  index('purchases_business_created_idx').on(table.businessId, table.createdAt),
])

export const purchaseItems = sqliteTable('purchase_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  purchaseId: integer('purchase_id').notNull().references(() => purchases.id),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  itemId: integer('item_id').notNull().references(() => items.id),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  itemNameSnapshot: text('item_name_snapshot').notNull(),
  categoryNameSnapshot: text('category_name_snapshot').notNull(),
  quantity: real('quantity'),
  unit: text('unit'),
  amountPaise: integer('amount_paise').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(strftime('%s','now') * 1000)`),
}, (table) => [
  index('purchase_items_purchase_idx').on(table.purchaseId),
  index('purchase_items_business_idx').on(table.businessId),
  index('purchase_items_item_idx').on(table.itemId),
  index('purchase_items_category_idx').on(table.categoryId),
])

import type { z } from 'zod'
import type { createPurchaseSchema } from '../schemas/purchase'

type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>

interface PurchaseItemRow {
  id: number
  businessId: number
  categoryId: number
  categoryName: string
  itemName: string
  isActive: number
}

export interface PurchaseDetail {
  id: number
  businessId: number
  purchaseDate: string
  supplierName: string | null
  notes: string | null
  totalAmountPaise: number
  items: Array<{
    id: number
    itemId: number
    categoryId: number
    itemNameSnapshot: string
    categoryNameSnapshot: string
    quantity: number | null
    unit: string | null
    amountPaise: number
  }>
  createdAt: number
  updatedAt: number
  createdBy: string | null
  updatedBy: string | null
}

export class PurchaseRepository {
  constructor(private readonly db: D1Database) {}

  async resolveItems(input: CreatePurchaseInput, businessId: number) {
    const rows: Array<PurchaseItemRow | null> = []
    for (const purchaseItem of input.items) {
      if (purchaseItem.itemId !== undefined) {
        const row = await this.db
          .prepare(
            `SELECT i.id, i.business_id AS businessId, i.category_id AS categoryId,
                    c.name AS categoryName, i.name AS itemName, i.is_active AS isActive
             FROM items i
             JOIN categories c ON c.id = i.category_id
             WHERE i.id = ? AND i.business_id = ? AND c.business_id = ?`,
          )
          .bind(purchaseItem.itemId, businessId, businessId)
          .first<PurchaseItemRow>()
        if (!row || !row.isActive) {
          throw new Error(`Item ${purchaseItem.itemId} is invalid or inactive for this business`)
        }
        rows.push(row)
      } else {
        const newItem = purchaseItem.newItem
        if (!newItem) {
          throw new Error('Item details are required')
        }
        const category = await this.db
          .prepare(
            `SELECT id, name FROM categories
             WHERE id = ? AND business_id = ? AND is_active = 1`,
          )
          .bind(newItem.categoryId, businessId)
          .first<{ id: number; name: string }>()
        if (!category) {
          throw new Error('Category does not belong to this business')
        }
        rows.push({
          id: 0,
          businessId,
          categoryId: category.id,
          categoryName: category.name,
          itemName: newItem.name,
          isActive: 1,
        })
      }
    }
    return rows
  }

  async createPurchase(input: CreatePurchaseInput, businessId: number, actor = 'owner') {
    if (input.items.length === 0) {
      throw new Error('A purchase must contain at least one item')
    }
    const itemRows = await this.resolveItems(input, businessId)
    const totalAmountPaise = input.items.reduce((total, item) => total + item.amountPaise, 0)
    const now = Date.now()
    const statements: D1PreparedStatement[] = []
    let newItemCount = 0

    for (let index = 0; index < input.items.length; index += 1) {
      const purchaseItem = input.items[index]
      const row = itemRows[index]
      if (purchaseItem.newItem && row) {
        newItemCount += 1
        statements.push(
          this.db.prepare(
            `INSERT INTO items
             (business_id, category_id, name, default_unit, is_active, created_at, updated_at)
             SELECT ?, ?, ?, ?, 1, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM items
               WHERE business_id = ? AND category_id = ? AND name = ? COLLATE NOCASE
             )`,
          ).bind(
            businessId,
            row.categoryId,
            row.itemName,
            purchaseItem.newItem.defaultUnit ?? null,
            now,
            now,
            businessId,
            row.categoryId,
            row.itemName,
          ),
        )
      }
    }

    statements.push(
      this.db.prepare(
        `INSERT INTO purchases
         (business_id, purchase_date, supplier_name, notes, total_amount_paise, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        businessId,
        input.purchaseDate,
        input.supplierName ?? null,
        input.notes ?? null,
        totalAmountPaise,
        now,
        now,
        actor,
        actor,
      ),
    )

    for (let index = 0; index < input.items.length; index += 1) {
      const purchaseItem = input.items[index]
      const row = itemRows[index]
      if (!row) continue
      if (purchaseItem.itemId !== undefined) {
        statements.push(
          this.db.prepare(
            `INSERT INTO purchase_items
             (purchase_id, business_id, item_id, category_id,
              item_name_snapshot, category_name_snapshot, quantity, unit, amount_paise, created_at)
             VALUES (last_insert_rowid(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            businessId,
            row.id,
            row.categoryId,
            row.itemName,
            row.categoryName,
            purchaseItem.quantity ?? null,
            purchaseItem.unit ?? null,
            purchaseItem.amountPaise,
            now,
          ),
        )
      } else {
        statements.push(
          this.db.prepare(
            `INSERT INTO purchase_items
             (purchase_id, business_id, item_id, category_id,
              item_name_snapshot, category_name_snapshot, quantity, unit, amount_paise, created_at)
             VALUES (
               last_insert_rowid(), ?, 
               (SELECT id FROM items WHERE business_id = ? AND category_id = ? AND name = ? COLLATE NOCASE),
               ?, ?, ?, ?, ?, ?, ?
             )`,
          ).bind(
            businessId,
            businessId,
            row.categoryId,
            row.itemName,
            row.categoryId,
            row.itemName,
            row.categoryName,
            purchaseItem.quantity ?? null,
            purchaseItem.unit ?? null,
            purchaseItem.amountPaise,
            now,
          ),
        )
      }
    }

    const results = await this.db.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error('Purchase could not be created')
    }
    const purchaseId = Number(results[newItemCount]?.meta?.last_row_id)
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      throw new Error('Purchase could not be identified')
    }
    return purchaseId
  }

  async list(businessId: number, filters: {
    itemName?: string
    from?: string
    to?: string
    categoryId?: number
  }) {
    const conditions = ['p.business_id = ?']
    const bindings: Array<string | number> = [businessId]
    if (filters.itemName) {
      conditions.push(`EXISTS (
        SELECT 1 FROM purchase_items pi_search
        WHERE pi_search.purchase_id = p.id
          AND pi_search.item_name_snapshot LIKE ?
      )`)
      bindings.push(`%${filters.itemName}%`)
    }
    if (filters.from) {
      conditions.push('p.purchase_date >= ?')
      bindings.push(filters.from)
    }
    if (filters.to) {
      conditions.push('p.purchase_date <= ?')
      bindings.push(filters.to)
    }
    if (filters.categoryId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM purchase_items pi_category
        WHERE pi_category.purchase_id = p.id
          AND pi_category.category_id = ?
      )`)
      bindings.push(filters.categoryId)
    }

    const headerResult = await this.db
      .prepare(
        `SELECT id, purchase_date AS purchaseDate, supplier_name AS supplierName,
                notes, total_amount_paise AS totalAmountPaise
         FROM purchases p
         WHERE ${conditions.join(' AND ')}
         ORDER BY purchase_date DESC, id DESC`,
      )
      .bind(...bindings)
      .all()

    return (headerResult.results ?? []).map((row) => ({
      id: Number(row.id),
      businessId,
      purchaseDate: String(row.purchaseDate),
      supplierName: row.supplierName ? String(row.supplierName) : null,
      notes: row.notes ? String(row.notes) : null,
      totalAmountPaise: Number(row.totalAmountPaise),
    }))
  }

  async getById(purchaseId: number, businessId: number): Promise<PurchaseDetail | null> {
    const header = await this.db
      .prepare(
        `SELECT id, business_id AS businessId, purchase_date AS purchaseDate,
                supplier_name AS supplierName, notes,
                total_amount_paise AS totalAmountPaise,
                created_at AS createdAt, updated_at AS updatedAt,
                created_by AS createdBy, updated_by AS updatedBy
         FROM purchases
         WHERE id = ? AND business_id = ?`,
      )
      .bind(purchaseId, businessId)
      .first<{
        id: number
        businessId: number
        purchaseDate: string
        supplierName: string | null
        notes: string | null
        totalAmountPaise: number
        createdAt: number
        updatedAt: number
        createdBy: string | null
        updatedBy: string | null
      }>()
    if (!header) return null

    const itemResult = await this.db
      .prepare(
        `SELECT id, item_id AS itemId, category_id AS categoryId,
                item_name_snapshot AS itemNameSnapshot,
                category_name_snapshot AS categoryNameSnapshot,
                quantity, unit, amount_paise AS amountPaise
         FROM purchase_items
         WHERE purchase_id = ? AND business_id = ?
         ORDER BY id`,
      )
      .bind(purchaseId, businessId)
      .all()

    return {
      ...header,
      items: (itemResult.results ?? []).map((row) => ({
        id: Number(row.id),
        itemId: Number(row.itemId),
        categoryId: Number(row.categoryId),
        itemNameSnapshot: String(row.itemNameSnapshot),
        categoryNameSnapshot: String(row.categoryNameSnapshot),
        quantity: row.quantity === null ? null : Number(row.quantity),
        unit: row.unit === null ? null : String(row.unit),
        amountPaise: Number(row.amountPaise),
      })),
    }
  }

  async updatePurchase(purchaseId: number, input: CreatePurchaseInput, businessId: number, actor = 'owner') {
    if (input.items.length === 0) {
      throw new Error('A purchase must contain at least one item')
    }
    const existing = await this.getById(purchaseId, businessId)
    if (!existing) throw new Error('Purchase not found')

    const itemRows = await this.resolveItems(input, businessId)
    const totalAmountPaise = input.items.reduce((total, item) => total + item.amountPaise, 0)
    const now = Date.now()
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE purchases
         SET purchase_date = ?, supplier_name = ?, notes = ?,
             total_amount_paise = ?, updated_at = ?, updated_by = ?
         WHERE id = ? AND business_id = ?`,
      ).bind(
        input.purchaseDate,
        input.supplierName ?? null,
        input.notes ?? null,
        totalAmountPaise,
        now,
        actor,
        purchaseId,
        businessId,
      ),
      this.db.prepare(
        'DELETE FROM purchase_items WHERE purchase_id = ? AND business_id = ?',
      ).bind(purchaseId, businessId),
    ]

    for (let index = 0; index < input.items.length; index += 1) {
      const purchaseItem = input.items[index]
      const row = itemRows[index]
      if (!row) continue
      if (purchaseItem.newItem) {
        statements.push(
          this.db.prepare(
            `INSERT INTO items
             (business_id, category_id, name, default_unit, is_active, created_at, updated_at)
             SELECT ?, ?, ?, ?, 1, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM items
               WHERE business_id = ? AND category_id = ? AND name = ? COLLATE NOCASE
             )`,
          ).bind(
            businessId,
            row.categoryId,
            row.itemName,
            purchaseItem.newItem.defaultUnit ?? null,
            now,
            now,
            businessId,
            row.categoryId,
            row.itemName,
          ),
        )
        statements.push(
          this.db.prepare(
            `INSERT INTO purchase_items
             (purchase_id, business_id, item_id, category_id,
              item_name_snapshot, category_name_snapshot, quantity, unit, amount_paise, created_at)
             VALUES (?, ?, (SELECT id FROM items WHERE business_id = ? AND category_id = ? AND name = ? COLLATE NOCASE),
             ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            purchaseId,
            businessId,
            businessId,
            row.categoryId,
            row.itemName,
            row.categoryId,
            row.itemName,
            row.categoryName,
            purchaseItem.quantity ?? null,
            purchaseItem.unit ?? null,
            purchaseItem.amountPaise,
            now,
          ),
        )
      } else if (purchaseItem.itemId !== undefined) {
        statements.push(
          this.db.prepare(
            `INSERT INTO purchase_items
             (purchase_id, business_id, item_id, category_id,
              item_name_snapshot, category_name_snapshot, quantity, unit, amount_paise, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            purchaseId,
            businessId,
            row.id,
            row.categoryId,
            row.itemName,
            row.categoryName,
            purchaseItem.quantity ?? null,
            purchaseItem.unit ?? null,
            purchaseItem.amountPaise,
            now,
          ),
        )
      }
    }

    const results = await this.db.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error('Purchase could not be updated')
    }
  }

  async deletePurchase(purchaseId: number, businessId: number) {
    const existing = await this.getById(purchaseId, businessId)
    if (!existing) return false
    const results = await this.db.batch([
      this.db.prepare(
        'DELETE FROM purchase_items WHERE purchase_id = ? AND business_id = ?',
      ).bind(purchaseId, businessId),
      this.db.prepare(
        'DELETE FROM purchases WHERE id = ? AND business_id = ?',
      ).bind(purchaseId, businessId),
    ])
    return results.every((result) => result.success)
  }
}

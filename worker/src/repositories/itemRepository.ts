interface ItemRow {
  id: number
  businessId: number
  categoryId: number
  categoryName: string
  name: string
  defaultUnit: string | null
  isActive: number
}

export class ItemRepository {
  constructor(private readonly db: D1Database) {}

  async findExact(businessId: number, categoryId: number, name: string) {
    return this.db
      .prepare(
        `SELECT i.id, i.business_id AS businessId, i.category_id AS categoryId,
                c.name AS categoryName, i.name, i.default_unit AS defaultUnit,
                i.is_active AS isActive
         FROM items i
         JOIN categories c ON c.id = i.category_id
         WHERE i.business_id = ? AND i.category_id = ? AND i.name = ? COLLATE NOCASE`,
      )
      .bind(businessId, categoryId, name)
      .first<ItemRow>()
  }

  async list(businessId: number, includeInactive = false) {
    const activeClause = includeInactive ? '' : ' AND i.is_active = 1'
    const result = await this.db
      .prepare(
        `SELECT i.id, i.business_id AS businessId, i.category_id AS categoryId,
                c.name AS categoryName, i.name, i.default_unit AS defaultUnit,
                i.is_active AS isActive
         FROM items i
         JOIN categories c ON c.id = i.category_id
         WHERE i.business_id = ?${activeClause}
         ORDER BY i.name COLLATE NOCASE`,
      )
      .bind(businessId)
      .all<ItemRow>()

    return (result.results ?? []).map((row) => ({
      ...row,
      isActive: Boolean(row.isActive),
      defaultUnit: row.defaultUnit ?? null,
    }))
  }

  async findById(itemId: number, businessId: number) {
    const item = await this.db
      .prepare(
        `SELECT i.id, i.business_id AS businessId, i.category_id AS categoryId,
                c.name AS categoryName, i.name, i.default_unit AS defaultUnit,
                i.is_active AS isActive
         FROM items i
         JOIN categories c ON c.id = i.category_id
         WHERE i.id = ? AND i.business_id = ?`,
      )
      .bind(itemId, businessId)
      .first<ItemRow>()
    if (!item) {
      return null
    }
    return {
      ...item,
      isActive: Boolean(item.isActive),
      defaultUnit: item.defaultUnit ?? null,
    }
  }

  async create(input: {
    businessId: number
    categoryId: number
    name: string
    defaultUnit?: string
  }) {
    const now = Date.now()
    const result = await this.db
      .prepare(
        `INSERT INTO items (business_id, category_id, name, default_unit, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         RETURNING id, business_id AS businessId, category_id AS categoryId,
                   name, default_unit AS defaultUnit, is_active AS isActive`,
      )
      .bind(input.businessId, input.categoryId, input.name, input.defaultUnit ?? null, now, now)
      .first<{
        id: number
        businessId: number
        categoryId: number
        name: string
        defaultUnit: string | null
        isActive: number
      }>()

    if (!result) {
      throw new Error('Item could not be created')
    }

    return { ...result, isActive: Boolean(result.isActive), categoryName: '' }
  }

  async deactivate(itemId: number, businessId: number) {
    const now = Date.now()
    const result = await this.db
      .prepare(
        `UPDATE items SET is_active = 0, updated_at = ?
         WHERE id = ? AND business_id = ?
         RETURNING id`,
      )
      .bind(now, itemId, businessId)
      .first<{ id: number }>()
    return result
  }
}

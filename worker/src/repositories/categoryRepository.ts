export class CategoryRepository {
  constructor(private readonly db: D1Database) {}

  async listActive(businessId: number) {
    const result = await this.db
      .prepare(
        `SELECT id, business_id AS businessId, name, is_active AS isActive
         FROM categories
         WHERE business_id = ? AND is_active = 1
         ORDER BY name COLLATE NOCASE`,
      )
      .bind(businessId)
      .all()

    return (result.results ?? []).map((row) => ({
      id: Number(row.id),
      businessId: Number(row.businessId),
      name: String(row.name),
      isActive: Boolean(row.isActive),
    }))
  }

  async findById(categoryId: number, businessId: number) {
    return this.db
      .prepare(
        `SELECT id, business_id AS businessId, name
         FROM categories
         WHERE id = ? AND business_id = ? AND is_active = 1`,
      )
      .bind(categoryId, businessId)
      .first<{ id: number; businessId: number; name: string }>()
  }
}

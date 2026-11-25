function csvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/^[=+\-@]/.test(text)) return `"'\u200B${text.replace(/"/g, '""')}"` 
  return `"${text.replace(/"/g, '""')}"`
}

function csv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')).join('\n')
  return `${header}\n${body}`
}

export class ExportRepository {
  constructor(private readonly db: D1Database) {}

  async purchases(businessId: number) {
    const result = await this.db
      .prepare(
        `SELECT id, purchase_date AS purchaseDate, supplier_name AS supplierName,
                notes, total_amount_paise AS totalAmountPaise,
                created_at AS createdAt, updated_at AS updatedAt,
                created_by AS createdBy, updated_by AS updatedBy
         FROM purchases WHERE business_id = ?
         ORDER BY purchase_date DESC, id DESC`,
      )
      .bind(businessId)
      .all()
    return csv(result.results ?? [], [
      'id', 'purchaseDate', 'supplierName', 'notes', 'totalAmountPaise',
      'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
    ])
  }

  async purchaseItems(businessId: number) {
    const result = await this.db
      .prepare(
        `SELECT pi.id, pi.purchase_id AS purchaseId, pi.item_name_snapshot AS itemName,
                pi.category_name_snapshot AS categoryName,
                pi.quantity, pi.unit, pi.amount_paise AS amountPaise,
                p.purchase_date AS purchaseDate
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.business_id = ? AND p.business_id = ?
         ORDER BY p.purchase_date DESC, pi.id`,
      )
      .bind(businessId, businessId)
      .all()
    return csv(result.results ?? [], [
      'id', 'purchaseId', 'purchaseDate', 'itemName', 'categoryName',
      'quantity', 'unit', 'amountPaise',
    ])
  }

  async categories(businessId: number) {
    const result = await this.db
      .prepare(
        `SELECT id, name, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
         FROM categories WHERE business_id = ?
         ORDER BY name COLLATE NOCASE`,
      )
      .bind(businessId)
      .all()
    return csv(result.results ?? [], ['id', 'name', 'isActive', 'createdAt', 'updatedAt'])
  }

  async items(businessId: number) {
    const result = await this.db
      .prepare(
        `SELECT i.id, i.name, c.name AS categoryName, i.default_unit AS defaultUnit,
                i.is_active AS isActive, i.created_at AS createdAt, i.updated_at AS updatedAt
         FROM items i
         JOIN categories c ON c.id = i.category_id
         WHERE i.business_id = ? AND c.business_id = ?
         ORDER BY i.name COLLATE NOCASE`,
      )
      .bind(businessId, businessId)
      .all()
    return csv(result.results ?? [], [
      'id', 'name', 'categoryName', 'defaultUnit', 'isActive', 'createdAt', 'updatedAt',
    ])
  }
}

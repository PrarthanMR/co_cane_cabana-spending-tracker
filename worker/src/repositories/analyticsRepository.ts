import type { DateRange } from '../services/dateRange'

export class AnalyticsRepository {
  constructor(private readonly db: D1Database) {}

  private periodFilter(alias: string, range: DateRange) {
    return `${alias}.purchase_date >= '${range.from}' AND ${alias}.purchase_date <= '${range.to}'`
  }

  private previousPeriodFilter(alias: string, range: DateRange) {
    return `${alias}.purchase_date >= '${range.previousFrom}' AND ${alias}.purchase_date <= '${range.previousTo}'`
  }

  async getSummary(businessId: number, range: DateRange) {
    const current = await this.db
      .prepare(
        `SELECT COUNT(*) AS sessionCount, COALESCE(SUM(total_amount_paise), 0) AS totalPaise
         FROM purchases
         WHERE business_id = ? AND ${this.periodFilter('purchases', range)}`,
      )
      .bind(businessId)
      .first<{ sessionCount: number; totalPaise: number }>()
    const previous = await this.db
      .prepare(
        `SELECT COUNT(*) AS sessionCount, COALESCE(SUM(total_amount_paise), 0) AS totalPaise
         FROM purchases
         WHERE business_id = ? AND ${this.previousPeriodFilter('purchases', range)}`,
      )
      .bind(businessId)
      .first<{ sessionCount: number; totalPaise: number }>()
    const fromDate = new Date(`${range.from}T00:00:00Z`)
    const toDate = new Date(`${range.to}T00:00:00Z`)
    const dayCount = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)
    const totalPaise = Number(current?.totalPaise ?? 0)
    const previousPaise = Number(previous?.totalPaise ?? 0)

    return {
      totalPaise,
      previousPeriodPaise: previousPaise,
      changePaise: totalPaise - previousPaise,
      changePercent: previousPaise === 0 ? null : ((totalPaise - previousPaise) / previousPaise) * 100,
      sessionCount: Number(current?.sessionCount ?? 0),
      previousSessionCount: Number(previous?.sessionCount ?? 0),
      averageDailyPaise: Math.round(totalPaise / dayCount),
      dayCount,
    }
  }

  async getCategories(businessId: number, range: DateRange) {
    const result = await this.db
      .prepare(
        `SELECT pi.category_id AS categoryId, pi.category_name_snapshot AS name,
                SUM(pi.amount_paise) AS amountPaise
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.business_id = ? AND p.business_id = ?
           AND p.purchase_date >= ? AND p.purchase_date <= ?
         GROUP BY pi.category_id, pi.category_name_snapshot
         ORDER BY amountPaise DESC`,
      )
      .bind(businessId, businessId, range.from, range.to)
      .all()
    return (result.results ?? []).map((row) => ({
      categoryId: Number(row.categoryId),
      name: String(row.name),
      amountPaise: Number(row.amountPaise),
    }))
  }

  async getItems(businessId: number, range: DateRange, categoryId?: number) {
    const conditions = [
      'pi.business_id = ?',
      'p.business_id = ?',
      'p.purchase_date >= ?',
      'p.purchase_date <= ?',
    ]
    const bindings: Array<number | string> = [businessId, businessId, range.from, range.to]
    if (categoryId) {
      conditions.push('pi.category_id = ?')
      bindings.push(categoryId)
    }
    const result = await this.db
      .prepare(
        `SELECT pi.item_id AS itemId, pi.item_name_snapshot AS name,
                pi.category_id AS categoryId,
                SUM(pi.amount_paise) AS amountPaise,
                COUNT(DISTINCT pi.purchase_id) AS purchaseCount
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE ${conditions.join(' AND ')}
         GROUP BY pi.item_id, pi.item_name_snapshot, pi.category_id
         ORDER BY amountPaise DESC`,
      )
      .bind(...bindings)
      .all()
    return (result.results ?? []).map((row) => ({
      itemId: Number(row.itemId),
      name: String(row.name),
      categoryId: Number(row.categoryId),
      amountPaise: Number(row.amountPaise),
      purchaseCount: Number(row.purchaseCount),
    }))
  }

  async getTrend(businessId: number, range: DateRange) {
    const dayCount = Math.round(
      (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86400000,
    ) + 1
    let groupExpression = 'purchase_date'
    let labelExpression = 'purchase_date'
    if (dayCount > 62) {
      groupExpression = `substr(purchase_date, 1, 7)`
      labelExpression = `substr(purchase_date, 1, 7)`
    } else if (dayCount > 14) {
      groupExpression = `strftime('%Y-%W', purchase_date)`
      labelExpression = `strftime('%Y-%W', purchase_date)`
    }
    const result = await this.db
      .prepare(
        `SELECT ${labelExpression} AS label, SUM(total_amount_paise) AS amountPaise
         FROM purchases
         WHERE business_id = ?
           AND purchase_date >= ? AND purchase_date <= ?
         GROUP BY ${groupExpression}
         ORDER BY ${labelExpression}`,
      )
      .bind(businessId, range.from, range.to)
      .all()
    return (result.results ?? []).map((row) => ({
      label: String(row.label),
      amountPaise: Number(row.amountPaise),
    }))
  }

  async getCategoriesForPeriod(
    businessId: number,
    from: string,
    to: string,
  ) {
    const result = await this.db
      .prepare(
        `SELECT pi.category_id AS categoryId, pi.category_name_snapshot AS name,
                SUM(pi.amount_paise) AS amountPaise
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.business_id = ? AND p.business_id = ?
           AND p.purchase_date >= ? AND p.purchase_date <= ?
         GROUP BY pi.category_id, pi.category_name_snapshot
         ORDER BY amountPaise DESC`,
      )
      .bind(businessId, businessId, from, to)
      .all()
    return (result.results ?? []).map((row) => ({
      categoryId: Number(row.categoryId),
      name: String(row.name),
      amountPaise: Number(row.amountPaise),
    }))
  }

  async getHistoricalDailyTotals(businessId: number, beforeDate: string) {
    const result = await this.db
      .prepare(
        `SELECT purchase_date AS date,
                SUM(total_amount_paise) AS amountPaise
         FROM purchases
         WHERE business_id = ?
           AND purchase_date < ?
         GROUP BY purchase_date
         ORDER BY purchase_date DESC
         LIMIT 90`,
      )
      .bind(businessId, beforeDate)
      .all()
    return (result.results ?? []).map((row) => ({
      date: String(row.date),
      amountPaise: Number(row.amountPaise),
    }))
  }

  async getCompatibleUnitPrices(businessId: number, beforeDate: string) {
    const result = await this.db
      .prepare(
        `SELECT pi.item_id AS itemId, pi.item_name_snapshot AS name,
                pi.quantity, pi.unit, pi.amount_paise AS amountPaise,
                p.purchase_date AS purchaseDate
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.business_id = ? AND p.business_id = ?
           AND p.purchase_date < ?
           AND pi.quantity IS NOT NULL AND pi.quantity > 0
           AND pi.unit IS NOT NULL AND trim(pi.unit) != ''
         ORDER BY p.purchase_date DESC, p.id DESC
         LIMIT 500`,
      )
      .bind(businessId, businessId, beforeDate)
      .all()
    return (result.results ?? []).map((row) => {
      const quantity = Number(row.quantity)
      return {
        itemId: Number(row.itemId),
        name: String(row.name),
        unit: String(row.unit).trim().toLocaleLowerCase(),
        purchaseDate: String(row.purchaseDate),
        unitPricePaise: Math.round(Number(row.amountPaise) / quantity),
      }
    })
  }

  async getItemHistory(businessId: number, range: DateRange, itemId: number) {
    const result = await this.db
      .prepare(
        `SELECT p.purchase_date AS purchaseDate, p.id AS purchaseId,
                pi.quantity, pi.unit, pi.amount_paise AS amountPaise,
                pi.category_name_snapshot AS categoryName,
                pi.item_name_snapshot AS itemName
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.business_id = ? AND p.business_id = ?
           AND pi.item_id = ? AND p.purchase_date >= ? AND p.purchase_date <= ?
         ORDER BY p.purchase_date DESC, p.id DESC`,
      )
      .bind(businessId, businessId, itemId, range.from, range.to)
      .all()

    const history = (result.results ?? []).map((row) => {
      const quantity = row.quantity === null ? null : Number(row.quantity)
      const unit = row.unit === null ? null : String(row.unit).trim()
      const amountPaise = Number(row.amountPaise)
      const compatibleUnit =
        quantity !== null && quantity > 0 && unit
          ? unit.toLocaleLowerCase()
          : null
      return {
        purchaseId: Number(row.purchaseId),
        purchaseDate: String(row.purchaseDate),
        itemName: String(row.itemName),
        categoryName: String(row.categoryName),
        quantity,
        unit,
        amountPaise,
        unitPricePaise:
          compatibleUnit && quantity !== null
            ? Math.round(amountPaise / quantity)
            : null,
        unitPriceUnit: compatibleUnit,
      }
    })

    const compatibleUnits = [...new Set(history
      .map((row) => row.unitPriceUnit)
      .filter((unit): unit is string => unit !== null))]

    return { compatibleUnits, history }
  }
}

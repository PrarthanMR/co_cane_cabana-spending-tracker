export interface PurchaseAuditEntry {
  id: number
  purchaseId: number
  version: number
  action: 'created' | 'updated' | 'deleted' | 'legacy_baseline'
  actorUserId: number | null
  actorDisplayName: string
  occurredAt: number
}

export class PurchaseAuditRepository {
  constructor(private readonly db: D1Database) {}

  async list(
    businessId: number,
    purchaseId?: number,
    beforeId?: number,
  ): Promise<{ events: PurchaseAuditEntry[]; hasMore: boolean }> {
    const conditions = ['e.business_id = ?']
    const bindings: number[] = [businessId]
    if (purchaseId !== undefined) {
      conditions.push('e.purchase_id = ?')
      bindings.push(purchaseId)
    }
    if (beforeId !== undefined) {
      conditions.push('e.id < ?')
      bindings.push(beforeId)
    }
    const result = await this.db.prepare(
      `SELECT e.id, e.purchase_id AS purchaseId,
              e.purchase_version AS version, e.action,
              e.actor_user_id AS actorUserId,
              COALESCE(u.display_name, 'Unknown (before audit tracking)') AS actorDisplayName,
              e.occurred_at AS occurredAt
       FROM purchase_audit_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.id DESC
       LIMIT 101`,
    ).bind(...bindings).all<PurchaseAuditEntry>()
    const rows = result.results ?? []
    return { events: rows.slice(0, 100), hasMore: rows.length > 100 }
  }
}

export class BusinessRepository {
  constructor(private readonly db: D1Database) {}

  async resolveBusinessId(requestedId?: number): Promise<number> {
    if (requestedId !== undefined) {
      const business = await this.db
        .prepare('SELECT id FROM businesses WHERE id = ?')
        .bind(requestedId)
        .first<{ id: number }>()
      if (!business) {
        throw new Error('Business not found')
      }
      return business.id
    }

    const business = await this.db
      .prepare('SELECT id FROM businesses ORDER BY id LIMIT 1')
      .first<{ id: number }>()
    if (!business) {
      throw new Error('No business is configured')
    }
    return business.id
  }
}

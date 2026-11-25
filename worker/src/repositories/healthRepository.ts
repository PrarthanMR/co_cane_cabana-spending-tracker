import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'

export class HealthRepository {
  constructor(private readonly db: D1Database) {}

  async checkDatabase(): Promise<boolean> {
    const database = drizzle(this.db)
    const result = await database.run(sql`SELECT 1 AS ok`)
    return result.success
  }
}

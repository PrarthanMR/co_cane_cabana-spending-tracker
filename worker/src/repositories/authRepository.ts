export interface UserRow {
  id: number
  username: string
  displayName: string
  pinHash: string
  pinSalt: string
  pinIterations: number
  isActive: number
}

export interface AuthSession {
  sessionId: number
  userId: number
  username: string
  displayName: string
  businessId: number | null
  role: 'owner' | 'member' | null
}

export type RegistrationFailureStage =
  | 'owner_check'
  | 'pin_salt'
  | 'pin_hash'
  | 'pin_key_import'
  | 'pin_derive_bits'
  | 'session_token'
  | 'business_lookup'
  | 'database_batch'
  | 'database_result'

export class RegistrationFailure extends Error {
  readonly stage: RegistrationFailureStage
  readonly errorType?: string

  constructor(stage: RegistrationFailureStage, errorType?: string) {
    super('Owner registration failed')
    this.name = 'RegistrationFailure'
    this.stage = stage
    this.errorType = errorType
  }
}

export class AuthRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async findUser(username: string): Promise<UserRow | null> {
    return this.db.prepare(
      `SELECT id, username, display_name AS displayName, pin_hash AS pinHash,
              pin_salt AS pinSalt, pin_iterations AS pinIterations, is_active AS isActive
       FROM users WHERE username = ? COLLATE NOCASE`,
    ).bind(username).first<UserRow>()
  }

  async hasRegisteredOwner(): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS registered FROM app_metadata
       WHERE key = 'bootstrap_owner_registered'`,
    ).first<{ registered: number }>()
    return row !== null
  }

  async registerOwner(input: {
    businessName: string
    currencyCode: string
    timeZone: string
    username: string
    displayName: string
    pinHash: string
    pinSalt: string
    pinIterations: number
    tokenHash: string
    now: number
    expiresAt: number
  }): Promise<{ userId: number; businessId: number }> {
    let unclaimedBusiness: { id: number } | null
    try {
      unclaimedBusiness = await this.db.prepare(
        `SELECT b.id FROM businesses b
         WHERE NOT EXISTS (
           SELECT 1 FROM business_members bm WHERE bm.business_id = b.id
         )
         ORDER BY b.id LIMIT 1`,
      ).first<{ id: number }>()
    } catch {
      throw new RegistrationFailure('business_lookup')
    }

    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ('bootstrap_owner_registered', '1', ?)`,
      ).bind(input.now),
      this.db.prepare(
        `INSERT INTO users
         (username, display_name, pin_hash, pin_salt, pin_iterations, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        input.username,
        input.displayName,
        input.pinHash,
        input.pinSalt,
        input.pinIterations,
        input.now,
        input.now,
      ),
    ]

    if (unclaimedBusiness) {
      statements.push(this.db.prepare(
        `UPDATE businesses SET name = ?, currency_code = ?, time_zone = ?, updated_at = ?
         WHERE id = ? AND NOT EXISTS (
           SELECT 1 FROM business_members WHERE business_id = ?
         )`,
      ).bind(
        input.businessName,
        input.currencyCode,
        input.timeZone,
        input.now,
        unclaimedBusiness.id,
        unclaimedBusiness.id,
      ))
      statements.push(this.db.prepare(
        `INSERT INTO business_members
         (business_id, user_id, role, is_active, joined_at, updated_at)
         VALUES (?, (SELECT id FROM users WHERE username = ?), 'owner', 1, ?, ?)`,
      ).bind(unclaimedBusiness.id, input.username, input.now, input.now))
    } else {
      statements.push(this.db.prepare(
        `INSERT INTO businesses (name, currency_code, time_zone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(input.businessName, input.currencyCode, input.timeZone, input.now, input.now))
      statements.push(this.db.prepare(
        `INSERT INTO business_members
         (business_id, user_id, role, is_active, joined_at, updated_at)
         VALUES (last_insert_rowid(), (SELECT id FROM users WHERE username = ?), 'owner', 1, ?, ?)`,
      ).bind(input.username, input.now, input.now))
    }

    const businessIdExpression = unclaimedBusiness
      ? '?'
      : `(SELECT business_id FROM business_members
          WHERE user_id = (SELECT id FROM users WHERE username = ?)
            AND role = 'owner' ORDER BY id DESC LIMIT 1)`
    const sessionSql = unclaimedBusiness
      ? `INSERT INTO sessions
         (token_hash, user_id, business_id, created_at, expires_at, last_seen_at)
         VALUES (?, (SELECT id FROM users WHERE username = ?), ?, ?, ?, ?)`
      : `INSERT INTO sessions
         (token_hash, user_id, business_id, created_at, expires_at, last_seen_at)
         VALUES (?, (SELECT id FROM users WHERE username = ?), ${businessIdExpression}, ?, ?, ?)`
    const sessionBindings = unclaimedBusiness
      ? [input.tokenHash, input.username, unclaimedBusiness.id, input.now, input.expiresAt, input.now]
      : [input.tokenHash, input.username, input.username, input.now, input.expiresAt, input.now]
    statements.push(this.db.prepare(sessionSql).bind(...sessionBindings))

    let results: D1Result[]
    try {
      results = await this.db.batch(statements)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw error
      }
      throw new RegistrationFailure('database_batch')
    }
    if (results.some((result) => !result.success)) {
      throw new RegistrationFailure('database_batch')
    }

    try {
      const userId = Number(results[1].meta.last_row_id)
      const businessId = unclaimedBusiness
        ? unclaimedBusiness.id
        : Number(results[2].meta.last_row_id)
      if (!userId || !businessId || results[results.length - 1].meta.changes !== 1) {
        throw new RegistrationFailure('database_result')
      }
      return { userId, businessId }
    } catch (error) {
      if (error instanceof RegistrationFailure) throw error
      throw new RegistrationFailure('database_result')
    }
  }

  async createBusinessForUser(input: {
    name: string
    currencyCode: string
    timeZone: string
    userId: number
    now: number
  }): Promise<number> {
    const results = await this.db.batch([
      this.db.prepare(
        `INSERT INTO businesses (name, currency_code, time_zone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(input.name, input.currencyCode, input.timeZone, input.now, input.now),
      this.db.prepare(
        `INSERT INTO business_members
         (business_id, user_id, role, is_active, joined_at, updated_at)
         VALUES (last_insert_rowid(), ?, 'owner', 1, ?, ?)`,
      ).bind(input.userId, input.now, input.now),
    ])
    if (results.some((result) => !result.success)) throw new Error('business_creation_failed')
    const businessId = Number(results[0].meta.last_row_id)
    return businessId
  }

  async listMemberships(userId: number) {
    const result = await this.db.prepare(
      `SELECT b.id AS businessId, b.name AS businessName,
              b.currency_code AS currencyCode, bm.role
       FROM business_members bm
       JOIN businesses b ON b.id = bm.business_id
       WHERE bm.user_id = ? AND bm.is_active = 1
       ORDER BY b.name COLLATE NOCASE`,
    ).bind(userId).all<{
      businessId: number
      businessName: string
      currencyCode: string
      role: 'owner' | 'member'
    }>()
    return result.results ?? []
  }

  async createSession(
    userId: number,
    businessId: number | null,
    tokenHash: string,
    now: number,
    expiresAt: number,
  ) {
    const result = await this.db.prepare(
      `INSERT INTO sessions (token_hash, user_id, business_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(tokenHash, userId, businessId, now, expiresAt, now).run()
    if (!result.success) throw new Error('session_creation_failed')
    return Number(result.meta.last_row_id)
  }

  async getSession(tokenHash: string, now: number): Promise<AuthSession | null> {
    return this.db.prepare(
      `SELECT s.id AS sessionId, u.id AS userId, u.username,
              u.display_name AS displayName, s.business_id AS businessId, bm.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.is_active = 1
       LEFT JOIN business_members bm
         ON bm.business_id = s.business_id AND bm.user_id = s.user_id AND bm.is_active = 1
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
         AND (s.business_id IS NULL OR bm.id IS NOT NULL)`,
    ).bind(tokenHash, now).first<AuthSession>()
  }

  async selectBusiness(sessionId: number, userId: number, businessId: number, now: number) {
    const membership = await this.db.prepare(
      `SELECT role FROM business_members
       WHERE business_id = ? AND user_id = ? AND is_active = 1`,
    ).bind(businessId, userId).first<{ role: 'owner' | 'member' }>()
    if (!membership) return null
    const result = await this.db.prepare(
      `UPDATE sessions SET business_id = ?, last_seen_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(businessId, now, sessionId, userId, now).run()
    return result.meta.changes === 1 ? membership.role : null
  }

  async revokeSession(sessionId: number, userId: number, now: number) {
    await this.db.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    ).bind(now, sessionId, userId).run()
  }

  async createInvitation(input: {
    businessId: number
    codeHash: string
    createdByUserId: number
    now: number
    expiresAt: number
  }) {
    const result = await this.db.prepare(
      `INSERT INTO invitation_codes
       (business_id, code_hash, created_by_user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      input.businessId,
      input.codeHash,
      input.createdByUserId,
      input.now,
      input.expiresAt,
    ).run()
    if (!result.success) throw new Error('invitation_creation_failed')
    return Number(result.meta.last_row_id)
  }

  async findInvitation(codeHash: string, now: number) {
    return this.db.prepare(
      `SELECT id, business_id AS businessId, expires_at AS expiresAt,
              redeemed_at AS redeemedAt
       FROM invitation_codes WHERE code_hash = ? AND expires_at > ? AND redeemed_at IS NULL`,
    ).bind(codeHash, now).first<{
      id: number
      businessId: number
      expiresAt: number
      redeemedAt: number | null
    }>()
  }

  async joinBusiness(input: {
    codeHash: string
    username: string
    displayName: string
    pinHash: string
    pinSalt: string
    pinIterations: number
    tokenHash: string
    now: number
    expiresAt: number
  }) {
    const statements = [
      this.db.prepare(
        `INSERT INTO users
         (username, display_name, pin_hash, pin_salt, pin_iterations, is_active, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 1, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM invitation_codes
           WHERE code_hash = ? AND redeemed_at IS NULL AND expires_at > ?
         )`,
      ).bind(
        input.username,
        input.displayName,
        input.pinHash,
        input.pinSalt,
        input.pinIterations,
        input.now,
        input.now,
        input.codeHash,
        input.now,
      ),
      this.db.prepare(
        `UPDATE invitation_codes
         SET redeemed_at = ?, redeemed_by_user_id = (
           SELECT id FROM users WHERE username = ?
         )
         WHERE code_hash = ? AND redeemed_at IS NULL AND expires_at > ?
           AND EXISTS (SELECT 1 FROM users WHERE username = ?)`,
      ).bind(input.now, input.username, input.codeHash, input.now, input.username),
      this.db.prepare(
        `INSERT INTO business_members
         (business_id, user_id, role, is_active, invited_by_user_id, joined_at, updated_at)
         SELECT ic.business_id, ic.redeemed_by_user_id, 'member', 1,
                ic.created_by_user_id, ?, ?
         FROM invitation_codes ic
         WHERE ic.code_hash = ? AND ic.redeemed_at = ?
           AND ic.redeemed_by_user_id = (SELECT id FROM users WHERE username = ?)`,
      ).bind(input.now, input.now, input.codeHash, input.now, input.username),
      this.db.prepare(
        `INSERT INTO sessions
         (token_hash, user_id, business_id, created_at, expires_at, last_seen_at)
         SELECT ?, ic.redeemed_by_user_id, ic.business_id, ?, ?, ?
         FROM invitation_codes ic
         WHERE ic.code_hash = ? AND ic.redeemed_at = ?
           AND ic.redeemed_by_user_id = (SELECT id FROM users WHERE username = ?)`,
      ).bind(
        input.tokenHash,
        input.now,
        input.expiresAt,
        input.now,
        input.codeHash,
        input.now,
        input.username,
      ),
    ]
    const results = await this.db.batch(statements)
    if (
      results.some((result) => !result.success) ||
      results[0].meta.changes !== 1 ||
      results[1].meta.changes !== 1 ||
      results[2].meta.changes !== 1 ||
      results[3].meta.changes !== 1
    ) {
      throw new Error('invitation_invalid')
    }
    const user = await this.findUser(input.username)
    if (!user) throw new Error('invitation_invalid')
    const member = await this.db.prepare(
      `SELECT business_id AS businessId FROM invitation_codes
       WHERE code_hash = ? AND redeemed_by_user_id = ?`,
    ).bind(input.codeHash, user.id).first<{ businessId: number }>()
    if (!member) throw new Error('invitation_invalid')
    return { userId: user.id, businessId: member.businessId }
  }

  async tryBeginLoginAttempt(keyHash: string, now: number) {
    const windowMs = 15 * 60 * 1000
    const row = await this.db.prepare(
      `INSERT INTO auth_rate_limits
       (key_hash, failure_count, window_started_at, locked_until, updated_at)
       VALUES (?, 1, ?, NULL, ?)
       ON CONFLICT(key_hash) DO UPDATE SET
         failure_count = CASE
           WHEN auth_rate_limits.window_started_at <= ? THEN 1
           ELSE auth_rate_limits.failure_count + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at
           ELSE auth_rate_limits.window_started_at
         END,
         locked_until = CASE
           WHEN auth_rate_limits.window_started_at <= ? THEN NULL
           ELSE auth_rate_limits.locked_until
         END,
         updated_at = excluded.updated_at
       WHERE (auth_rate_limits.locked_until IS NULL OR auth_rate_limits.locked_until <= ?)
         AND (
           auth_rate_limits.window_started_at <= ?
           OR auth_rate_limits.failure_count < 5
         )
       RETURNING failure_count AS failureCount`,
    ).bind(
      keyHash,
      now,
      now,
      now - windowMs,
      now - windowMs,
      now - windowMs,
      now,
      now - windowMs,
    ).first<{ failureCount: number }>()
    return row !== null
  }

  async recordFailedLogin(keyHash: string, now: number) {
    const windowMs = 15 * 60 * 1000
    await this.db.prepare(
      `UPDATE auth_rate_limits
       SET locked_until = CASE
             WHEN failure_count >= 5 THEN ?
             ELSE locked_until
           END,
           updated_at = ?
       WHERE key_hash = ? AND window_started_at > ?`,
    ).bind(now + windowMs, now, keyHash, now - windowMs).run()
  }

  async clearFailedLogins(keyHash: string) {
    await this.db.prepare('DELETE FROM auth_rate_limits WHERE key_hash = ?').bind(keyHash).run()
  }

  async deactivateMember(businessId: number, targetUserId: number, actorUserId: number, now: number) {
    const target = await this.db.prepare(
      `SELECT role FROM business_members
       WHERE business_id = ? AND user_id = ? AND is_active = 1`,
    ).bind(businessId, targetUserId).first<{ role: 'owner' | 'member' }>()
    if (!target || target.role !== 'member' || targetUserId === actorUserId) {
      return false
    }
    const result = await this.db.batch([
      this.db.prepare(
        `UPDATE business_members
         SET is_active = 0, deactivated_at = ?, updated_at = ?
         WHERE business_id = ? AND user_id = ? AND role = 'member' AND is_active = 1`,
      ).bind(now, now, businessId, targetUserId),
      this.db.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND business_id = ? AND revoked_at IS NULL`,
      ).bind(now, targetUserId, businessId),
    ])
    return result[0].meta.changes === 1
  }

  async listMembers(businessId: number) {
    const result = await this.db.prepare(
      `SELECT u.id AS userId, u.username, u.display_name AS displayName,
              bm.role, bm.joined_at AS joinedAt
       FROM business_members bm
       JOIN users u ON u.id = bm.user_id
       WHERE bm.business_id = ? AND bm.is_active = 1
       ORDER BY bm.role, u.display_name COLLATE NOCASE`,
    ).bind(businessId).all()
    return result.results ?? []
  }
}

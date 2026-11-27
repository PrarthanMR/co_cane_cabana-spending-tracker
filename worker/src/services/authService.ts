import {
  constantTimeEqual,
  hashPin,
  keyedHash,
  PinHashFailure,
  PIN_ITERATIONS,
  randomHex,
} from './pinSecurity'
import { AuthRepository, RegistrationFailure } from '../repositories/authRepository'

export const SESSION_COOKIE_NAME = 'spending_tracker_session'
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export interface AuthResult {
  token: string
  expiresAt: number
  userId: number
  businessId: number | null
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly pepper: string,
  ) {
    if (pepper.length < 32) throw new Error('PIN_PEPPER must be at least 32 characters')
  }

  async registerOwner(
    input: {
      bootstrapToken: string
      businessName: string
      currencyCode: string
      timeZone: string
      username: string
      displayName: string
      pin: string
    },
    configuredBootstrapToken: string | undefined,
  ): Promise<AuthResult> {
    if (
      !configuredBootstrapToken ||
      !constantTimeEqual(input.bootstrapToken, configuredBootstrapToken)
    ) {
      throw new AuthError('Invalid registration credentials', 401)
    }
    let registrationComplete: boolean
    try {
      registrationComplete = await this.repository.hasRegisteredOwner()
    } catch {
      throw new RegistrationFailure('owner_check')
    }
    if (registrationComplete) {
      throw new AuthError('Initial registration is already complete', 409)
    }

    const now = Date.now()
    let salt: string
    try {
      salt = randomHex(16)
    } catch {
      throw new RegistrationFailure('pin_salt')
    }

    let pinHash: string
    try {
      pinHash = await hashPin(input.pin, salt, this.pepper)
    } catch (error) {
      if (error instanceof PinHashFailure) {
        throw new RegistrationFailure(
          error.stage === 'key_import' ? 'pin_key_import' : 'pin_derive_bits',
          error.errorType,
        )
      }
      throw new RegistrationFailure('pin_hash')
    }

    let token: string
    let tokenHash: string
    try {
      token = randomHex(32)
      tokenHash = await keyedHash(token, this.pepper)
    } catch {
      throw new RegistrationFailure('session_token')
    }
    const expiresAt = now + SESSION_DURATION_MS
    const registered = await this.repository.registerOwner({
      businessName: input.businessName,
      currencyCode: input.currencyCode,
      timeZone: input.timeZone,
      username: input.username,
      displayName: input.displayName,
      pinHash,
      pinSalt: salt,
      pinIterations: PIN_ITERATIONS,
      tokenHash,
      now,
      expiresAt,
    })
    return { token, expiresAt, ...registered }
  }

  async login(username: string, pin: string): Promise<AuthResult> {
    const keyHash = await keyedHash(`login:${username}`, this.pepper)
    const now = Date.now()
    if (!await this.repository.tryBeginLoginAttempt(keyHash, now)) {
      throw new AuthError('Too many failed attempts. Try again later.', 429)
    }

    const user = await this.repository.findUser(username)
    const salt = user?.pinSalt ?? randomHex(16)
    const iterations = user?.pinIterations ?? PIN_ITERATIONS
    const candidateHash = await hashPin(pin, salt, this.pepper, iterations)
    if (
      !user ||
      !user.isActive ||
      !constantTimeEqual(candidateHash, user.pinHash)
    ) {
      await this.repository.recordFailedLogin(keyHash, now)
      throw new AuthError('Invalid username or PIN', 401)
    }

    const memberships = await this.repository.listMemberships(user.id)
    if (memberships.length === 0) {
      await this.repository.recordFailedLogin(keyHash, now)
      throw new AuthError('Invalid username or PIN', 401)
    }
    await this.repository.clearFailedLogins(keyHash)
    const token = randomHex(32)
    const expiresAt = now + SESSION_DURATION_MS
    const businessId = memberships.length === 1 ? memberships[0].businessId : null
    await this.repository.createSession(
      user.id,
      businessId,
      await keyedHash(token, this.pepper),
      now,
      expiresAt,
    )
    return { token, expiresAt, userId: user.id, businessId }
  }

  async joinBusiness(input: {
    invitationCode: string
    username: string
    displayName: string
    pin: string
  }): Promise<AuthResult> {
    if (await this.repository.findUser(input.username)) {
      throw new AuthError('Username is already in use', 409)
    }
    const now = Date.now()
    const salt = randomHex(16)
    const token = randomHex(32)
    const expiresAt = now + SESSION_DURATION_MS
    const result = await this.repository.joinBusiness({
      codeHash: await keyedHash(`invite:${input.invitationCode}`, this.pepper),
      username: input.username,
      displayName: input.displayName,
      pinHash: await hashPin(input.pin, salt, this.pepper),
      pinSalt: salt,
      pinIterations: PIN_ITERATIONS,
      tokenHash: await keyedHash(token, this.pepper),
      now,
      expiresAt,
    })
    return { token, expiresAt, ...result }
  }

  async createInvitation(
    businessId: number,
    userId: number,
    expiresInHours: number,
  ): Promise<{ code: string; expiresAt: number }> {
    const code = randomHex(16)
    const now = Date.now()
    const expiresAt = now + expiresInHours * 60 * 60 * 1000
    await this.repository.createInvitation({
      businessId,
      codeHash: await keyedHash(`invite:${code}`, this.pepper),
      createdByUserId: userId,
      now,
      expiresAt,
    })
    return { code, expiresAt }
  }

  async session(token: string, now = Date.now()) {
    return this.repository.getSession(await keyedHash(token, this.pepper), now)
  }

  async selectBusiness(
    sessionId: number,
    userId: number,
    businessId: number,
  ) {
    return this.repository.selectBusiness(sessionId, userId, businessId, Date.now())
  }
}

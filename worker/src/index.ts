import { HealthRepository } from './repositories/healthRepository'
import { healthResponseSchema } from './schemas/health'
import { HealthService } from './services/healthService'
import { CategoryRepository } from './repositories/categoryRepository'
import { ItemRepository } from './repositories/itemRepository'
import { ItemService } from './services/itemService'
import { createItemSchema } from './schemas/item'
import { createPurchaseSchema, deletePurchaseSchema, updatePurchaseSchema } from './schemas/purchase'
import { PurchaseRepository } from './repositories/purchaseRepository'
import { AnalyticsRepository } from './repositories/analyticsRepository'
import { analyticsQuerySchema } from './schemas/analytics'
import { getDateRange } from './services/dateRange'
import { generateSpendingInsights } from './services/spendingInsights'
import { ExportRepository } from './repositories/exportRepository'
import { ZodError } from 'zod'
import type { Env } from './types'
import { AuthRepository, RegistrationFailure } from './repositories/authRepository'
import { AuthError, AuthService, SESSION_COOKIE_NAME, SESSION_DURATION_MS } from './services/authService'
import { PurchaseAuditRepository } from './repositories/purchaseAuditRepository'
import { frontendDiagnosticSchema, purchaseAuditQuerySchema } from './schemas/telemetry'
import {
  buildRequestLog,
  emitStructuredLog,
  getRequestId,
} from './services/observability'
import {
  createBusinessSchema,
  createInvitationSchema,
  joinBusinessSchema,
  loginSchema,
  registerOwnerSchema,
  selectBusinessSchema,
} from './schemas/auth'

function jsonError(message: string, status = 400): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function responseHeaders(contentType = 'application/json'): Headers {
  const headers = new Headers({ 'Content-Type': contentType })
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'no-referrer')
  return headers
}

function statusErrorCode(status: number): string | null {
  if (status >= 500) return 'server_error'
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'authentication_failed'
  if (status === 403) return 'authorization_failed'
  if (status === 409) return 'request_conflict'
  if (status >= 400) return 'validation_error'
  return null
}

function logProductEvent(
  request: Request,
  env: Env,
  event: string,
  status = 200,
  errorCode?: string,
  errorType?: string,
): void {
  try {
    emitStructuredLog({
      ...buildRequestLog({
        appVersion: env.APP_VERSION,
        requestId: request.headers.get('X-Request-ID') ?? '',
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        durationMs: 0,
        userAgent: request.headers.get('User-Agent'),
        errorCode,
        event,
        errorType,
      }),
      level: 'info',
      type: 'product_event',
    })
  } catch {
    // Product telemetry is best-effort and must not affect API mutations.
  }
}

function logInternalError(
  request: Request,
  env: Env,
  error: unknown,
  failureStage?: string,
): void {
  try {
    emitStructuredLog({
      ...buildRequestLog({
        appVersion: env.APP_VERSION,
        requestId: request.headers.get('X-Request-ID') ?? '',
        method: request.method,
        path: new URL(request.url).pathname,
        status: 500,
        durationMs: 0,
        userAgent: request.headers.get('User-Agent'),
        errorCode: 'server_error',
        errorType: error instanceof RegistrationFailure && error.errorType
          ? error.errorType
          : error instanceof Error ? error.name : 'UnknownError',
      }),
      ...(failureStage ? { failureStage } : {}),
      type: 'internal_error',
    })
  } catch {
    // Error diagnostics must not affect API requests.
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie')?.split(';') ?? []
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=')
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(cookie.slice(separator + 1).trim())
  }
  return null
}

function setSessionCookie(token: string, env: Env): string {
  const secure = env.APP_ENV !== 'local' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`
}

function clearSessionCookie(env: Env): string {
  const secure = env.APP_ENV !== 'local' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}

function isSameOriginMutation(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  const allowedOrigin = env.APP_ORIGIN
  if (origin === new URL(request.url).origin || origin === allowedOrigin) return true
  if (env.APP_ENV === 'local') {
    try {
      const parsed = new URL(origin)
      return parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
        parsed.port === '5173'
    } catch {
      return false
    }
  }
  return false
}

async function readJson(request: Request) {
  try {
    return await request.json()
  } catch {
    throw new Error('Invalid JSON body')
  }
}

const routeHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (request.method === 'GET' && env.ASSETS && !url.pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(request)
      }
      if (request.method !== 'GET' && !isSameOriginMutation(request, env)) {
        return jsonError('Cross-origin request rejected', 403)
      }
      const authRepository = new AuthRepository(env.DB)

      if (request.method === 'GET' && url.pathname === '/api/auth/status') {
        return Response.json({ registrationComplete: await authRepository.hasRegisteredOwner() })
      }
      if (!env.PIN_PEPPER) throw new Error('PIN_PEPPER is not configured')
      const authService = new AuthService(authRepository, env.PIN_PEPPER)
      if (request.method === 'POST' && url.pathname === '/api/auth/register') {
        const parsed = registerOwnerSchema.parse(await readJson(request))
        const result = await authService.registerOwner(parsed, env.BOOTSTRAP_TOKEN)
        const headers = responseHeaders()
        headers.append('Set-Cookie', setSessionCookie(result.token, env))
        return new Response(JSON.stringify({
          userId: result.userId,
          businessId: result.businessId,
        }), { status: 201, headers })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const parsed = loginSchema.parse(await readJson(request))
        let result
        try {
          result = await authService.login(parsed.username, parsed.pin)
        } catch (error) {
          const status = error instanceof AuthError ? error.status : 500
          logProductEvent(
            request,
            env,
            'login_failure',
            status,
            statusErrorCode(status) ?? 'server_error',
          )
          throw error
        }
        logProductEvent(request, env, 'login_success')
        const headers = responseHeaders()
        headers.append('Set-Cookie', setSessionCookie(result.token, env))
        return new Response(JSON.stringify({
          userId: result.userId,
          businessId: result.businessId,
        }), { headers })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/join') {
        const parsed = joinBusinessSchema.parse(await readJson(request))
        const result = await authService.joinBusiness(parsed)
        logProductEvent(request, env, 'user_joined')
        const headers = responseHeaders()
        headers.append('Set-Cookie', setSessionCookie(result.token, env))
        return new Response(JSON.stringify({
          userId: result.userId,
          businessId: result.businessId,
        }), { status: 201, headers })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        const token = getCookie(request, SESSION_COOKIE_NAME)
        if (token) {
          const current = await authService.session(token)
          if (current) await authRepository.revokeSession(current.sessionId, current.userId, Date.now())
        }
        const headers = responseHeaders()
        headers.append('Set-Cookie', clearSessionCookie(env))
        return new Response(JSON.stringify({ loggedOut: true }), { headers })
      }

      const token = getCookie(request, SESSION_COOKIE_NAME)
      const auth = token ? await authService.session(token) : null
      if (!auth) return jsonError('Unauthorized', 401)

      if (request.method === 'GET' && url.pathname === '/api/auth/session') {
        return Response.json({
          user: { id: auth.userId, username: auth.username, displayName: auth.displayName },
          activeBusinessId: auth.businessId,
          memberships: await authRepository.listMemberships(auth.userId),
        })
      }
      if (request.method === 'POST' && url.pathname === '/api/telemetry/frontend-error') {
        const parsed = frontendDiagnosticSchema.parse(await readJson(request))
        logProductEvent(
          request,
          env,
          'frontend_error_reported',
          202,
          parsed.errorCode,
          parsed.errorType,
        )
        return Response.json({ accepted: true }, { status: 202 })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/select-business') {
        const parsed = selectBusinessSchema.parse(await readJson(request))
        const role = await authService.selectBusiness(auth.sessionId, auth.userId, parsed.businessId)
        if (!role) return jsonError('Business membership not found', 403)
        return Response.json({ businessId: parsed.businessId, role })
      }

      const businessId = auth.businessId
      if (businessId === null) return jsonError('Select a business before continuing', 409)

      if (request.method === 'POST' && url.pathname === '/api/auth/invitations') {
        if (auth.role !== 'owner') return jsonError('Owner access required', 403)
        const parsed = createInvitationSchema.parse(await readJson(request))
        const invitation = await authService.createInvitation(
          businessId,
          auth.userId,
          parsed.expiresInHours,
        )
        return Response.json(invitation, { status: 201 })
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/members') {
        if (auth.role !== 'owner') return jsonError('Owner access required', 403)
        return Response.json({ members: await authRepository.listMembers(businessId) })
      }
      const memberMatch = url.pathname.match(/^\/api\/auth\/members\/(\d+)\/deactivate$/)
      if (request.method === 'POST' && memberMatch) {
        if (auth.role !== 'owner') return jsonError('Owner access required', 403)
        const deactivated = await authRepository.deactivateMember(
          businessId,
          Number(memberMatch[1]),
          auth.userId,
          Date.now(),
        )
        if (!deactivated) return jsonError('Member not found or cannot be deactivated', 404)
        return Response.json({ deactivated: true })
      }
      if (request.method === 'POST' && url.pathname === '/api/businesses') {
        if (auth.role !== 'owner') return jsonError('Owner access required', 403)
        const parsed = createBusinessSchema.parse(await readJson(request))
        const newBusinessId = await authRepository.createBusinessForUser({
          ...parsed,
          userId: auth.userId,
          now: Date.now(),
        })
        return Response.json({ businessId: newBusinessId }, { status: 201 })
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        const service = new HealthService(new HealthRepository(env.DB))
        const response = await service.getHealth(env.APP_ENV)
        const validated = healthResponseSchema.parse(response)
        return Response.json(validated)
      }

      if (request.method === 'GET' && url.pathname === '/api/audit/purchases') {
        const query = purchaseAuditQuerySchema.parse({
          purchaseId: url.searchParams.get('purchaseId') ?? undefined,
          beforeId: url.searchParams.get('beforeId') ?? undefined,
        })
        const page = await new PurchaseAuditRepository(env.DB).list(
          businessId,
          query.purchaseId,
          query.beforeId,
        )
        return Response.json(page)
      }

      if (request.method === 'GET' && url.pathname === '/api/categories') {
        const categories = await new CategoryRepository(env.DB).listActive(businessId)
        return Response.json({ categories })
      }

      const exportMatch = url.pathname.match(/^\/api\/exports\/(purchases|purchase-items|categories|items)\.csv$/)
      if (request.method === 'GET' && exportMatch) {
        const exports = new ExportRepository(env.DB)
        const kind = exportMatch[1]
        const csv =
          kind === 'purchases' ? await exports.purchases(businessId)
          : kind === 'purchase-items' ? await exports.purchaseItems(businessId)
          : kind === 'categories' ? await exports.categories(businessId)
          : await exports.items(businessId)
        const headers = responseHeaders('text/csv; charset=utf-8')
        headers.set('Content-Disposition', `attachment; filename="${kind}.csv"`)
        logProductEvent(request, env, 'csv_exported')
        return new Response(csv, { headers })
      }

      if (request.method === 'GET' && url.pathname === '/api/items') {
        const includeInactive = url.searchParams.get('includeInactive') === 'true'
        const items = await new ItemService(
          new ItemRepository(env.DB),
          new CategoryRepository(env.DB),
        ).list(businessId, includeInactive)
        return Response.json({ items })
      }

      if (request.method === 'POST' && url.pathname === '/api/items') {
        const body = await readJson(request)
        const parsed = createItemSchema.parse(body)
        const item = await new ItemService(
          new ItemRepository(env.DB),
          new CategoryRepository(env.DB),
        ).create({
          businessId,
          categoryId: parsed.categoryId as number,
          name: parsed.name,
          defaultUnit: parsed.defaultUnit,
        })
        return Response.json({ item }, { status: 201 })
      }

      if (request.method === 'POST' && url.pathname === '/api/purchases') {
        const body = await readJson(request)
        const parsed = createPurchaseSchema.parse(body)
        const purchase = new PurchaseRepository(env.DB)
        const purchaseId = await purchase.createPurchase(parsed, businessId, auth.userId)
        const detail = await purchase.getById(purchaseId, businessId)
        logProductEvent(request, env, 'purchase_created')
        return Response.json({ purchase: detail }, { status: 201 })
      }

      if (request.method === 'GET' && url.pathname === '/api/purchases') {
        const filters = {
          itemName: url.searchParams.get('itemName')?.trim() || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined,
          categoryId: url.searchParams.has('categoryId')
            ? Number(url.searchParams.get('categoryId'))
            : undefined,
        }
        const purchases = await new PurchaseRepository(env.DB).list(businessId, filters)
        return Response.json({ purchases })
      }

      if (request.method === 'GET' && url.pathname === '/api/analytics') {
        const parsed = analyticsQuerySchema.parse({
          preset: url.searchParams.get('preset') ?? 'month',
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          categoryId: url.searchParams.get('categoryId') ?? undefined,
          itemId: url.searchParams.get('itemId') ?? undefined,
          today: url.searchParams.get('today') ?? undefined,
        })
        const today = parsed.today ?? new Date().toISOString().slice(0, 10)
        const range = getDateRange(parsed.preset, today, parsed.from, parsed.to)
        const repository = new AnalyticsRepository(env.DB)
        const [
          summary,
          categories,
          items,
          trend,
          itemHistory,
          previousCategories,
          historicalDailyTotals,
          unitPrices,
        ] = await Promise.all([
          repository.getSummary(businessId, range),
          repository.getCategories(businessId, range),
          repository.getItems(businessId, range, parsed.categoryId),
          repository.getTrend(businessId, range),
          parsed.itemId
            ? repository.getItemHistory(businessId, range, parsed.itemId)
            : Promise.resolve({ compatibleUnits: [], history: [] }),
          repository.getCategoriesForPeriod(
            businessId,
            range.previousFrom,
            range.previousTo,
          ),
          repository.getHistoricalDailyTotals(businessId, range.from),
          repository.getCompatibleUnitPrices(businessId, range.from),
        ])
        const insights = generateSpendingInsights({
          totalPaise: summary.totalPaise,
          sessionCount: summary.sessionCount,
          categories,
          previousCategories,
          items,
          historicalDailyTotals,
          unitPrices,
          currentPeriodDayCount: summary.dayCount,
          currentPeriodAveragePaise: summary.averageDailyPaise,
        })
        logProductEvent(request, env, 'dashboard_viewed')
        return Response.json({
          range,
          summary,
          categories,
          items,
          trend,
          topItems: items.slice(0, 5),
          itemHistory,
          insights,
        })
      }

      const purchaseMatch = url.pathname.match(/^\/api\/purchases\/(\d+)$/)
      if (purchaseMatch) {
        const purchaseId = Number(purchaseMatch[1])
        const repository = new PurchaseRepository(env.DB)
        if (request.method === 'GET') {
          const purchase = await repository.getById(purchaseId, businessId)
          if (!purchase) return jsonError('Purchase not found', 404)
          return Response.json({ purchase })
        }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          const parsed = updatePurchaseSchema.parse(body)
          await repository.updatePurchase(purchaseId, parsed, businessId, auth.userId)
          const purchase = await repository.getById(purchaseId, businessId)
          logProductEvent(request, env, 'purchase_updated')
          return Response.json({ purchase })
        }
        if (request.method === 'DELETE') {
          const parsed = deletePurchaseSchema.parse(await readJson(request))
          const deleted = await repository.deletePurchase(
            purchaseId,
            businessId,
            parsed.version,
            auth.userId,
          )
          if (!deleted) return jsonError('Purchase not found', 404)
          logProductEvent(request, env, 'purchase_deleted')
          return Response.json({ deleted: true })
        }
      }

      const deactivateMatch = url.pathname.match(/^\/api\/items\/(\d+)\/deactivate$/)
      if (request.method === 'POST' && deactivateMatch) {
        const item = await new ItemService(
          new ItemRepository(env.DB),
          new CategoryRepository(env.DB),
        ).deactivate(Number(deactivateMatch[1]), businessId)
        return Response.json({ item })
      }
    } catch (error) {
      if (error instanceof RegistrationFailure) {
        logInternalError(request, env, error, error.stage)
        return jsonError('Internal server error', 500)
      }
      if (error instanceof AuthError) {
        return jsonError(error.message, error.status)
      }
      if (error instanceof ZodError) {
        return jsonError(error.issues[0]?.message ?? 'Invalid request')
      }
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('No business')) {
          return jsonError(error.message, 404)
        }
        if (
          error.message.includes('already exists') ||
          error.message.includes('UNIQUE constraint failed')
        ) {
          return jsonError('The requested record already exists', 409)
        }
        if (error.message.includes('changed by another user')) {
          return jsonError(error.message, 409)
        }
        if (error.message === 'Invalid JSON body') {
          return jsonError('Invalid JSON body')
        }
        if (
          error.message === 'invitation_invalid' ||
          error.message.includes('invalid or inactive') ||
          error.message.includes('does not belong') ||
          error.message.includes('details are required') ||
          error.message.includes('must contain at least one item')
        ) {
          return jsonError(error.message)
        }
      }
      logInternalError(request, env, error)
      return jsonError('Internal server error', 500)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = getRequestId(request.headers.get('X-Request-ID'))
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('X-Request-ID', requestId)
    const instrumentedRequest = new Request(request, { headers: requestHeaders })
    const startedAt = performance.now()
    let response: Response
    let errorCode: string | null = null

    try {
      response = await routeHandler.fetch(instrumentedRequest, env)
    } catch {
      errorCode = 'worker_unhandled_error'
      response = jsonError('Internal server error', 500)
    }

    const durationMs = performance.now() - startedAt
    const headers = new Headers(response.headers)
    headers.set('X-Request-ID', requestId)
    const completedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })

    if (new URL(request.url).pathname.startsWith('/api/')) {
      try {
        emitStructuredLog({
          ...buildRequestLog({
            appVersion: env.APP_VERSION,
            requestId,
            method: request.method,
            path: new URL(request.url).pathname,
            status: response.status,
            durationMs,
            userAgent: request.headers.get('User-Agent'),
            errorCode: errorCode ?? statusErrorCode(response.status),
          }),
          type: 'request',
        })
      } catch {
        // Request logging is best-effort and must not alter the response.
      }
    }
    return completedResponse
  },
} satisfies ExportedHandler<Env>

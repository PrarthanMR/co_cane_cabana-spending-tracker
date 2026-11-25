import { HealthRepository } from './repositories/healthRepository'
import { healthResponseSchema } from './schemas/health'
import { HealthService } from './services/healthService'
import { CategoryRepository } from './repositories/categoryRepository'
import { ItemRepository } from './repositories/itemRepository'
import { BusinessRepository } from './repositories/businessRepository'
import { ItemService } from './services/itemService'
import { createItemSchema } from './schemas/item'
import { createPurchaseSchema } from './schemas/purchase'
import { PurchaseRepository } from './repositories/purchaseRepository'
import { AnalyticsRepository } from './repositories/analyticsRepository'
import { analyticsQuerySchema } from './schemas/analytics'
import { getDateRange } from './services/dateRange'
import { generateSpendingInsights } from './services/spendingInsights'
import { ExportRepository } from './repositories/exportRepository'
import { ZodError } from 'zod'
import type { Env } from './types'

function jsonError(message: string, status = 400): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function isAuthorized(request: Request, env: Env): boolean {
  if (env.APP_ENV !== 'production') {
    const localToken = env.OWNER_ACCESS_TOKEN ?? 'local-development-owner-token'
    const header = request.headers.get('Authorization')
    return header === `Bearer ${localToken}` || request.headers.get('X-Owner-Key') === localToken
  }
  if (!env.OWNER_ACCESS_TOKEN) return false
  return request.headers.get('Authorization') === `Bearer ${env.OWNER_ACCESS_TOKEN}`
}

function responseHeaders(contentType = 'application/json'): Headers {
  const headers = new Headers({ 'Content-Type': contentType })
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'no-referrer')
  return headers
}

async function readJson(request: Request) {
  try {
    return await request.json()
  } catch {
    throw new Error('Invalid JSON body')
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (!isAuthorized(request, env)) {
      return jsonError('Unauthorized', 401)
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      const service = new HealthService(new HealthRepository(env.DB))
      const response = await service.getHealth(env.APP_ENV)
      const validated = healthResponseSchema.parse(response)

      return Response.json(validated)
    }

    try {
      let requestedBusinessId = url.searchParams.get('businessId')
        ? Number(url.searchParams.get('businessId'))
        : undefined
      if (env.OWNER_BUSINESS_ID) {
        const ownerBusinessId = Number(env.OWNER_BUSINESS_ID)
        if (!Number.isInteger(ownerBusinessId) || ownerBusinessId <= 0) {
          throw new Error('Invalid owner business configuration')
        }
        if (requestedBusinessId !== undefined && requestedBusinessId !== ownerBusinessId) {
          return jsonError('Forbidden business access', 403)
        }
        requestedBusinessId = ownerBusinessId
      }
      const businessRepository = new BusinessRepository(env.DB)

      if (request.method === 'GET' && url.pathname === '/api/categories') {
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
        const categories = await new CategoryRepository(env.DB).listActive(businessId)
        return Response.json({ categories })
      }

      const exportMatch = url.pathname.match(/^\/api\/exports\/(purchases|purchase-items|categories|items)\.csv$/)
      if (request.method === 'GET' && exportMatch) {
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
        const exports = new ExportRepository(env.DB)
        const kind = exportMatch[1]
        const csv =
          kind === 'purchases' ? await exports.purchases(businessId)
          : kind === 'purchase-items' ? await exports.purchaseItems(businessId)
          : kind === 'categories' ? await exports.categories(businessId)
          : await exports.items(businessId)
        const headers = responseHeaders('text/csv; charset=utf-8')
        headers.set('Content-Disposition', `attachment; filename="${kind}.csv"`)
        return new Response(csv, { headers })
      }

      if (request.method === 'GET' && url.pathname === '/api/items') {
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
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
        const businessId = await businessRepository.resolveBusinessId(parsed.businessId)
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
        const businessId = await businessRepository.resolveBusinessId(parsed.businessId)
        const purchase = new PurchaseRepository(env.DB)
        const purchaseId = await purchase.createPurchase(parsed, businessId)
        const detail = await purchase.getById(purchaseId, businessId)
        return Response.json({ purchase: detail }, { status: 201 })
      }

      if (request.method === 'GET' && url.pathname === '/api/purchases') {
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
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
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
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
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
        const repository = new PurchaseRepository(env.DB)
        if (request.method === 'GET') {
          const purchase = await repository.getById(purchaseId, businessId)
          if (!purchase) return jsonError('Purchase not found', 404)
          return Response.json({ purchase })
        }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          const parsed = createPurchaseSchema.parse(body)
          await repository.updatePurchase(purchaseId, parsed, businessId)
          const purchase = await repository.getById(purchaseId, businessId)
          return Response.json({ purchase })
        }
        if (request.method === 'DELETE') {
          const deleted = await repository.deletePurchase(purchaseId, businessId)
          if (!deleted) return jsonError('Purchase not found', 404)
          return Response.json({ deleted: true })
        }
      }

      const deactivateMatch = url.pathname.match(/^\/api\/items\/(\d+)\/deactivate$/)
      if (request.method === 'POST' && deactivateMatch) {
        const businessId = await businessRepository.resolveBusinessId(requestedBusinessId)
        const item = await new ItemService(
          new ItemRepository(env.DB),
          new CategoryRepository(env.DB),
        ).deactivate(Number(deactivateMatch[1]), businessId)
        return Response.json({ item })
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return jsonError(error.issues[0]?.message ?? 'Invalid request')
      }
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('No business')) {
          return jsonError(error.message, 404)
        }
        if (error.message.includes('already exists')) {
          return jsonError(error.message, 409)
        }
        if (error.message.includes('Invalid JSON')) {
          return jsonError(error.message)
        }
        return jsonError(error.message)
      }
      return jsonError('Internal server error', 500)
    }

    if (request.method === 'GET' && env.ASSETS && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>

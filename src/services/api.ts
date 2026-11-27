import { z } from 'zod'
import { createRequestId } from './diagnostics'

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  environment: z.string(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health')
}

export interface Category {
  id: number
  businessId: number
  name: string
  isActive: boolean
}

export interface Item {
  id: number
  businessId: number
  categoryId: number
  categoryName: string
  name: string
  defaultUnit: string | null
  isActive: boolean
}

export interface PurchaseItemInput {
  itemId?: number
  newItem?: {
    name: string
    categoryId: number
    defaultUnit?: string
  }
  quantity?: number
  unit?: string
  amountPaise: number
}

export interface PurchaseInput {
  businessId?: number
  purchaseDate: string
  supplierName?: string
  notes?: string
  items: PurchaseItemInput[]
}

export interface PurchaseSummary {
  id: number
  businessId: number
  purchaseDate: string
  supplierName: string | null
  notes: string | null
  totalAmountPaise: number
  version: number
}

export interface PurchaseDetail extends PurchaseSummary {
  createdBy: string | null
  updatedBy: string | null
  items: Array<{
    id: number
    itemId: number
    categoryId: number
    itemNameSnapshot: string
    categoryNameSnapshot: string
    quantity: number | null
    unit: string | null
    amountPaise: number
  }>
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const requestId = createRequestId()
  headers.set('X-Request-ID', requestId)
  let response: Response
  try {
    response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new ApiRequestError('Unable to reach the API', requestId, 0)
  }
  const responseRequestId = response.headers.get('X-Request-ID') ?? requestId
  const body = await response.json().catch(() => ({ error: 'Invalid server response' }))
  if (!response.ok) {
    throw new ApiRequestError(
      typeof body.error === 'string' ? body.error : 'Request failed',
      responseRequestId,
      response.status,
    )
  }
  return body as T
}

export class ApiRequestError extends Error {
  readonly requestId: string
  readonly status: number

  constructor(
    message: string,
    requestId: string,
    status: number,
  ) {
    super(message)
    this.requestId = requestId
    this.status = status
  }
}

export interface AuthSession {
  user: { id: number; username: string; displayName: string }
  activeBusinessId: number | null
  memberships: Array<{
    businessId: number
    businessName: string
    currencyCode: string
    role: 'owner' | 'member'
  }>
}

export async function getAuthStatus() {
  return request<{ registrationComplete: boolean }>('/api/auth/status')
}

export async function getAuthSession() {
  return request<AuthSession>('/api/auth/session')
}

export async function registerOwner(input: {
  bootstrapToken: string
  businessName: string
  username: string
  displayName: string
  pin: string
}) {
  return request<{ userId: number; businessId: number }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function login(input: { username: string; pin: string }) {
  return request<{ userId: number; businessId: number | null }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function joinBusiness(input: {
  invitationCode: string
  username: string
  displayName: string
  pin: string
}) {
  return request<{ userId: number; businessId: number }>('/api/auth/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function logout() {
  return request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' })
}

export async function selectBusiness(businessId: number) {
  return request<{ businessId: number; role: 'owner' | 'member' }>('/api/auth/select-business', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId }),
  })
}

export async function createInvitation(expiresInHours = 24) {
  return request<{ code: string; expiresAt: number }>('/api/auth/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresInHours }),
  })
}

export async function getMembers() {
  return request<{ members: Array<{
    userId: number
    username: string
    displayName: string
    role: 'owner' | 'member'
    joinedAt: number
  }> }>('/api/auth/members')
}

export async function deactivateMember(userId: number) {
  return request<{ deactivated: boolean }>(`/api/auth/members/${userId}/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export async function getCategories(): Promise<Category[]> {
  const body = await request<{ categories: Category[] }>('/api/categories')
  return body.categories
}

export async function getItems(includeInactive = false): Promise<Item[]> {
  const body = await request<{ items: Item[] }>(
    `/api/items${includeInactive ? '?includeInactive=true' : ''}`,
  )
  return body.items
}

export async function createItem(input: {
  name: string
  categoryId: number
  defaultUnit?: string
}) {
  return request<{ item: Item }>('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function createPurchase(input: PurchaseInput) {
  return request<{ purchase: PurchaseDetail }>('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function getPurchases(filters: {
  itemName?: string
  from?: string
  to?: string
  categoryId?: number
}) {
  const params = new URLSearchParams()
  if (filters.itemName) params.set('itemName', filters.itemName)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.categoryId) params.set('categoryId', String(filters.categoryId))
  const query = params.toString()
  return request<{ purchases: PurchaseSummary[] }>(
    `/api/purchases${query ? `?${query}` : ''}`,
  )
}

export async function getPurchase(id: number) {
  return request<{ purchase: PurchaseDetail }>(`/api/purchases/${id}`)
}

export interface PurchaseAuditEvent {
  id: number
  purchaseId: number
  version: number
  action: 'created' | 'updated' | 'deleted' | 'legacy_baseline'
  actorUserId: number | null
  actorDisplayName: string
  occurredAt: number
}

export async function getPurchaseAuditEvents(purchaseId?: number, beforeId?: number) {
  const params = new URLSearchParams()
  if (purchaseId) params.set('purchaseId', String(purchaseId))
  if (beforeId) params.set('beforeId', String(beforeId))
  const query = params.toString()
  return request<{ events: PurchaseAuditEvent[]; hasMore: boolean }>(
    `/api/audit/purchases${query ? `?${query}` : ''}`,
  )
}

export async function updatePurchase(id: number, input: PurchaseInput & { version: number }) {
  return request<{ purchase: PurchaseDetail }>(`/api/purchases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deletePurchase(id: number, version: number) {
  return request<{ deleted: boolean }>(`/api/purchases/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  })
}

export interface AnalyticsData {
  range: {
    from: string
    to: string
    previousFrom: string
    previousTo: string
  }
  summary: {
    totalPaise: number
    previousPeriodPaise: number
    changePaise: number
    changePercent: number | null
    sessionCount: number
    previousSessionCount: number
    averageDailyPaise: number
    dayCount: number
  }
  categories: Array<{ categoryId: number; name: string; amountPaise: number }>
  items: Array<{
    itemId: number
    name: string
    categoryId: number
    amountPaise: number
    purchaseCount: number
  }>
  trend: Array<{ label: string; amountPaise: number }>
  topItems: Array<{
    itemId: number
    name: string
    categoryId: number
    amountPaise: number
    purchaseCount: number
  }>
  itemHistory: {
    compatibleUnits: string[]
    history: Array<{
      purchaseId: number
      purchaseDate: string
      itemName: string
      categoryName: string
      quantity: number | null
      unit: string | null
      amountPaise: number
      unitPricePaise: number | null
      unitPriceUnit: string | null
    }>
  }
  insights: Array<{
    type: 'top_category' | 'top_item' | 'category_change' | 'unit_price_change' | 'unusual_spending'
    title: string
    description: string
    evidence: Record<string, string | number | null>
  }>
}

export async function getAnalytics(filters: {
  preset: 'today' | 'week' | 'month' | 'last-month' | 'custom'
  from?: string
  to?: string
  categoryId?: number
  itemId?: number
}) {
  const params = new URLSearchParams({ preset: filters.preset })
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.categoryId) params.set('categoryId', String(filters.categoryId))
  if (filters.itemId) params.set('itemId', String(filters.itemId))
  return request<AnalyticsData>(`/api/analytics?${params.toString()}`)
}

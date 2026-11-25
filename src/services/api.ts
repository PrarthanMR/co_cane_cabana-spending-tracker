import { z } from 'zod'

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  environment: z.string(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export async function getHealth(): Promise<HealthResponse> {
  const ownerKey = sessionStorage.getItem('ownerAccessToken')
  const headers = new Headers()
  if (ownerKey) headers.set('Authorization', `Bearer ${ownerKey}`)
  const response = await fetch('/api/health', { headers })
  if (!response.ok) throw new Error('Unable to reach the API')
  return healthResponseSchema.parse(await response.json())
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
}

export interface PurchaseDetail extends PurchaseSummary {
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
  const ownerKey = sessionStorage.getItem('ownerAccessToken')
  const headers = new Headers(init?.headers)
  if (ownerKey) headers.set('Authorization', `Bearer ${ownerKey}`)
  const response = await fetch(url, { ...init, headers })
  const body = await response.json().catch(() => ({ error: 'Invalid server response' }))
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Request failed')
  }
  return body as T
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

export async function updatePurchase(id: number, input: PurchaseInput) {
  return request<{ purchase: PurchaseDetail }>(`/api/purchases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deletePurchase(id: number) {
  return request<{ deleted: boolean }>(`/api/purchases/${id}`, {
    method: 'DELETE',
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

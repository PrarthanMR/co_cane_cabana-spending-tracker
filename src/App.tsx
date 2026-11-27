import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createPurchase,
  deletePurchase,
  getCategories,
  getItems,
  getPurchase,
  getPurchaseAuditEvents,
  getPurchases,
  updatePurchase,
  type Category,
  type Item,
  type PurchaseDetail,
  type PurchaseSummary,
  type PurchaseItemInput,
  getAnalytics,
  type AnalyticsData,
} from './services/api'
import { CategoryChart, ItemRankingChart, TrendChart } from './components/Charts'
import { AuthGate } from './components/AuthGate'
import { createRequestId } from './services/diagnostics'

interface LineDraft {
  name: string
  itemId?: number
  categoryId: number
  newItem: boolean
  quantity: string
  unit: string
  amountRupees: string
}

const today = () => new Date().toISOString().slice(0, 10)
const formatMoney = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100)

function PurchaseForm({
  categories,
  items,
  initial,
  onSaved,
  onCancel,
}: {
  categories: Category[]
  items: Item[]
  initial?: PurchaseDetail
  onSaved: () => void
  onCancel?: () => void
}) {
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate ?? today())
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [lines, setLines] = useState<LineDraft[]>(
    initial?.items.map((line) => ({
      name: line.itemNameSnapshot,
      itemId: line.itemId,
      categoryId: line.categoryId,
      newItem: false,
      quantity: line.quantity?.toString() ?? '',
      unit: line.unit ?? '',
      amountRupees: (line.amountPaise / 100).toFixed(2),
    })) ?? [{
      name: '',
      categoryId: categories[0]?.id ?? 0,
      newItem: false,
      quantity: '',
      unit: '',
      amountRupees: '',
    }],
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const totalPaise = lines.reduce(
    (total, line) => total + Math.round((Number(line.amountRupees) || 0) * 100),
    0,
  )

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...patch } : line,
    ))
  }

  function selectName(index: number, name: string) {
    const item = items.find((candidate) =>
      candidate.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    )
    if (item) {
      updateLine(index, {
        name,
        itemId: item.id,
        categoryId: item.categoryId,
        newItem: false,
        unit: item.defaultUnit ?? '',
      })
    } else {
      updateLine(index, { name, itemId: undefined })
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (lines.length === 0) {
      setError('Add at least one item')
      return
    }

    const itemsInput: PurchaseItemInput[] = lines.map((line) => {
      const amountPaise = Math.round((Number(line.amountRupees) || 0) * 100)
      const quantity = line.quantity.trim() ? Number(line.quantity) : undefined
      return {
        ...(line.itemId && !line.newItem
          ? { itemId: line.itemId }
          : {
              newItem: {
                name: line.name.trim(),
                categoryId: line.categoryId,
                ...(line.unit.trim() ? { defaultUnit: line.unit.trim() } : {}),
              },
            }),
        ...(quantity !== undefined ? { quantity } : {}),
        ...(line.unit.trim() ? { unit: line.unit.trim() } : {}),
        amountPaise,
      }
    })

    if (itemsInput.some((line) => !line.itemId && !line.newItem?.name)) {
      setError('Enter an item name')
      return
    }
    if (itemsInput.some((line) => line.amountPaise <= 0)) {
      setError('Every item must have an amount')
      return
    }

    setSaving(true)
    try {
      if (initial) {
        await updatePurchase(initial.id, {
          version: initial.version,
          purchaseDate,
          ...(supplierName.trim() ? { supplierName: supplierName.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          items: itemsInput,
        })
      } else {
        await createPurchase({
          purchaseDate,
          ...(supplierName.trim() ? { supplierName: supplierName.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          items: itemsInput,
        })
      }
      setLines([{
        name: '',
        categoryId: categories[0]?.id ?? 0,
        newItem: false,
        quantity: '',
        unit: '',
        amountRupees: '',
      }])
      setSupplierName('')
      setNotes('')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save purchase')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Purchase date
          <input
            type="date"
            value={purchaseDate}
            onChange={(event) => setPurchaseDate(event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Supplier <span className="font-normal text-slate-400">(optional)</span>
          <input
            value={supplierName}
            onChange={(event) => setSupplierName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <label className="text-sm font-medium text-slate-700">
                Item
                <input
                  list="item-suggestions"
                  value={line.name}
                  onChange={(event) => selectName(index, event.target.value)}
                  placeholder="Search or enter item"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  required
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Category
                {line.itemId && !line.newItem ? (
                  <input
                    value={categories.find((category) => category.id === line.categoryId)?.name ?? ''}
                    readOnly
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2"
                  />
                ) : (
                  <select
                    value={line.categoryId}
                    onChange={(event) => updateLine(index, {
                      categoryId: Number(event.target.value),
                      newItem: true,
                    })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                )}
              </label>
              <label className="text-sm font-medium text-slate-700">
                Quantity <span className="font-normal text-slate-400">(optional)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Unit <span className="font-normal text-slate-400">(optional)</span>
                <input
                  value={line.unit}
                  onChange={(event) => updateLine(index, { unit: event.target.value, newItem: line.itemId ? line.newItem : true })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Amount (₹)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.amountRupees}
                  onChange={(event) => updateLine(index, { amountRupees: event.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                className="mt-2 text-sm font-medium text-red-600"
              >
                Remove item
              </button>
            )}
          </div>
        ))}
      </div>

      <datalist id="item-suggestions">
        {items.map((item) => <option key={item.id} value={item.name} />)}
      </datalist>

      <button
        type="button"
        onClick={() => setLines((current) => [...current, {
          name: '',
          categoryId: categories[0]?.id ?? 0,
          newItem: true,
          quantity: '',
          unit: '',
          amountRupees: '',
        }])}
        className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700"
      >
        + Add item
      </button>

      <label className="block text-sm font-medium text-slate-700">
        Notes <span className="font-normal text-slate-400">(optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
        />
      </label>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-lg font-bold">Total: {formatMoney(totalPaise)}</p>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving...' : initial ? 'Save changes' : 'Save purchase'}
          </button>
        </div>
      </div>
    </form>
  )
}

function Dashboard() {
  const [preset, setPreset] = useState<'today' | 'week' | 'month' | 'last-month' | 'custom'>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [categoryId, setCategoryId] = useState<number>()
  const [itemId, setItemId] = useState<number>()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      setData(await getAnalytics({
        preset,
        ...(preset === 'custom' ? { from, to } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(itemId ? { itemId } : {}),
      }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load analytics')
    }
  }

  useEffect(() => {
    if (preset !== 'custom' || (from && to)) void load()
  }, [preset, from, to, categoryId, itemId])

  const money = (paise: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100)
  const change = data?.summary.changePercent ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-end">
        {([
          ['today', 'Today'],
          ['week', 'This week'],
          ['month', 'This month'],
          ['last-month', 'Last month'],
          ['custom', 'Custom'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setCategoryId(undefined)
              setItemId(undefined)
              setPreset(value)
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              preset === value ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Total spending', money(data.summary.totalPaise)],
              [
                'Previous period',
                `${change === null ? 'No previous spending' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`} (${money(data.summary.previousPeriodPaise)})`,
              ],
              ['Purchase sessions', String(data.summary.sessionCount)],
              ['Average daily spending', money(data.summary.averageDailyPaise)],
            ].map(([label, value]) => (
              <article key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
              </article>
            ))}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-bold">Spending observations</h2>
            {data.insights.length === 0 ? (
              <p className="text-sm text-slate-500">
                No strong spending observations yet. More data or a longer comparison period may be needed.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.insights.map((insight, index) => (
                  <article key={`${insight.type}-${index}`} className="rounded-lg border border-slate-200 p-4">
                    <h3 className="font-semibold text-slate-900">{insight.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{insight.description}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
                      {Object.entries(insight.evidence).map(([key, value]) => (
                        <div key={key}>
                          <dt className="inline">{key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())}: </dt>
                          <dd className="inline font-medium text-slate-700">
                            {typeof value === 'number' &&
                            (key.toLowerCase().includes('paise') ||
                              key.toLowerCase().includes('total') ||
                              key.toLowerCase().includes('current') ||
                              key.toLowerCase().includes('previous') ||
                              key.toLowerCase().includes('threshold'))
                              ? money(value)
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>

          {categoryId !== undefined && (
            <button
              type="button"
              onClick={() => {
                setCategoryId(undefined)
                setItemId(undefined)
              }}
              className="text-sm font-semibold text-emerald-700"
            >
              ← Back to all categories
            </button>
          )}
          {itemId !== undefined && (
            <button
              type="button"
              onClick={() => setItemId(undefined)}
              className="text-sm font-semibold text-emerald-700"
            >
              ← Back to item ranking
            </button>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-bold">Spending by category</h2>
              <CategoryChart
                data={data.categories}
                onSelect={(selected) => {
                  setCategoryId(selected)
                  setItemId(undefined)
                }}
              />
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-bold">{categoryId ? 'Items in category' : 'Item spending ranking'}</h2>
              <ItemRankingChart
                data={data.items}
                onSelect={(selected) => setItemId(selected)}
              />
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-bold">Spending trend</h2>
            <TrendChart data={data.trend} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-bold">Top five highest-spending items</h2>
            {data.topItems.length === 0 ? (
              <p className="text-sm text-slate-500">No item spending in this range</p>
            ) : (
              <div className="space-y-2">
                {data.topItems.map((item, index) => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => setItemId(item.itemId)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-3 text-left"
                  >
                    <span><strong>{index + 1}.</strong> {item.name}</span>
                    <span className="font-bold">{money(item.amountPaise)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {itemId && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-bold">Item purchase history</h2>
              {data.itemHistory.history.length === 0 ? (
                <p className="text-sm text-slate-500">No purchases for this item in the selected range</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2">Date</th>
                        <th>Category</th>
                        <th>Quantity</th>
                        <th>Total</th>
                        <th>Unit price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.itemHistory.history.map((row) => (
                        <tr key={row.purchaseId} className="border-b border-slate-100 last:border-0">
                          <td className="py-3">{row.purchaseDate}</td>
                          <td>{row.categoryName}</td>
                          <td>{row.quantity === null ? '-' : `${row.quantity}${row.unit ? ` ${row.unit}` : ''}`}</td>
                          <td>{money(row.amountPaise)}</td>
                          <td>
                            {row.unitPricePaise === null
                              ? '-'
                              : `${money(row.unitPricePaise)} / ${row.unitPriceUnit}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function App() {
  return <AuthGate><AuthenticatedApp /></AuthGate>
}

function AuditHistory() {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getPurchaseAuditEvents>>['events']>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getPurchaseAuditEvents()
      .then(({ events: entries, hasMore: more }) => {
        setEvents(entries)
        setHasMore(more)
      })
      .catch((caught: unknown) => setError(
        caught instanceof Error ? caught.message : 'Unable to load audit history',
      ))
      .finally(() => setLoading(false))
  }, [])

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold">Purchase audit history</h2>
      <p className="mt-1 text-sm text-slate-500">
        Purchase changes and the member who made them where known. Deleted purchases remain listed.
      </p>
      {loading && <p className="mt-5 text-sm text-slate-500">Loading audit history…</p>}
      {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
      {!loading && !error && events.length === 0 && (
        <p className="mt-5 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No purchase changes recorded yet
        </p>
      )}
      {!loading && events.length > 0 && (
        <>
          <ol className="mt-5 divide-y divide-slate-100">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  <strong className="capitalize">
                    {event.action === 'legacy_baseline'
                      ? 'Existing purchase (history baseline)'
                      : event.action}
                  </strong>
                  {' '}purchase #{event.purchaseId}
                  <span className="text-slate-500"> · version {event.version}</span>
                </span>
                <span className="text-slate-600">
                  {event.actorDisplayName} · {new Date(event.occurredAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
          {hasMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => {
                const beforeId = events[events.length - 1]?.id
                if (!beforeId) return
                setLoadingMore(true)
                getPurchaseAuditEvents(undefined, beforeId)
                  .then(({ events: older, hasMore: more }) => {
                    setEvents((current) => [...current, ...older])
                    setHasMore(more)
                  })
                  .catch((caught: unknown) => setError(
                    caught instanceof Error ? caught.message : 'Unable to load older audit events',
                  ))
                  .finally(() => setLoadingMore(false))
              }}
              className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : 'Load older events'}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function AuthenticatedApp() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'entry' | 'history' | 'audit'>('dashboard')
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [expanded, setExpanded] = useState<Record<number, PurchaseDetail>>({})
  const [editing, setEditing] = useState<PurchaseDetail | null>(null)
  const [itemSearch, setItemSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [loadError, setLoadError] = useState('')

  async function loadLookups() {
    const [categoryRows, itemRows] = await Promise.all([getCategories(), getItems()])
    setCategories(categoryRows)
    setItems(itemRows)
  }

  async function loadPurchases() {
    try {
      const body = await getPurchases({
        itemName: itemSearch,
        from: dateFrom,
        to: dateTo,
        categoryId,
      })
      setPurchases(body.purchases)
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Unable to load purchases')
    }
  }

  useEffect(() => {
    void loadLookups().catch((caught) => setLoadError(caught instanceof Error ? caught.message : 'Unable to load data'))
  }, [])

  useEffect(() => {
    if (activeTab === 'history') void loadPurchases()
  }, [activeTab, itemSearch, dateFrom, dateTo, categoryId])

  async function togglePurchase(purchase: PurchaseSummary) {
    if (expanded[purchase.id]) {
      setExpanded((current) => {
        const next = { ...current }
        delete next[purchase.id]
        return next
      })
      return
    }
    try {
      const body = await getPurchase(purchase.id)
      setExpanded((current) => ({ ...current, [purchase.id]: body.purchase }))
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Unable to load purchase')
    }
  }

  async function removePurchase(purchase: PurchaseSummary) {
    if (!window.confirm(`Delete the purchase from ${purchase.purchaseDate}?`)) return
    try {
      await deletePurchase(purchase.id, purchase.version)
      setExpanded((current) => {
        const next = { ...current }
        delete next[purchase.id]
        return next
      })
      await loadPurchases()
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Unable to delete purchase')
    }
  }

  async function editPurchase(purchase: PurchaseSummary) {
    const body = await getPurchase(purchase.id)
    setEditing(body.purchase)
  }

  async function downloadCsv(kind: 'purchases' | 'purchase-items' | 'categories' | 'items') {
    const response = await fetch(`/api/exports/${kind}.csv`, {
      credentials: 'same-origin',
      headers: { 'X-Request-ID': createRequestId() },
    })
    if (!response.ok) throw new Error('Unable to export CSV')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${kind}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const editingItems = useMemo(() => items, [items])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Co Cane Cabana</p>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">Purchase Spending Tracker</h1>
        </div>
      </header>
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center px-4 sm:px-6">
          {(['dashboard', 'entry', 'history', 'audit'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-3 text-sm font-semibold ${
                activeTab === tab ? 'border-emerald-700 text-emerald-700' : 'border-transparent text-slate-500'
              }`}
            >
              {tab === 'dashboard' ? 'Dashboard'
                : tab === 'entry' ? 'New purchase'
                : tab === 'history' ? 'Purchase history'
                : 'Audit history'}
            </button>
          ))}
          <select
            aria-label="Export CSV"
            defaultValue=""
            onChange={(event) => {
              const kind = event.target.value as 'purchases' | 'purchase-items' | 'categories' | 'items'
              if (kind) void downloadCsv(kind).catch((error) => setLoadError(
                error instanceof Error ? error.message : 'Unable to export CSV',
              ))
              event.target.value = ''
            }}
            className="my-2 ml-auto rounded-lg border border-slate-300 px-2 py-2 text-sm"
          >
            <option value="" disabled>Export CSV</option>
            <option value="purchases">Purchases</option>
            <option value="purchase-items">Purchase items</option>
            <option value="categories">Categories</option>
            <option value="items">Items</option>
          </select>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {loadError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}

        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'audit' && <AuditHistory />}

        {activeTab === 'entry' && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-5 text-lg font-bold">Record a purchase</h2>
            <PurchaseForm
              categories={categories}
              items={items}
              onSaved={async () => {
                await loadLookups()
                await loadPurchases()
              }}
            />
          </section>
        )}

        {activeTab === 'history' && (
          <section className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
              <input
                value={itemSearch}
                onChange={(event) => setItemSearch(event.target.value)}
                placeholder="Search item"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={categoryId ?? ''}
                onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : undefined)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>

            {purchases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                No purchases found
              </div>
            ) : (
              purchases.map((purchase) => (
                <article key={purchase.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => void togglePurchase(purchase)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                  >
                    <div>
                      <p className="font-semibold">{purchase.purchaseDate}</p>
                      {purchase.supplierName && <p className="text-sm text-slate-500">{purchase.supplierName}</p>}
                    </div>
                    <p className="text-right text-lg font-bold text-emerald-700">
                      {formatMoney(purchase.totalAmountPaise)}
                    </p>
                  </button>
                  {expanded[purchase.id] && (
                    <div className="border-t border-slate-200 px-4 py-4">
                      {expanded[purchase.id].items.map((line) => (
                        <div key={line.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
                          <div>
                            <p className="font-medium">{line.itemNameSnapshot}</p>
                            <p className="text-slate-500">
                              {line.categoryNameSnapshot}
                              {line.quantity !== null ? ` · ${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : ''}
                            </p>
                          </div>
                          <p className="font-semibold">{formatMoney(line.amountPaise)}</p>
                        </div>
                      ))}
                      <div className="mt-3 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => void editPurchase(purchase)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void removePurchase(purchase)}
                          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))
            )}
          </section>
        )}

        {editing && (
          <div className="fixed inset-0 z-20 overflow-y-auto bg-slate-900/40 p-3 sm:p-6">
            <div className="mx-auto max-w-4xl rounded-xl bg-white p-4 shadow-xl sm:p-6">
              <h2 className="mb-5 text-lg font-bold">Edit purchase</h2>
              <PurchaseForm
                categories={categories}
                items={editingItems}
                initial={editing}
                onCancel={() => setEditing(null)}
                onSaved={async () => {
                  setEditing(null)
                  await loadLookups()
                  await loadPurchases()
                }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App

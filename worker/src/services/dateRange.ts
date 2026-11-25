export type AnalyticsPreset = 'today' | 'week' | 'month' | 'last-month' | 'custom'

export interface DateRange {
  from: string
  to: string
  previousFrom: string
  previousTo: string
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function getDateRange(
  preset: AnalyticsPreset,
  today: string,
  customFrom?: string,
  customTo?: string,
): DateRange {
  const anchor = new Date(`${today}T00:00:00Z`)
  let from: string
  let to: string

  if (preset === 'today') {
    from = today
    to = today
  } else if (preset === 'week') {
    const day = anchor.getUTCDay()
    const mondayOffset = day === 0 ? 6 : day - 1
    const monday = new Date(anchor)
    monday.setUTCDate(anchor.getUTCDate() - mondayOffset)
    from = formatDate(monday)
    to = today
  } else if (preset === 'month') {
    from = `${today.slice(0, 7)}-01`
    to = today
  } else if (preset === 'last-month') {
    const firstThisMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    const firstLastMonth = new Date(Date.UTC(firstThisMonth.getUTCFullYear(), firstThisMonth.getUTCMonth() - 1, 1))
    const lastLastMonth = new Date(Date.UTC(firstThisMonth.getUTCFullYear(), firstThisMonth.getUTCMonth(), 0))
    from = formatDate(firstLastMonth)
    to = formatDate(lastLastMonth)
  } else {
    from = customFrom ?? today
    to = customTo ?? from
  }

  if (from > to) {
    throw new Error('Date range start must be before or equal to date range end')
  }

  const fromDate = new Date(`${from}T00:00:00Z`)
  const toDate = new Date(`${to}T00:00:00Z`)
  const durationDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1
  const previousToDate = new Date(fromDate)
  previousToDate.setUTCDate(previousToDate.getUTCDate() - 1)
  const previousFromDate = new Date(previousToDate)
  previousFromDate.setUTCDate(previousFromDate.getUTCDate() - durationDays + 1)

  return {
    from,
    to,
    previousFrom: formatDate(previousFromDate),
    previousTo: formatDate(previousToDate),
  }
}

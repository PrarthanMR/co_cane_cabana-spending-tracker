export interface InsightEvidence {
  [key: string]: string | number | null
}

export interface SpendingInsight {
  type: 'top_category' | 'top_item' | 'category_change' | 'unit_price_change' | 'unusual_spending'
  title: string
  description: string
  evidence: InsightEvidence
}

export interface InsightInput {
  totalPaise: number
  sessionCount: number
  categories: Array<{ categoryId: number; name: string; amountPaise: number }>
  previousCategories: Array<{ categoryId: number; name: string; amountPaise: number }>
  items: Array<{ itemId: number; name: string; amountPaise: number; purchaseCount: number }>
  historicalDailyTotals: Array<{ date: string; amountPaise: number }>
  unitPrices: Array<{
    itemId: number
    name: string
    unit: string
    purchaseDate: string
    unitPricePaise: number
  }>
  currentPeriodDayCount: number
  currentPeriodAveragePaise: number
}

function percentChange(current: number, previous: number): number {
  if (previous <= 0) return 0
  return ((current - previous) / previous) * 100
}

export function generateSpendingInsights(input: InsightInput): SpendingInsight[] {
  const insights: SpendingInsight[] = []

  if (input.categories.length >= 1 && input.totalPaise > 0 && input.sessionCount >= 2) {
    const top = [...input.categories].sort((a, b) => b.amountPaise - a.amountPaise)[0]
    const share = (top.amountPaise / input.totalPaise) * 100
    insights.push({
      type: 'top_category',
      title: 'Largest spending category',
      description: `${top.name} contributed ${share.toFixed(1)}% of spending in this period.`,
      evidence: {
        category: top.name,
        amountPaise: top.amountPaise,
        totalPaise: input.totalPaise,
        sharePercent: Number(share.toFixed(1)),
      },
    })
  }

  if (input.items.length >= 2 && input.sessionCount >= 2) {
    const top = [...input.items].sort((a, b) => b.amountPaise - a.amountPaise)[0]
    const share = (top.amountPaise / input.totalPaise) * 100
    insights.push({
      type: 'top_item',
      title: 'Largest spending item',
      description: `${top.name} was the highest-spending item, across ${top.purchaseCount} purchase sessions.`,
      evidence: {
        item: top.name,
        amountPaise: top.amountPaise,
        purchaseSessions: top.purchaseCount,
        sharePercent: Number(share.toFixed(1)),
      },
    })
  }

  if (input.previousCategories.length >= 2) {
    for (const current of input.categories) {
      const previous = input.previousCategories.find((row) => row.categoryId === current.categoryId)
      if (!previous || previous.amountPaise <= 0) continue
      const change = percentChange(current.amountPaise, previous.amountPaise)
      if (Math.abs(change) >= 20) {
        const direction = change >= 0 ? 'increased' : 'decreased'
        insights.push({
          type: 'category_change',
          title: `${current.name} spending ${direction}`,
          description: `${current.name} spending ${direction} ${Math.abs(change).toFixed(1)}% compared with the equivalent prior period.`,
          evidence: {
            category: current.name,
            currentPaise: current.amountPaise,
            previousPaise: previous.amountPaise,
            changePercent: Number(change.toFixed(1)),
          },
        })
      }
    }
  }

  const groupedPrices = new Map<string, typeof input.unitPrices>()
  for (const row of input.unitPrices) {
    const key = `${row.itemId}:${row.unit}`
    const rows = groupedPrices.get(key) ?? []
    rows.push(row)
    groupedPrices.set(key, rows)
  }
  for (const rows of groupedPrices.values()) {
    if (rows.length < 3) continue
    const ordered = [...rows].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    const early = ordered.slice(0, Math.min(2, ordered.length - 1))
    const latest = ordered[ordered.length - 1]
    const baseline = early.reduce((sum, row) => sum + row.unitPricePaise, 0) / early.length
    if (baseline <= 0) continue
    const change = percentChange(latest.unitPricePaise, baseline)
    if (change >= 15) {
      insights.push({
        type: 'unit_price_change',
        title: `${latest.name} unit price increased`,
        description: `${latest.name} unit price is ${change.toFixed(1)}% higher than its earlier same-unit average.`,
        evidence: {
          item: latest.name,
          unit: latest.unit,
          latestUnitPricePaise: latest.unitPricePaise,
          earlierAverageUnitPricePaise: Math.round(baseline),
          changePercent: Number(change.toFixed(1)),
        },
      })
    }
  }

  if (input.historicalDailyTotals.length >= 7 && input.currentPeriodDayCount >= 7) {
    const values = input.historicalDailyTotals.map((row) => row.amountPaise)
    const average = values.reduce((sum, value) => sum + value, 0) / values.length
    if (average > 0) {
      const threshold = average * 1.5
      if (input.currentPeriodAveragePaise > threshold) {
        insights.push({
          type: 'unusual_spending',
          title: 'Spending is unusually high',
          description: `Average daily spending is above 1.5 times the historical daily average.`,
          evidence: {
            currentAverageDailyPaise: input.currentPeriodAveragePaise,
            historicalAverageDailyPaise: Math.round(average),
            historicalDaysUsed: values.length,
            thresholdPaise: Math.round(threshold),
          },
        })
      }
    }
  }

  return insights
}

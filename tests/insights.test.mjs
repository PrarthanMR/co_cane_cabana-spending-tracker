import assert from 'node:assert/strict'
import test from 'node:test'
import { generateSpendingInsights } from '../worker/src/services/spendingInsights.ts'

function base(overrides = {}) {
  return {
    totalPaise: 200000,
    sessionCount: 4,
    categories: [
      { categoryId: 1, name: 'Fruits', amountPaise: 120000 },
      { categoryId: 2, name: 'Dairy', amountPaise: 80000 },
    ],
    previousCategories: [
      { categoryId: 1, name: 'Fruits', amountPaise: 100000 },
      { categoryId: 2, name: 'Dairy', amountPaise: 100000 },
    ],
    items: [
      { itemId: 1, name: 'Orange', amountPaise: 90000, purchaseCount: 3 },
      { itemId: 2, name: 'Milk', amountPaise: 60000, purchaseCount: 2 },
    ],
    historicalDailyTotals: [],
    unitPrices: [],
    currentPeriodDayCount: 7,
    currentPeriodAveragePaise: 28571,
    ...overrides,
  }
}

test('identifies the largest spending category', () => {
  const insights = generateSpendingInsights(base())
  const result = insights.find((insight) => insight.type === 'top_category')
  assert.equal(result?.evidence.category, 'Fruits')
  assert.equal(result?.evidence.sharePercent, 60)
})

test('identifies the largest spending item', () => {
  const insights = generateSpendingInsights(base())
  const result = insights.find((insight) => insight.type === 'top_item')
  assert.equal(result?.evidence.item, 'Orange')
  assert.equal(result?.evidence.purchaseSessions, 3)
})

test('reports category spending increase or decrease with prior-period evidence', () => {
  const insights = generateSpendingInsights(base())
  const fruit = insights.find((insight) =>
    insight.type === 'category_change' && insight.evidence.category === 'Fruits',
  )
  const dairy = insights.find((insight) =>
    insight.type === 'category_change' && insight.evidence.category === 'Dairy',
  )
  assert.equal(fruit?.evidence.changePercent, 20)
  assert.equal(dairy?.evidence.changePercent, -20)
})

test('detects only significant same-unit price increases', () => {
  const insights = generateSpendingInsights(base({
    unitPrices: [
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-10-01', unitPricePaise: 10000 },
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-10-08', unitPricePaise: 10000 },
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-11-01', unitPricePaise: 13000 },
    ],
  }))
  const result = insights.find((insight) => insight.type === 'unit_price_change')
  assert.equal(result?.evidence.item, 'Orange')
  assert.equal(result?.evidence.unit, 'kg')
  assert.equal(result?.evidence.changePercent, 30)

  const quantityOnly = generateSpendingInsights(base({
    unitPrices: [
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-10-01', unitPricePaise: 10000 },
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-10-08', unitPricePaise: 10000 },
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-11-01', unitPricePaise: 10000 },
    ],
  }))
  assert.equal(quantityOnly.some((insight) => insight.type === 'unit_price_change'), false)
})

test('does not compare unit prices across incompatible units', () => {
  const insights = generateSpendingInsights(base({
    unitPrices: [
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-10-01', unitPricePaise: 10000 },
      { itemId: 1, name: 'Orange', unit: 'kg', purchaseDate: '2026-10-08', unitPricePaise: 10000 },
      { itemId: 1, name: 'Orange', unit: 'piece', purchaseDate: '2026-11-01', unitPricePaise: 50000 },
    ],
  }))
  assert.equal(insights.some((insight) => insight.type === 'unit_price_change'), false)
})

test('reports unusual spending only with sufficient historical daily data', () => {
  const insufficient = generateSpendingInsights(base({
    historicalDailyTotals: [
      { date: '2026-11-01', amountPaise: 10000 },
    ],
  }))
  assert.equal(insufficient.some((insight) => insight.type === 'unusual_spending'), false)

  const unusual = generateSpendingInsights(base({
    historicalDailyTotals: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`,
      amountPaise: 10000,
    })),
    currentPeriodDayCount: 7,
    currentPeriodAveragePaise: 20000,
  }))
  assert.equal(unusual.some((insight) => insight.type === 'unusual_spending'), true)
})

test('avoids insufficient category and item insights', () => {
  const insights = generateSpendingInsights(base({
    sessionCount: 1,
    items: [{ itemId: 1, name: 'Orange', amountPaise: 90000, purchaseCount: 1 }],
  }))
  assert.equal(insights.some((insight) =>
    insight.type === 'top_category' || insight.type === 'top_item',
  ), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { startAuthenticatedWorker } from './helpers/auth-worker.mjs'

test('analytics uses inclusive date boundaries and backend totals', async () => {
  const app = await startAuthenticatedWorker(8791)
  const { baseUrl, headers } = app

  try {
    const categories = await (await fetch(`${baseUrl}/api/categories`, { headers })).json()
    const fruits = categories.categories.find((category) => category.name === 'Fruits')
    assert.ok(fruits)

    const purchaseIds = []
    for (const [date, amountPaise, quantity, unit] of [
      ['2099-01-01', 500, 1, 'kg'],
      ['2099-01-02', 1000, 2, 'kg'],
    ]) {
      const response = await fetch(`${baseUrl}/api/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          purchaseDate: date,
          items: [{
            newItem: {
              name: `Analytics Orange ${date}`,
              categoryId: fruits.id,
              defaultUnit: unit,
            },
            quantity,
            unit,
            amountPaise,
          }],
        }),
      })
      assert.equal(response.status, 201)
      const body = await response.json()
      purchaseIds.push(body.purchase.id)
    }

    const customResponse = await fetch(
      `${baseUrl}/api/analytics?preset=custom&from=2099-01-02&to=2099-01-02`,
      { headers },
    )
    assert.equal(customResponse.status, 200)
    const custom = await customResponse.json()
    assert.equal(custom.range.from, '2099-01-02')
    assert.equal(custom.range.to, '2099-01-02')
    assert.equal(custom.range.previousFrom, '2099-01-01')
    assert.equal(custom.range.previousTo, '2099-01-01')
    assert.equal(custom.summary.totalPaise, 1000)
    assert.equal(custom.summary.previousPeriodPaise, 500)
    assert.equal(custom.summary.sessionCount, 1)
    assert.equal(custom.summary.averageDailyPaise, 1000)

    const itemId = custom.items.find((item) => item.name.includes('2099-01-02'))?.itemId
    assert.ok(itemId)
    const itemResponse = await fetch(
      `${baseUrl}/api/analytics?preset=custom&from=2099-01-02&to=2099-01-02&itemId=${itemId}`,
      { headers },
    )
    const itemData = await itemResponse.json()
    assert.equal(itemData.itemHistory.history.length, 1)
    assert.equal(itemData.itemHistory.history[0].quantity, 2)
    assert.equal(itemData.itemHistory.history[0].unit, 'kg')
    assert.equal(itemData.itemHistory.history[0].unitPricePaise, 500)
    assert.deepEqual(itemData.itemHistory.compatibleUnits, ['kg'])

    for (const purchaseId of purchaseIds) {
      await fetch(
        `${baseUrl}/api/purchases/${purchaseId}`,
        { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ version: 1 }) },
      )
    }
  } finally {
    await app.cleanup()
  }
})

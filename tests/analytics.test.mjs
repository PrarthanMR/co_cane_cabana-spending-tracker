import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'

const ownerHeaders = { Authorization: 'Bearer local-development-owner-token' }

async function waitForApi(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { headers: ownerHeaders })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Local Worker did not start')
}

test('analytics uses inclusive date boundaries and backend totals', async () => {
  const worker = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--local',
      '--port',
      '8791',
    ],
    { stdio: 'ignore', cwd: process.cwd() },
  )

  try {
    await waitForApi('http://127.0.0.1:8791/api/health')
    const categories = await (await fetch('http://127.0.0.1:8791/api/categories', { headers: ownerHeaders })).json()
    const fruits = categories.categories.find((category) => category.name === 'Fruits')
    assert.ok(fruits)

    const purchaseIds = []
    for (const [date, amountPaise, quantity, unit] of [
      ['2099-01-01', 500, 1, 'kg'],
      ['2099-01-02', 1000, 2, 'kg'],
    ]) {
      const response = await fetch('http://127.0.0.1:8791/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ownerHeaders },
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
      'http://127.0.0.1:8791/api/analytics?preset=custom&from=2099-01-02&to=2099-01-02',
      { headers: ownerHeaders },
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
      `http://127.0.0.1:8791/api/analytics?preset=custom&from=2099-01-02&to=2099-01-02&itemId=${itemId}`,
      { headers: ownerHeaders },
    )
    const itemData = await itemResponse.json()
    assert.equal(itemData.itemHistory.history.length, 1)
    assert.equal(itemData.itemHistory.history[0].quantity, 2)
    assert.equal(itemData.itemHistory.history[0].unit, 'kg')
    assert.equal(itemData.itemHistory.history[0].unitPricePaise, 500)
    assert.deepEqual(itemData.itemHistory.compatibleUnits, ['kg'])

    for (const purchaseId of purchaseIds) {
      await fetch(
        `http://127.0.0.1:8791/api/purchases/${purchaseId}`,
        { method: 'DELETE', headers: ownerHeaders },
      )
    }
  } finally {
    worker.kill()
  }
})

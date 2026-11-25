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

test('purchase API creates, edits, lists, reads, and deletes a session', async () => {
  const worker = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--local',
      '--port',
      '8790',
    ],
    { stdio: 'ignore', cwd: process.cwd() },
  )

  try {
    await waitForApi('http://127.0.0.1:8790/api/health')
    const unauthorized = await fetch('http://127.0.0.1:8790/api/categories')
    assert.equal(unauthorized.status, 401)
    const wrongBusiness = await fetch(
      'http://127.0.0.1:8790/api/categories?businessId=999',
      { headers: ownerHeaders },
    )
    assert.equal(wrongBusiness.status, 403)
    const exportResponse = await fetch(
      'http://127.0.0.1:8790/api/exports/categories.csv',
      { headers: ownerHeaders },
    )
    assert.equal(exportResponse.status, 200)
    assert.match(exportResponse.headers.get('content-type') ?? '', /text\/csv/)
    const categoriesResponse = await fetch('http://127.0.0.1:8790/api/categories', { headers: ownerHeaders })
    const categoriesBody = await categoriesResponse.json()
    const fruits = categoriesBody.categories.find((category) => category.name === 'Fruits')
    assert.ok(fruits)

    const createResponse = await fetch('http://127.0.0.1:8790/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders },
      body: JSON.stringify({
        purchaseDate: '2026-11-25',
        notes: 'API integration test',
        items: [{
          newItem: {
            name: `Test Purchase Item ${Date.now()}`,
            categoryId: fruits.id,
            defaultUnit: 'kg',
          },
          quantity: 2,
          unit: 'kg',
          amountPaise: 3500,
        }],
      }),
    })
    assert.equal(createResponse.status, 201)
    const createdBody = await createResponse.json()
    assert.equal(createdBody.purchase.totalAmountPaise, 3500)
    assert.equal(createdBody.purchase.items.length, 1)

    const listResponse = await fetch(
      'http://127.0.0.1:8790/api/purchases?itemName=Test%20Purchase&from=2026-11-25&to=2026-11-25',
      { headers: ownerHeaders },
    )
    assert.equal(listResponse.status, 200)
    const listBody = await listResponse.json()
    assert.ok(listBody.purchases.some((purchase) => purchase.id === createdBody.purchase.id))

    const updateResponse = await fetch(
      `http://127.0.0.1:8790/api/purchases/${createdBody.purchase.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...ownerHeaders },
        body: JSON.stringify({
          purchaseDate: '2026-11-25',
          items: [{
            itemId: createdBody.purchase.items[0].itemId,
            quantity: 3,
            unit: 'kg',
            amountPaise: 5000,
          }],
        }),
      },
    )
    assert.equal(updateResponse.status, 200)
    const updatedBody = await updateResponse.json()
    assert.equal(updatedBody.purchase.totalAmountPaise, 5000)

    const readResponse = await fetch(
      `http://127.0.0.1:8790/api/purchases/${createdBody.purchase.id}`,
      { headers: ownerHeaders },
    )
    assert.equal(readResponse.status, 200)

    const deleteResponse = await fetch(
      `http://127.0.0.1:8790/api/purchases/${createdBody.purchase.id}`,
      { method: 'DELETE', headers: ownerHeaders },
    )
    assert.equal(deleteResponse.status, 200)

    const missingResponse = await fetch(
      `http://127.0.0.1:8790/api/purchases/${createdBody.purchase.id}`,
      { headers: ownerHeaders },
    )
    assert.equal(missingResponse.status, 404)
  } finally {
    worker.kill()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeLocalSql, startAuthenticatedWorker } from './helpers/auth-worker.mjs'

test('authenticated purchase API creates, edits, lists, reads, and deletes a session', async () => {
  const app = await startAuthenticatedWorker(8790)
  const { baseUrl, headers, persistPath } = app

  try {
    const unauthorized = await fetch(`${baseUrl}/api/categories`)
    assert.equal(unauthorized.status, 401)

    const requestId = 'c2fbf707-83e4-4a14-9e03-3fe0d0505fb4'
    const categoriesResponse = await fetch(`${baseUrl}/api/categories?businessId=999`, {
      headers: { ...headers, 'X-Request-ID': requestId },
    })
    assert.equal(categoriesResponse.status, 200)
    assert.equal(categoriesResponse.headers.get('X-Request-ID'), requestId)
    const categoriesBody = await categoriesResponse.json()
    const fruits = categoriesBody.categories.find((category) => category.name === 'Fruits')
    assert.ok(fruits)

    const createResponse = await fetch(`${baseUrl}/api/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
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
    assert.equal(createdBody.purchase.version, 1)
    const createdAudit = executeLocalSql(
      persistPath,
      `SELECT action, purchase_version FROM purchase_audit_events
       WHERE purchase_id = ${createdBody.purchase.id}`,
    )[0].results
    assert.deepEqual(createdAudit.map((row) => row.action), ['created'])

    const listResponse = await fetch(
      `${baseUrl}/api/purchases?itemName=Test%20Purchase&from=2026-11-25&to=2026-11-25`,
      { headers },
    )
    assert.equal(listResponse.status, 200)
    const listBody = await listResponse.json()
    assert.ok(listBody.purchases.some((purchase) => purchase.id === createdBody.purchase.id))

    const updateResponse = await fetch(`${baseUrl}/api/purchases/${createdBody.purchase.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        version: createdBody.purchase.version,
        purchaseDate: '2026-11-25',
        items: [{
          itemId: createdBody.purchase.items[0].itemId,
          quantity: 3,
          unit: 'kg',
          amountPaise: 5000,
        }],
      }),
    })
    assert.equal(updateResponse.status, 200, await updateResponse.clone().text())
    const updatedBody = await updateResponse.json()
    assert.equal(updatedBody.purchase.totalAmountPaise, 5000)
    assert.equal(updatedBody.purchase.version, 2)
    const updatedAudit = executeLocalSql(
      persistPath,
      `SELECT action, purchase_version FROM purchase_audit_events
       WHERE purchase_id = ${createdBody.purchase.id} ORDER BY id`,
    )[0].results
    assert.deepEqual(updatedAudit.map((row) => row.action), ['created', 'updated'])
    assert.equal(updatedAudit[1].purchase_version, 2)

    const staleResponse = await fetch(`${baseUrl}/api/purchases/${createdBody.purchase.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        version: 1,
        purchaseDate: '2026-11-25',
        items: [{
          itemId: createdBody.purchase.items[0].itemId,
          amountPaise: 6000,
        }],
      }),
    })
    assert.equal(staleResponse.status, 409)

    const deleteResponse = await fetch(`${baseUrl}/api/purchases/${createdBody.purchase.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ version: updatedBody.purchase.version }),
    })
    assert.equal(deleteResponse.status, 200)
    const deletedAudit = executeLocalSql(
      persistPath,
      `SELECT action FROM purchase_audit_events
       WHERE purchase_id = ${createdBody.purchase.id} ORDER BY id`,
    )[0].results
    assert.deepEqual(deletedAudit.map((row) => row.action), ['created', 'updated', 'deleted'])
    const auditResponse = await fetch(`${baseUrl}/api/audit/purchases`, { headers })
    assert.equal(auditResponse.status, 200)
    const auditPage = await auditResponse.json()
    const auditEvents = auditPage.events
    assert.deepEqual(auditEvents.map((event) => event.action), ['deleted', 'updated', 'created'])
    assert.equal(auditPage.hasMore, false)
    assert.ok(auditEvents.every((event) => event.actorDisplayName === 'Test Owner'))
    const olderAuditResponse = await fetch(
      `${baseUrl}/api/audit/purchases?beforeId=${auditEvents[1].id}`,
      { headers },
    )
    assert.equal(olderAuditResponse.status, 200)
    const olderAuditPage = await olderAuditResponse.json()
    assert.deepEqual(olderAuditPage.events.map((event) => event.id), [auditEvents[2].id])
    assert.equal(olderAuditPage.hasMore, false)
    const auditBusinessId = executeLocalSql(
      persistPath,
      `SELECT business_id FROM purchase_audit_events
       WHERE purchase_id = ${createdBody.purchase.id} LIMIT 1`,
    )[0].results[0].business_id
    executeLocalSql(
      persistPath,
      `INSERT INTO purchase_audit_events
       (business_id, purchase_id, purchase_version, action, actor_user_id, occurred_at)
       VALUES (${auditBusinessId}, ${createdBody.purchase.id}, 2, 'legacy_baseline', NULL, ${Date.now()})`,
    )
    const legacyAuditResponse = await fetch(
      `${baseUrl}/api/audit/purchases?purchaseId=${createdBody.purchase.id}`,
      { headers },
    )
    assert.equal(legacyAuditResponse.status, 200)
    const legacyEvent = (await legacyAuditResponse.json()).events.find(
      (event) => event.action === 'legacy_baseline',
    )
    assert.equal(legacyEvent.actorUserId, null)
    assert.equal(legacyEvent.actorDisplayName, 'Unknown (before audit tracking)')

    const missingResponse = await fetch(`${baseUrl}/api/purchases/${createdBody.purchase.id}`, { headers })
    assert.equal(missingResponse.status, 404)

    const frontendDiagnostic = await fetch(`${baseUrl}/api/telemetry/frontend-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ errorCode: 'frontend_unhandled_error', errorType: 'TypeError' }),
    })
    assert.equal(frontendDiagnostic.status, 202)
    const invalidDiagnostic = await fetch(`${baseUrl}/api/telemetry/frontend-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        errorCode: 'frontend_unhandled_error',
        errorType: 'TypeError',
        message: 'Sensitive request payload',
      }),
    })
    assert.equal(invalidDiagnostic.status, 400)
  } finally {
    await app.cleanup()
  }
})

test('a concurrent losing edit cannot replace the winning purchase items', async () => {
  const app = await startAuthenticatedWorker(8793)
  const { baseUrl, headers } = app

  try {
    const categoriesResponse = await fetch(`${baseUrl}/api/categories`, { headers })
    const fruits = (await categoriesResponse.json()).categories.find(
      (category) => category.name === 'Fruits',
    )
    assert.ok(fruits)
    const createdResponse = await fetch(`${baseUrl}/api/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        purchaseDate: '2026-11-26',
        items: [{
          newItem: { name: 'Concurrent edit item', categoryId: fruits.id },
          amountPaise: 1000,
        }],
      }),
    })
    assert.equal(createdResponse.status, 201)
    const created = (await createdResponse.json()).purchase
    const edits = [5100, 6200].map((amountPaise) => fetch(
      `${baseUrl}/api/purchases/${created.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          version: created.version,
          purchaseDate: created.purchaseDate,
          items: [{ itemId: created.items[0].itemId, amountPaise }],
        }),
      },
    ))
    const responses = await Promise.all(edits)
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
    const winner = (await responses.find((response) => response.status === 200).json()).purchase
    const finalResponse = await fetch(`${baseUrl}/api/purchases/${created.id}`, { headers })
    assert.equal(finalResponse.status, 200)
    const finalPurchase = (await finalResponse.json()).purchase
    assert.equal(finalPurchase.version, 2)
    assert.equal(
      finalPurchase.items.reduce((sum, item) => sum + item.amountPaise, 0),
      finalPurchase.totalAmountPaise,
    )
    assert.equal(finalPurchase.items[0].amountPaise, winner.items[0].amountPaise)
  } finally {
    await app.cleanup()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRequestLog,
  emitStructuredLog,
  getRequestId,
  normalizeApiRoute,
  safeErrorType,
} from '../worker/src/services/observability.ts'

test('structured request logs normalize and exclude raw user-agent and route data', () => {
  const rawUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 user=owner@example.com'
  const record = buildRequestLog({
    appVersion: '0.0.0',
    requestId: '51ea7ba8-4587-4bc6-885d-3d2c68dc124f',
    method: 'GET',
    path: '/api/purchases/481?item=Private Mango&amount=5000',
    status: 200,
    durationMs: 12.6,
    userAgent: rawUserAgent,
    event: 'purchase_created',
    errorCode: 'PIN=12345678',
  })
  const serialized = JSON.stringify(record)

  assert.equal(record.route, '/api/purchases/:id')
  assert.equal(record.browserFamily, 'Chrome')
  assert.equal(record.browserVersion, '131')
  assert.equal(record.osFamily, 'Windows')
  assert.equal(record.osVersion, '10+')
  assert.equal(record.deviceClass, 'desktop')
  assert.equal(record.errorCode, null)
  assert.equal(record.event, 'purchase_created')
  assert.equal(record.durationMs, 13)
  assert.equal(serialized.includes(rawUserAgent), false)
  assert.equal(serialized.includes('owner@example.com'), false)
  assert.equal(serialized.includes('Private Mango'), false)
  assert.equal(serialized.includes('5000'), false)
  assert.equal(serialized.includes('12345678'), false)
  assert.equal('ip' in record, false)
})

test('request IDs accept UUIDs and replace untrusted values', () => {
  const expected = '51ea7ba8-4587-4bc6-885d-3d2c68dc124f'
  assert.equal(getRequestId(expected), expected)
  assert.match(getRequestId('alice@example.com'), /^[0-9a-f-]{36}$/)
  assert.equal(normalizeApiRoute('/api/auth/members/99/deactivate'), '/api/auth/members/:id/deactivate')
})

test('only allowlisted cryptographic error names enter diagnostics', () => {
  assert.equal(safeErrorType('OperationError'), 'OperationError')
  assert.equal(safeErrorType('PIN=12345678'), 'UnknownError')
})

test('telemetry output failures do not throw into application requests', () => {
  const original = console.log
  console.log = () => { throw new Error('test logging failure') }
  try {
    assert.doesNotThrow(() => emitStructuredLog({ level: 'info', event: 'purchase_created' }))
  } finally {
    console.log = original
  }
})

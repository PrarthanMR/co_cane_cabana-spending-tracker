import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const bootstrapToken = 'test-bootstrap-token-with-sufficient-length'
const pinPepper = 'test-only-pin-pepper-value-that-is-long-enough'

export async function startAuthenticatedWorker(port) {
  const persistPath = path.join(os.tmpdir(), `spending-tracker-${randomUUID()}`)
  const migration = spawnSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js',
    'd1', 'migrations', 'apply', 'spending-tracker-db', '--local',
    '--persist-to', persistPath, '--force',
  ], { encoding: 'utf8', cwd: process.cwd() })
  if (migration.status !== 0) throw new Error(migration.stderr || migration.stdout)

  const worker = spawn(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js',
    'dev', '--local', '--port', String(port), '--persist-to', persistPath,
    '--var', `PIN_PEPPER:${pinPepper}`,
    '--var', `BOOTSTRAP_TOKEN:${bootstrapToken}`,
  ], { stdio: 'ignore', cwd: process.cwd() })

  const baseUrl = `http://127.0.0.1:${port}`
  try {
    let response
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        response = await fetch(`${baseUrl}/api/auth/status`)
        if (response.ok) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!response?.ok) throw new Error('Local Worker did not start')

    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken,
        businessName: `Test Business ${port}`,
        username: `owner-${port}`,
        displayName: 'Test Owner',
        pin: '12345678',
      }),
    })
    if (registration.status !== 201) {
      throw new Error(`Owner registration failed (${registration.status}): ${await registration.text()}`)
    }
    const cookie = registration.headers.get('set-cookie')?.split(';', 1)[0]
    if (!cookie) throw new Error('Worker did not set a session cookie')
    return {
      worker,
      baseUrl,
      persistPath,
      headers: { Cookie: cookie },
      cleanup: async () => {
        if (worker.exitCode === null && worker.signalCode === null) {
          worker.kill()
          await once(worker, 'exit').catch(() => undefined)
        }
        await rm(persistPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      },
    }
  } catch (error) {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill()
      await once(worker, 'exit').catch(() => undefined)
    }
    await rm(persistPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    throw error
  }
}

export function executeLocalSql(persistPath, sql) {
  const result = spawnSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js',
    'd1', 'execute', 'spending-tracker-db', '--local',
    '--persist-to', persistPath, '--command', sql, '--json',
  ], { encoding: 'utf8', cwd: process.cwd() })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

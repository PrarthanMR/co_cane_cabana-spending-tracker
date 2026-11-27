import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const wrangler = path.join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')

test('audit migration marks legacy purchases without inventing an actor', async (t) => {
  const projectRoot = process.cwd()
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'purchase-audit-migration-'))
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  const drizzleDirectory = path.join(temporaryRoot, 'drizzle')
  const metadataDirectory = path.join(drizzleDirectory, 'meta')
  await mkdir(metadataDirectory, { recursive: true })
  const sourceJournal = JSON.parse(await readFile(
    path.join(projectRoot, 'drizzle', 'meta', '_journal.json'),
    'utf8',
  ))
  const journalPath = path.join(metadataDirectory, '_journal.json')

  async function prepareMigrations(entryCount) {
    const entries = sourceJournal.entries.slice(0, entryCount)
    for (const entry of entries) {
      await copyFile(
        path.join(projectRoot, 'drizzle', `${entry.tag}.sql`),
        path.join(drizzleDirectory, `${entry.tag}.sql`),
      )
    }
    await writeFile(journalPath, JSON.stringify({
      version: sourceJournal.version,
      dialect: sourceJournal.dialect,
      entries,
    }))
  }

  const configPath = path.join(temporaryRoot, 'wrangler.toml')
  await writeFile(configPath, [
    'name = "purchase-audit-migration-test"',
    'compatibility_date = "2025-07-01"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "purchase-audit-migration-test"',
    'database_id = "00000000-0000-0000-0000-000000000000"',
    'migrations_dir = "./drizzle"',
    '',
  ].join('\n'))
  const persistPath = path.join(temporaryRoot, 'state')

  function runWrangler(args) {
    const result = spawnSync(process.execPath, [
      wrangler,
      ...args,
      '--config',
      configPath,
    ], { encoding: 'utf8', cwd: projectRoot })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout
  }

  function applyMigrations() {
    runWrangler([
      'd1', 'migrations', 'apply', 'DB',
      '--local', '--persist-to', persistPath, '--force',
    ])
  }

  function executeSql(sql) {
    return JSON.parse(runWrangler([
      'd1', 'execute', 'DB',
      '--local', '--persist-to', persistPath,
      '--command', sql, '--json',
    ]))
  }

  await prepareMigrations(4)
  applyMigrations()
  executeSql(
    `INSERT INTO purchases
       (business_id, purchase_date, total_amount_paise, created_at, updated_at)
     VALUES (1, '2026-01-01', 2500, 1000, 1000)`,
  )

  await prepareMigrations(5)
  applyMigrations()
  executeSql(
    `INSERT INTO users
       (username, display_name, pin_hash, pin_salt, pin_iterations, is_active, created_at, updated_at)
     VALUES ('audit-actor', 'Audit Actor', 'hash', 'salt', 1, 1, 2000, 2000);
     INSERT INTO purchases
       (business_id, purchase_date, total_amount_paise, created_at, updated_at,
        created_by_user_id, updated_by_user_id, version)
     VALUES (1, '2026-01-02', 3500, 2000, 2000,
       (SELECT id FROM users WHERE username = 'audit-actor'),
       (SELECT id FROM users WHERE username = 'audit-actor'), 1)`,
  )

  await prepareMigrations(6)
  applyMigrations()
  const events = executeSql(
    `SELECT purchase_id, action, actor_user_id FROM purchase_audit_events ORDER BY purchase_id`,
  )[0].results

  assert.deepEqual(events, [
    { purchase_id: 1, action: 'legacy_baseline', actor_user_id: null },
    { purchase_id: 2, action: 'created', actor_user_id: 1 },
  ])
})

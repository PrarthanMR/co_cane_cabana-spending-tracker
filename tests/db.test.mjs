import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function executeSql(sql) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'spending-tracker-db', '--local', '--command', sql, '--json'],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

test('purchase schema migrations seed the default business and categories', () => {
  const business = executeSql(
    `SELECT id, name FROM businesses WHERE name = 'Co Cane Cabana'`,
  )
  assert.equal(business[0].results[0].name, 'Co Cane Cabana')

  const categories = executeSql(
    `SELECT name FROM categories
     WHERE business_id = (SELECT id FROM businesses WHERE name = 'Co Cane Cabana')
     ORDER BY name`,
  )
  assert.deepEqual(
    categories[0].results.map((row) => row.name).sort(),
    ['Consumables', 'Dairy', 'Fruits', 'Ingredients', 'Other', 'Packaging'],
  )
})

test('item category must belong to the same business', () => {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1', 'execute', 'spending-tracker-db', '--local',
      '--command',
      `INSERT INTO categories (business_id, name) VALUES (999999, 'Cross-business');
       INSERT INTO items (business_id, category_id, name) VALUES (1, 999999, 'Invalid item');`,
    ],
    { encoding: 'utf8' },
  )
  assert.notEqual(result.status, 0)
})

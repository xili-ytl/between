// Run with Node >=22.13: node --test android/scripts/wenli-unread.test.mjs
// Executes the actual Room query against SQLite, without a device or production data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const source = readFileSync(new URL('../app/src/main/java/com/privatechat/couplechat/core/database/MessageDao.kt', import.meta.url), 'utf8');
const queryMatch = source.match(/@Query\(\s*((?:"[^"\r\n]*"\s*(?:\+\s*)?)+),?\s*\)\s*fun observeUnreadCount\(/);
assert.ok(queryMatch, 'must locate the production Room unread query, not a copied test query');
const query = [...queryMatch[1].matchAll(/"([^"\r\n]*)"/g)].map((match) => match[1]).join('');
const now = '2026-08-31T00:00:00.000Z';

function withRows(rows, check) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE messages(id TEXT PRIMARY KEY, relationshipId TEXT, senderId TEXT, recipientId TEXT, createdAt TEXT)');
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) insert.run(row.id, row.relationshipId ?? 'couple', row.senderId, row.recipientId ?? '1001', row.createdAt ?? now);
    const count = (senderId, afterCreatedAt = '', afterId = '') =>
      Object.values(db.prepare(query).get({ senderId, afterCreatedAt, afterId }))[0];
    check(count);
  } finally {
    db.close();
  }
}

for (const [own, partner] of [['1001', '1002'], ['1002', '1001']]) {
  test(`Wenli and partner are unread for ${own}, regardless of Wenli recipient`, () => {
    for (const recipient of [own, partner]) {
      withRows([
        { id: `${own}_own`, senderId: own },
        { id: `${partner}_partner`, senderId: partner },
        { id: 'wenli_reply', senderId: 'wenli', recipientId: recipient },
        { id: 'unknown', senderId: 'robot' },
      ], (count) => assert.equal(count(partner), 2));
    }
  });
}

test('cursor is exclusive and orders equal timestamps by message ID', () => {
  withRows([
    { id: 'wenli_a', senderId: 'wenli' },
    { id: 'wenli_b', senderId: 'wenli' },
    { id: 'wenli_c', senderId: 'wenli' },
    { id: 'wenli_old', senderId: 'wenli', createdAt: '2026-08-30T23:59:59.999Z' },
    { id: '1002_future', senderId: '1002', createdAt: '2026-08-31T00:00:00.001Z' },
  ], (count) => {
    assert.equal(count('1002', now, 'wenli_b'), 2);
    assert.equal(count('1002', now, 'wenli_c'), 1);
    assert.equal(count('1002', '2026-08-31T00:00:00.001Z', '1002_future'), 0);
  });
});

test('rows from other relationships never contribute to this shared chat', () => {
  withRows([
    { id: 'other_partner', senderId: '1002', relationshipId: 'other' },
    { id: 'other_wenli', senderId: 'wenli', relationshipId: 'other' },
  ], (count) => assert.equal(count('1002'), 0));
});

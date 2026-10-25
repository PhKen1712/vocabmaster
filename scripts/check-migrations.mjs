#!/usr/bin/env node
/**
 * Real-SQLite check for the forward-only migrations.
 *
 * The Jest suite runs without a native SQLite module, so this script uses
 * Node's built-in `node:sqlite` to catch mistakes a TypeScript test cannot:
 * column order, partial unique indexes, backfill statements and the v3 -> v4
 * upgrade path with existing coin rows.
 *
 * Run: node scripts/check-migrations.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/db/schema.ts';

function apply(db, version) {
  const migration = MIGRATIONS.find((item) => item.version === version);
  if (!migration) throw new Error(`Missing migration ${version}`);
  for (const statement of migration.statements) db.exec(statement);
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table});`).all().map((row) => row.name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 1. A brand-new install applies every migration in order.
const fresh = new DatabaseSync(':memory:');
for (const migration of MIGRATIONS) apply(fresh, migration.version);

assert(columnNames(fresh, 'coin_ledger').includes('term_key'), 'fresh: term_key missing');
assert(columnNames(fresh, 'coin_ledger').includes('source_id'), 'fresh: source_id missing');
assert(columnNames(fresh, 'coin_ledger').includes('cycle_id'), 'fresh: cycle_id missing');
assert(tableNames(fresh).includes('ai_cache'), 'fresh: ai_cache missing');
assert(tableNames(fresh).includes('album_words'), 'fresh: album_words missing');
assert(columnNames(fresh, 'words').includes('wrong_count'), 'fresh: word stats missing');
assert(!tableNames(fresh).includes('dictionary_cache'), 'fresh: dictionary cache table remains');
fresh.exec(
  "INSERT INTO coin_ledger (id, kind, term_key, cycle_id, amount, balance_after, created_at) VALUES ('a', 'reward', 'criminal|general', 'initial', 500, 500, '2026-01-01');",
);
let uniqueBlocked = false;
try {
  fresh.exec(
    "INSERT INTO coin_ledger (id, kind, term_key, cycle_id, amount, balance_after, created_at) VALUES ('b', 'reward', 'criminal|general', 'initial', 500, 1000, '2026-01-02');",
  );
} catch {
  uniqueBlocked = true;
}
assert(uniqueBlocked, 'fresh: one-reward-per-term-per-cycle index is not enforced');
// A deliberate study reset starts a new cycle; the same term may pay once there.
fresh.exec(
  "INSERT INTO coin_ledger (id, kind, term_key, cycle_id, amount, balance_after, created_at) VALUES ('c', 'reward', 'criminal|general', 'cycle-2', 500, 1000, '2026-01-03');",
);
assert(
  fresh.prepare("SELECT COUNT(*) AS count FROM coin_ledger WHERE kind = 'reward' AND term_key = 'criminal|general';").get().count === 2,
  'fresh: a new learning cycle was not allowed to reward again',
);
fresh.close();

// 2. Upgrading an existing v3 database keeps the wallet and dedupes old payouts
//    that happened because the same term was deleted and added again.
const upgrade = new DatabaseSync(':memory:');
apply(upgrade, 1);
apply(upgrade, 2);
apply(upgrade, 3);

const now = '2026-01-01T00:00:00.000Z';
upgrade
  .prepare(
    `INSERT INTO words (id, term, normalized_term, meaning_vi, track, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'general', ?, ?);`,
  )
  .run('w1', 'criminal', 'criminal', 'tội phạm', now, now);
upgrade
  .prepare(
    `INSERT INTO coin_ledger (id, kind, word_id, amount, balance_after, reason, created_at)
     VALUES ('r1', 'reward', 'w1', 500, 500, 'Học từ mới', ?);`,
  )
  .run(now);
// Simulate delete + re-add in an old version: the word row is replaced but the
// ledger row survives, so a second payout for the same term exists.
upgrade.exec("DELETE FROM words WHERE id = 'w1';");
upgrade
  .prepare(
    `INSERT INTO words (id, term, normalized_term, meaning_vi, track, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'general', ?, ?);`,
  )
  .run('w2', 'Criminal', 'criminal', 'tội phạm', now, now);
upgrade
  .prepare(
    `INSERT INTO coin_ledger (id, kind, word_id, amount, balance_after, reason, created_at)
     VALUES ('r2', 'reward', 'w2', 500, 1000, 'Học từ mới', ?);`,
  )
  .run(now);

apply(upgrade, 4);

const rewards = upgrade
  .prepare("SELECT * FROM coin_ledger WHERE term_key = 'criminal|general' AND kind = 'reward';")
  .all();
assert(rewards.length === 1, `upgrade: expected 1 active reward, got ${rewards.length}`);
const history = upgrade
  .prepare("SELECT SUM(amount) AS total FROM coin_ledger WHERE kind <> 'reset';")
  .get();
assert(history.total === 1000, `upgrade: wallet changed to ${history.total}`);
// The older payout belonged to a deleted word row, so its term cannot be
// reconstructed. It stays in the wallet/history with a NULL term_key, while the
// live row owns the term key. What matters is that no future reward can slip
// past the new index.
const orphan = upgrade
  .prepare("SELECT COUNT(*) AS count FROM coin_ledger WHERE kind = 'reward' AND term_key IS NULL;")
  .get();
assert(orphan.count === 1, 'upgrade: historical orphan payout was deleted');
let upgradeBlocked = false;
try {
  upgrade
    .prepare(
      "INSERT INTO coin_ledger (id, kind, term_key, amount, balance_after, created_at) VALUES ('late', 'reward', 'criminal|general', 500, 1500, '2026-02-01');",
    )
    .run();
} catch {
  upgradeBlocked = true;
}
assert(upgradeBlocked, 'upgrade: duplicate term can still be rewarded after v4');
assert(tableNames(upgrade).includes('ai_cache'), 'upgrade: ai_cache missing');
assert(tableNames(upgrade).includes('word_study_history'), 'upgrade: study history missing');
assert(
  upgrade
    .prepare("SELECT COUNT(*) AS count FROM word_study_history WHERE term_key = 'criminal|general'")
    .get().count === 1,
  'upgrade: studied term was not recorded',
);
assert(!tableNames(upgrade).includes('dictionary_cache'), 'upgrade: old cache table remains');

const upgradedWord = upgrade.prepare("SELECT id FROM words WHERE normalized_term = 'criminal';").get();
assert(upgradedWord.id === 'w2', 'upgrade: study word was lost');

// 3. v4 -> v5 keeps the wallet, starts every existing reward in the 'initial'
//    cycle, adds album membership and learning counters, and merges topics.
upgrade.exec(
  "INSERT INTO reviews (id, word_id, rating, correct, mode, reviewed_at) VALUES ('rv1', 'w2', 3, 1, 'typing', '2026-02-01T00:00:00Z');",
);
upgrade.exec(
  "INSERT INTO reviews (id, word_id, rating, correct, mode, reviewed_at) VALUES ('rv2', 'w2', 1, 0, 'typing', '2026-02-02T00:00:00Z');",
);
upgrade.exec("UPDATE words SET topic = ' Environment ' WHERE id = 'w2';");
upgrade.exec(
  `INSERT INTO words (id, term, normalized_term, meaning_vi, track, topic, created_at, updated_at)
   VALUES ('w3', 'environment', 'environment', 'môi trường', 'general', 'environment', '2026-01-01', '2026-01-01');`,
);

apply(upgrade, 5);

assert(columnNames(upgrade, 'words').includes('correct_count'), 'v5: correct_count missing');
assert(tableNames(upgrade).includes('album_words'), 'v5: album table missing');
assert(
  upgrade.prepare("SELECT COUNT(*) AS count FROM coin_ledger WHERE cycle_id = 'initial';").get().count >= 2,
  'v5: existing rewards were not assigned to the initial cycle',
);
const stats = upgrade
  .prepare("SELECT correct_count, wrong_count, last_correct_at, last_wrong_at FROM words WHERE id = 'w2';")
  .get();
assert(stats.correct_count === 1 && stats.wrong_count === 1, 'v5: review counters were not backfilled');
assert(stats.last_correct_at && stats.last_wrong_at, 'v5: last answer timestamps were not backfilled');
const mergedTopics = upgrade
  .prepare("SELECT topic FROM words WHERE normalized_term IN ('criminal','environment') ORDER BY normalized_term;")
  .all();
assert(
  mergedTopics[0].topic === mergedTopics[1].topic,
  `v5: topics differing by case/space were not merged (${JSON.stringify(mergedTopics)})`,
);
let cycleBlocked = false;
try {
  upgrade.exec(
    "INSERT INTO coin_ledger (id, kind, term_key, cycle_id, amount, balance_after, created_at) VALUES ('same', 'reward', 'criminal|general', 'initial', 500, 1500, '2026-02-03');",
  );
} catch {
  cycleBlocked = true;
}
assert(cycleBlocked, 'v5: duplicate reward inside one cycle was accepted');
upgrade.exec(
  "INSERT INTO coin_ledger (id, kind, term_key, cycle_id, amount, balance_after, created_at) VALUES ('new-cycle', 'reward', 'criminal|general', 'cycle-2', 500, 1500, '2026-02-03');",
);
upgrade.close();

console.log('Migrations 1-5: PASS (fresh install, v3 and v4 upgrades, reward cycles, album, topics)');

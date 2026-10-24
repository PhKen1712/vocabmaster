import type { SQLiteDatabase } from 'expo-sqlite';

import type { WordRow } from '../schema';
import { createWord, DuplicateWordError } from '../words';

/**
 * `createWord` must never consult the review gate. These fakes answer the due
 * count query anyway, so a regression that reintroduces the gate would fail
 * here instead of silently blocking the learner's add button again.
 */
function fakeDb({
  due = 7,
  existing = null,
}: {
  due?: number;
  existing?: WordRow | null;
} = {}) {
  const runAsync = jest.fn(async () => undefined);
  const getFirstAsync = jest.fn(async (sql: string) => {
    if (sql.includes('COUNT(*) AS count')) return { count: due };
    return existing;
  });
  return {
    db: { getFirstAsync, runAsync } as unknown as SQLiteDatabase,
    getFirstAsync,
    runAsync,
  };
}

function wordRow(overrides: Partial<WordRow> = {}): WordRow {
  return {
    id: 'w1',
    term: 'borrow',
    normalized_term: 'borrow',
    ipa: null,
    part_of_speech: 'verb',
    meaning_vi: 'mượn',
    definition_en: 'To take something and return it later.',
    example_en: 'Can I borrow your pen?',
    example_vi: null,
    synonyms: '[]',
    antonyms: '[]',
    collocations: '[]',
    word_family: '[]',
    topic: null,
    track: 'general',
    level: 2,
    source: 'manual',
    ai_generated: 0,
    confirmed: 1,
    note: null,
    audio_url: null,
    dict_source: null,
    missing_fields: '[]',
    is_favorite: 0,
    learning_state: 'review',
    due_at: '2026-10-20T00:00:00.000Z',
    stability: 12,
    difficulty: 4,
    reps: 5,
    lapses: 1,
    last_reviewed_at: '2026-10-19T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('createWord while reviews are due', () => {
  it('saves a phrase even though seven words are due', async () => {
    const { db, runAsync } = fakeDb({ due: 7 });
    const saved = await createWord(db, {
      term: 'take into account',
      meaningVi: 'Cân nhắc một yếu tố khi quyết định.',
      track: 'general',
    });
    expect(saved.term).toBe('take into account');
    expect(saved.normalizedTerm).toBe('take into account');
    expect(runAsync).toHaveBeenCalledTimes(1);
  });

  it('does not mark a freshly added word as studied or scheduled', async () => {
    const { db } = fakeDb({ due: 3 });
    const saved = await createWord(db, {
      term: 'umbrella',
      meaningVi: 'vật dụng che mưa',
      track: 'general',
    });
    expect(saved.learningState).toBe('new');
    expect(saved.dueAt).toBeNull();
    expect(saved.reps).toBe(0);
    expect(saved.lapses).toBe(0);
    expect(saved.lastReviewedAt).toBeNull();
  });

  it('refuses a duplicate without touching the studied record', async () => {
    const existing = wordRow();
    const { db, runAsync } = fakeDb({ existing });
    const attempt = createWord(db, {
      term: 'Borrow',
      meaningVi: 'mượn (nhập lại)',
      track: 'general',
    });

    await expect(attempt).rejects.toBeInstanceOf(DuplicateWordError);
    await expect(attempt).rejects.toMatchObject({
      existing: { id: 'w1', reps: 5, learningState: 'review' },
    });
    expect(runAsync).not.toHaveBeenCalled();
  });
});

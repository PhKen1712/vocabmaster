import type { ActivityRow, WordRow } from '../../db/schema';
import {
  activityFromRow,
  albumFromSettings,
  coinFromRow,
  progressFromWord,
  progressPatch,
  recheckSince,
  termFromWord,
  timeValue,
  type PulledWord,
} from '../map';

function wordRow(overrides: Partial<WordRow> = {}): WordRow {
  return {
    id: 'local-1',
    term: 'environment',
    normalized_term: 'environment',
    ipa: '/ɪnˈvaɪrənmənt/',
    part_of_speech: 'noun',
    meaning_vi: 'môi trường',
    definition_en: 'the natural world',
    example_en: 'We must protect the environment.',
    example_vi: 'Chúng ta phải bảo vệ môi trường.',
    synonyms: '["surroundings"]',
    antonyms: '[]',
    collocations: '["protect the environment"]',
    word_family: '["environmental"]',
    topic: 'Nature',
    track: 'general',
    level: 3,
    source: 'ai',
    ai_generated: 1,
    confirmed: 1,
    note: null,
    audio_url: null,
    is_favorite: 0,
    favorite_at: null,
    learning_state: 'review',
    due_at: '2026-10-28T10:00:00.000Z',
    stability: 4.2,
    difficulty: 5.1,
    reps: 3,
    lapses: 1,
    correct_count: 5,
    wrong_count: 2,
    hint_count: 1,
    last_correct_at: '2026-10-27T09:00:00.000Z',
    last_wrong_at: '2026-10-26T09:00:00.000Z',
    memory_rating: 2,
    last_reviewed_at: '2026-10-27T09:00:00.000Z',
    created_at: '2026-10-20T09:00:00.000Z',
    updated_at: '2026-10-27T09:00:00.000Z',
    ...overrides,
  };
}

function pulledWord(overrides: Partial<PulledWord> = {}): PulledWord {
  return {
    termId: 'remote-1',
    term: 'environment',
    normalizedTerm: 'environment',
    track: 'general',
    ipa: '/ɪnˈvaɪrənmənt/',
    partOfSpeech: 'noun',
    meaningVi: 'môi trường',
    definitionEn: 'the natural world',
    exampleEn: 'We must protect the environment.',
    exampleVi: 'Chúng ta phải bảo vệ môi trường.',
    synonyms: ['surroundings'],
    antonyms: [],
    collocations: [],
    wordFamilyText: 'environmental',
    level: 3,
    levelSource: 'ai',
    learningState: 'review',
    dueAt: '2026-10-29T10:00:00.000Z',
    stability: 6,
    difficulty: 5,
    reps: 4,
    lapses: 1,
    correctCount: 8,
    wrongCount: 2,
    hintCount: 1,
    lastCorrectAt: '2026-10-27T11:00:00.000Z',
    lastWrongAt: '2026-10-26T09:00:00.000Z',
    memoryRating: 3,
    isFavorite: false,
    favoriteAt: null,
    updatedAt: '2026-10-27T11:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('đẩy dữ liệu lên tài khoản', () => {
  it('giữ đúng track để từ IELTS không bị trộn sang General', () => {
    expect(termFromWord(wordRow({ track: 'ielts' })).track).toBe('ielts');
    expect(progressFromWord(wordRow({ track: 'ielts' })).track).toBe('ielts');
  });

  it('đổi nguồn level sang đúng bốn giá trị server chấp nhận', () => {
    expect(termFromWord(wordRow({ source: 'seed' })).levelSource).toBe('pack');
    expect(termFromWord(wordRow({ source: 'import', ai_generated: 0 })).levelSource).toBe('import');
    expect(termFromWord(wordRow({ source: 'ai', ai_generated: 1 })).levelSource).toBe('ai');
  });

  it('mang theo đầy đủ bộ đếm và mức tự đánh giá', () => {
    const progress = progressFromWord(wordRow());
    expect(progress.correctCount).toBe(5);
    expect(progress.wrongCount).toBe(2);
    expect(progress.hintCount).toBe(1);
    expect(progress.memoryRating).toBe(2);
    expect(progress.isFavorite).toBe(false);
  });

  it('gửi kèm mốc thao tác yêu thích, null khi máy này chưa ai bấm', () => {
    expect(progressFromWord(wordRow()).favoriteAt).toBeNull();
    expect(
      progressFromWord(wordRow({ is_favorite: 1, favorite_at: '2026-10-27T12:00:00.000Z' })).favoriteAt,
    ).toBe('2026-10-27T12:00:00.000Z');
  });

  it('bỏ qua dòng xu 0 và dòng legacy, giữ lại giao dịch thật', () => {
    expect(
      coinFromRow({ amount: 0, source_id: 'legacy:x', reason: null, cycle_id: null, created_at: 'x', kind: 'reward' }),
    ).toBeNull();
    expect(
      coinFromRow({ amount: 10, source_id: null, reason: null, cycle_id: null, created_at: 'x', kind: 'reward' }),
    ).toBeNull();
    expect(
      coinFromRow({ amount: 10, source_id: null, reason: null, cycle_id: null, created_at: 'x', kind: 'legacy_reward' }),
    ).toBeNull();
    expect(
      coinFromRow({ amount: 10, source_id: 's1', reason: 'quiz', cycle_id: 'c1', created_at: 'x', kind: 'reward' }),
    ).toEqual({ amount: 10, sourceId: 's1', reason: 'quiz', cycleId: 'c1', createdAt: 'x' });
  });

  it('cài đặt album đi kèm mã album ổn định', () => {
    const album = albumFromSettings(
      { albumNotifyEnabled: true, albumIntervalMinutes: 45, albumStartHour: 7, albumEndHour: 21 },
      'album-abc',
    );
    expect(album.clientId).toBe('album-abc');
    expect(album.intervalMinutes).toBe(45);
    expect(album.notifyEnabled).toBe(true);
  });
});

describe('trộn dữ liệu kéo về', () => {
  it('tạo tiến độ khi máy này chưa có từ đó', () => {
    const patch = progressPatch(null, pulledWord());
    expect(patch).not.toBeNull();
    expect(patch?.correctCount).toBe(8);
    expect(patch?.learningState).toBe('review');
  });

  it('bộ đếm chỉ tăng: gói tin đến muộn không xoá thành tích', () => {
    const local = wordRow({ correct_count: 9, updated_at: '2026-10-27T12:00:00.000Z' });
    // Bản kéo về cũ hơn (10:00) và có correctCount nhỏ hơn (8).
    const patch = progressPatch(local, pulledWord({ updatedAt: '2026-10-27T10:00:00.000Z', correctCount: 8 }));
    expect(patch?.correctCount).toBe(9);
  });

  it('lịch ôn đi theo bản mới hơn', () => {
    const local = wordRow({ updated_at: '2026-10-27T12:00:00.000Z', due_at: '2026-10-27T13:00:00.000Z' });
    const older = progressPatch(local, pulledWord({ updatedAt: '2026-10-27T10:00:00.000Z' }));
    expect(older?.dueAt).toBe('2026-10-27T13:00:00.000Z');

    const newer = progressPatch(local, pulledWord({ updatedAt: '2026-10-27T14:00:00.000Z' }));
    expect(newer?.dueAt).toBe('2026-10-29T10:00:00.000Z');
  });

  it('trả về null khi không có gì thay đổi (không ghi database vô ích)', () => {
    const local = wordRow({
      learning_state: 'review',
      due_at: '2026-10-29T10:00:00.000Z',
      stability: 6,
      difficulty: 5,
      reps: 4,
      lapses: 1,
      correct_count: 8,
      wrong_count: 2,
      hint_count: 1,
      last_correct_at: '2026-10-27T11:00:00.000Z',
      last_wrong_at: '2026-10-26T09:00:00.000Z',
      memory_rating: 3,
      updated_at: '2026-10-27T11:00:00.000Z',
    });
    expect(progressPatch(local, pulledWord())).toBeNull();
  });

  it('đánh dấu yêu thích ở máy khác được giữ lại', () => {
    const local = wordRow({ is_favorite: 1, updated_at: '2026-10-27T12:00:00.000Z' });
    const patch = progressPatch(local, pulledWord({ isFavorite: false }));
    expect(patch?.isFavorite).toBe(true);
  });

  it('máy mới chưa từng bấm yêu thích KHÔNG xoá được lựa chọn của máy kia', () => {
    // Đây là lỗi gặp thật: máy thứ hai vừa đăng nhập, đẩy lên isFavorite=false
    // kèm updatedAt mới hơn, và xoá mất dấu yêu thích của máy thứ nhất.
    const local = wordRow({
      is_favorite: 1,
      favorite_at: '2026-10-27T09:00:00.000Z',
      updated_at: '2026-10-27T09:00:00.000Z',
    });
    const patch = progressPatch(local, pulledWord({ isFavorite: false, favoriteAt: null, updatedAt: '2026-10-27T13:00:00.000Z' }));
    expect(patch?.isFavorite ?? true).toBe(true);
  });

  it('bỏ yêu thích ở máy khác lan sang được (mốc mới hơn thắng)', () => {
    const local = wordRow({
      is_favorite: 1,
      favorite_at: '2026-10-27T09:00:00.000Z',
      updated_at: '2026-10-27T09:00:00.000Z',
    });
    const patch = progressPatch(local, pulledWord({ isFavorite: false, favoriteAt: '2026-10-27T12:00:00.000Z' }));
    expect(patch?.isFavorite).toBe(false);
    expect(patch?.favoriteAt).toBe('2026-10-27T12:00:00.000Z');
  });

  it('mốc cũ hơn không kéo lùi lựa chọn mới hơn trên máy này', () => {
    const local = wordRow({
      is_favorite: 0,
      favorite_at: '2026-10-27T15:00:00.000Z',
      updated_at: '2026-10-27T15:00:00.000Z',
    });
    const patch = progressPatch(local, pulledWord({ isFavorite: true, favoriteAt: '2026-10-27T08:00:00.000Z' }));
    expect(patch?.isFavorite ?? false).toBe(false);
  });

  it('máy chủ giữ giá trị cũ không có mốc: máy này tự chữa lành bằng mốc mới', () => {
    // Trường hợp thật: máy chủ còn `is_favorite = false` (bị máy khác ghi đè trước
    // bản vá) trong khi máy này đã yêu thích từ đó. Giữ nguyên lựa chọn và đóng
    // mốc mới để lần đẩy sau đưa máy chủ về đúng.
    const local = wordRow({
      is_favorite: 1,
      favorite_at: '2026-10-27T09:00:00.000Z',
      updated_at: '2026-10-27T09:00:00.000Z',
    });
    const patch = progressPatch(
      local,
      pulledWord({ isFavorite: false, favoriteAt: null, updatedAt: '2026-10-27T13:00:00.000Z' }),
      '2026-10-27T14:00:00.000Z',
    );
    expect(patch?.isFavorite).toBe(true);
    expect(patch?.favoriteAt).toBe('2026-10-27T14:00:00.000Z');
  });

  it('không đóng mốc mới khi hai bên vốn đã khớp nhau', () => {
    const local = wordRow({ is_favorite: 0, favorite_at: null, updated_at: '2026-10-27T07:00:00.000Z' });
    const patch = progressPatch(local, pulledWord({ isFavorite: false, favoriteAt: null }), '2026-10-27T14:00:00.000Z');
    // Chỉ có favoriteAt đổi thành mốc mới sẽ kéo theo một lần đẩy vô ích.
    expect(patch?.favoriteAt ?? null).toBeNull();
  });

  it('nhận yêu thích từ máy khác khi máy này chưa từng bấm', () => {
    const local = wordRow({ is_favorite: 0, favorite_at: null, updated_at: '2026-10-27T07:00:00.000Z' });
    const patch = progressPatch(local, pulledWord({ isFavorite: true, favoriteAt: '2026-10-27T09:30:00.000Z' }));
    expect(patch?.isFavorite).toBe(true);
    expect(patch?.favoriteAt).toBe('2026-10-27T09:30:00.000Z');
  });

  it('thời gian so sánh được giữa ISO của app và timestamptz của PostgREST', () => {
    expect(timeValue('2026-10-27T10:00:00.000Z')).toBe(timeValue('2026-10-27T10:00:00+00:00'));
    expect(timeValue(null)).toBe(0);
    expect(timeValue('không phải thời gian')).toBe(0);
  });
});

describe('hoạt động theo ngày gửi lên server', () => {
  it('gửi cờ đã đạt mục tiêu, không gửi cột streak rỗng', () => {
    // Lỗi thật đã gặp: bảng quản trị luôn hiện streak = 0 vì app chỉ gửi
    // new_words/reviews/answered/correct, còn `streak` thì bị bỏ trống.
    const row: ActivityRow = {
      date: '2026-10-27',
      new_words: 8,
      reviews: 4,
      answered: 12,
      correct: 10,
      goal_met: 1,
      updated_at: '2026-10-27T10:00:00.000Z',
    };
    const push = activityFromRow(row);
    expect(push.goalMet).toBe(true);
    expect(push.day).toBe('2026-10-27');
    expect(push.newWords).toBe(8);
    expect('streak' in push).toBe(false);
  });

  it('ngày chưa đạt mục tiêu gửi false, không phải undefined', () => {
    const push = activityFromRow({
      date: '2026-10-28',
      new_words: 1,
      reviews: 0,
      answered: 1,
      correct: 1,
      goal_met: 0,
      updated_at: '2026-10-28T10:00:00.000Z',
    });
    expect(push.goalMet).toBe(false);
  });
});

describe('cửa sổ xem lại khi kéo dữ liệu', () => {
  it('lùi mốc 24 giờ để dòng bị ghi đè sai còn quay lại được', () => {
    // Không lùi mốc thì một dòng đã bị máy khác ghi đè sẽ không bao giờ được
    // xem lại, và máy chủ giữ giá trị sai vĩnh viễn.
    expect(recheckSince('2026-10-27T10:00:00.000Z')).toBe('2026-10-26T10:00:00.000Z');
  });

  it('chưa từng kéo lần nào thì vẫn kéo toàn bộ', () => {
    expect(recheckSince(null)).toBeNull();
    expect(recheckSince('không phải thời gian')).toBeNull();
  });
});

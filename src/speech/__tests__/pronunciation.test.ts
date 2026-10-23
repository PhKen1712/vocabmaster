import type { Word } from '../../types';
import { buildSpeechCheck, pronunciationQuestion } from '../pronunciation';

const criminal: Word = {
  id: 'w1',
  term: 'criminal',
  normalizedTerm: 'criminal',
  ipa: '/ˈkrɪmɪnəl/',
  partOfSpeech: 'noun',
  meaningVi: 'tội phạm',
  definitionEn: 'a person who commits a crime',
  exampleEn: 'The criminal was arrested.',
  exampleVi: 'Tên tội phạm đã bị bắt.',
  synonyms: ['offender'],
  antonyms: [],
  collocations: [],
  wordFamily: [],
  topic: null,
  track: 'general',
  level: 3,
  source: 'manual',
  aiGenerated: false,
  confirmed: true,
  note: null,
  audioUrl: null,
  isFavorite: false,
  learningState: 'new',
  dueAt: null,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  lastReviewedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('pronunciationQuestion', () => {
  const question = pronunciationQuestion(criminal);

  it('asks the learner to say the saved word', () => {
    expect(question.kind).toBe('speaking');
    expect(question.prompt).toBe('criminal');
    expect(question.answerText).toBe('criminal');
    expect(question.word).toBe(criminal);
  });

  it('accepts a recognised synonym but not unrelated speech', () => {
    expect(buildSpeechCheck(question, 'criminal').wordMatched).toBe(true);
    expect(buildSpeechCheck(question, 'offender').wordMatched).toBe(true);
    expect(buildSpeechCheck(question, 'crime').wordMatched).toBe(false);
  });

  it('says clearly that recognition is not a pronunciation score', () => {
    const result = buildSpeechCheck(question, 'criminal');
    expect(result.note).toContain('không phải điểm phát âm');
  });
});

import type { Word } from '../../types';
import {
  bilingualDescription,
  englishDescription,
  showsBilingualDescription,
  withoutAnswer,
} from '../description';

function word(overrides: Partial<Word> & Pick<Word, 'id' | 'term' | 'meaningVi'>): Word {
  return {
    normalizedTerm: overrides.term.toLowerCase(),
    ipa: null,
    partOfSpeech: 'noun',
    definitionEn: null,
    exampleEn: null,
    exampleVi: null,
    synonyms: [],
    antonyms: [],
    collocations: [],
    wordFamily: [],
    topic: null,
    track: 'general',
    level: 2,
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
    ...overrides,
  };
}

describe('bilingual descriptions', () => {
  it('returns both languages for a General English word', () => {
    const umbrella = word({
      id: '1',
      term: 'umbrella',
      meaningVi: 'Một vật dụng dùng để che mưa, thường gấp lại được.',
      definitionEn: 'An object you use to protect yourself from rain.',
    });
    const description = bilingualDescription(umbrella);
    expect(description.complete).toBe(true);
    expect(description.en).toBe('An object you use to protect yourself from rain.');
    expect(description.vi).toContain('che mưa');
  });

  it('never includes the answer in either description', () => {
    const borrow = word({
      id: '2',
      term: 'borrow',
      meaningVi: 'borrow: mượn một thứ gì đó',
      definitionEn: 'To borrow something means to take it and return it later.',
      exampleEn: 'Can I borrow your pen?',
    });
    const description = bilingualDescription(borrow);
    expect(description.en?.toLowerCase()).not.toContain('borrow');
    expect(description.vi?.toLowerCase()).not.toContain('borrow');
    expect(description.en).toContain('_____');
    expect(description.vi).toContain('_____');
  });

  it('describes a phrase as one unit, not word by word', () => {
    const phrase = word({
      id: '3',
      term: 'take into account',
      meaningVi: 'Cân nhắc hoặc tính đến một yếu tố khi quyết định.',
      definitionEn: 'To consider a fact or situation when making a decision.',
    });
    const description = bilingualDescription(phrase);
    expect(description.vi).toBe('Cân nhắc hoặc tính đến một yếu tố khi quyết định.');
    expect(description.en).toContain('consider a fact or situation');
    expect(description.en).not.toContain('take into account');
  });

  it('falls back to a usage example with the target blanked', () => {
    const wordWithExample = word({
      id: '4',
      term: 'crowded',
      meaningVi: 'đông đúc',
      exampleEn: 'The market was crowded on Sunday.',
    });
    expect(englishDescription(wordWithExample)).toBe('The market was _____ on Sunday.');
  });

  it('reports a missing English description instead of inventing one', () => {
    const bare = word({ id: '5', term: 'lend', meaningVi: 'cho mượn' });
    const description = bilingualDescription(bare);
    expect(description.en).toBeNull();
    expect(description.complete).toBe(false);
    expect(description.vi).toBe('cho mượn');
  });

  it('treats a definition that is only the answer as missing', () => {
    const circular = word({
      id: '9',
      term: 'umbrella',
      meaningVi: 'cái ô',
      definitionEn: 'umbrella.',
      exampleEn: 'umbrella',
    });
    expect(englishDescription(circular)).toBeNull();
  });

  it('strips only the target term, not smaller words inside it', () => {
    expect(withoutAnswer('account for the account', 'account')).toBe('_____ for the _____');
    expect(withoutAnswer('This is important.', 'in')).toBe('This is important.');
  });

  it('blanks a short target word in an example without touching longer words', () => {
    expect(withoutAnswer('She lives in London and works in a bank.', 'in')).toBe(
      'She lives _____ London and works _____ a bank.',
    );
    expect(withoutAnswer('They go there every day.', 'go')).toBe('They _____ there every day.');
  });
});

describe('where the bilingual block applies', () => {
  it('applies to General English description → word questions', () => {
    const general = word({ id: '6', term: 'umbrella', meaningVi: 'cái ô' });
    expect(showsBilingualDescription(general, 'typing')).toBe(true);
    expect(showsBilingualDescription(general, 'cloze')).toBe(true);
    expect(showsBilingualDescription(general, 'context')).toBe(true);
  });

  it('does not force translation into listening, speaking or IELTS', () => {
    const general = word({ id: '7', term: 'umbrella', meaningVi: 'cái ô' });
    const ielts = word({ id: '8', term: 'umbrella', meaningVi: 'cái ô', track: 'ielts' });
    expect(showsBilingualDescription(general, 'listening')).toBe(false);
    expect(showsBilingualDescription(general, 'speaking')).toBe(false);
    expect(showsBilingualDescription(general, 'en_to_vi')).toBe(false);
    expect(showsBilingualDescription(ielts, 'typing')).toBe(false);
  });
});

import type { AiSuggestion } from '../../ai/types';
import { buildSuggestionPools, matchSuggestion } from '../match';
import type { ParsedListItem } from '../parse';

function suggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    term: 'borrow',
    meaningVi: 'mượn',
    partOfSpeech: 'verb',
    source: 'ai',
    aiGenerated: true,
    confirmed: false,
    ipa: null,
    ...overrides,
  };
}

function item(value: string, language: ParsedListItem['language']): ParsedListItem {
  return { value, language };
}

function match(
  requested: ParsedListItem[],
  answers: AiSuggestion[],
  index = 0,
  claimed: Set<AiSuggestion> = new Set(),
) {
  const pools = buildSuggestionPools(answers);
  const found = matchSuggestion(requested[index] ?? item('', 'en'), index, pools, claimed);
  if (found) claimed.add(found);
  return found;
}

describe('matchSuggestion', () => {
  it('matches an English item to the answer with the same term', () => {
    const found = match(
      [item('take into account', 'en')],
      [suggestion({ term: 'take into account', meaningVi: 'tính đến' })],
    );
    expect(found?.meaningVi).toBe('tính đến');
  });

  it('forgives the "to " prefix the model likes to add', () => {
    const found = match([item('abandon', 'en')], [suggestion({ term: 'to abandon' })]);
    expect(found?.term).toBe('to abandon');
  });

  it('matches a translated Vietnamese row by the learner’s own text', () => {
    const found = match(
      [item('trách nhiệm dân sự', 'vi')],
      [
        suggestion({
          term: 'civil liability',
          sourceVi: 'trách nhiệm dân sự',
          englishOptions: ['civil liability', 'civil responsibility'],
        }),
      ],
    );
    expect(found?.term).toBe('civil liability');
    expect(found?.sourceVi).toBe('trách nhiệm dân sự');
  });

  it('falls back to position for a Vietnamese row that omits sourceVi', () => {
    const found = match(
      [item('bảo vệ môi trường', 'vi')],
      [suggestion({ term: 'environmental protection', meaningVi: 'bảo vệ môi trường' })],
    );
    expect(found?.term).toBe('environmental protection');
  });

  it('never hands the same answer to two rows', () => {
    const answers = [
      suggestion({ term: 'civil liability', sourceVi: 'trách nhiệm dân sự' }),
      suggestion({ term: 'environmental protection', sourceVi: 'bảo vệ môi trường' }),
    ];
    const requested = [item('trách nhiệm dân sự', 'vi'), item('bảo vệ môi trường', 'vi')];
    const claimed = new Set<AiSuggestion>();

    const first = match(requested, answers, 0, claimed);
    const second = match(requested, answers, 1, claimed);

    expect(first?.term).toBe('civil liability');
    expect(second?.term).toBe('environmental protection');
  });

  it('leaves an unanswered row unmatched instead of borrowing another answer', () => {
    const found = match(
      [item('ubiquitous', 'en')],
      [suggestion({ term: 'unabridged', sourceVi: 'không rút gọn' })],
    );
    expect(found).toBeNull();
  });

  it('does not use position for an English row', () => {
    const found = match([item('ubiquitous', 'en')], [suggestion({ term: 'criminal' })]);
    expect(found).toBeNull();
  });

  it('rejects a positional guess whose source belongs to a different item', () => {
    const found = match(
      [item('bảo vệ môi trường', 'vi')],
      [suggestion({ term: 'civil liability', sourceVi: 'trách nhiệm dân sự' })],
    );
    expect(found).toBeNull();
  });
});

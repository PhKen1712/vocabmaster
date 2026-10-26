import { buildPrompt } from '../prompt';
import type { AiRequest } from '../types';

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    track: 'general',
    level: 2,
    count: 10,
    avoidTerms: ['water', 'borrow'],
    weakTerms: [],
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('asks for a simple everyday meaning when explaining a pasted list', () => {
    const prompt = buildPrompt(
      request({
        count: 20,
        explainTerms: ['make a decision', 'run out of', '  '],
      }),
    );

    expect(prompt).toContain('Explain exactly 2 English item(s)');
    expect(prompt).toContain('1. make a decision');
    expect(prompt).toContain('2. run out of');
    expect(prompt).toContain('most common, everyday Vietnamese meaning');
    expect(prompt).toContain('not an academic or technical sense');
    expect(prompt).toContain('Never split it into separate words');
    // A list request must not turn into a "pick words for me" request.
    expect(prompt).not.toContain('Create 10 English vocabulary items');
    expect(prompt).not.toContain('Do not repeat any of these existing terms');
  });

  it('asks for an English term first when the pasted items are Vietnamese', () => {
    const prompt = buildPrompt(
      request({
        count: 20,
        explainTerms: ['trách nhiệm dân sự', 'bảo vệ môi trường'],
        translateFromVi: true,
      }),
    );

    expect(prompt).toContain('typed 2 item(s) in Vietnamese');
    expect(prompt).toContain('1. trách nhiệm dân sự');
    expect(prompt).toContain('2. bảo vệ môi trường');
    expect(prompt).toContain('never split or merge');
    expect(prompt).toContain('sourceVi');
    expect(prompt).toContain('englishOptions');
    expect(prompt).toContain('level: judge the ENGLISH term');
    // Still a list request: the learner chose the items, the model may not.
    expect(prompt).not.toContain('Create 10 English vocabulary items');
  });

  it('uses the English explanation prompt when the list is English', () => {
    const prompt = buildPrompt(request({ explainTerms: ['make a decision'] }));

    expect(prompt).toContain('Explain exactly 1 English item(s)');
    expect(prompt).not.toContain('in Vietnamese');
  });

  it('keeps the normal generation prompt when there is no pasted list', () => {
    const prompt = buildPrompt(request());

    expect(prompt).toContain('Create 10 English vocabulary items');
    expect(prompt).not.toContain('Explain exactly');
  });
});

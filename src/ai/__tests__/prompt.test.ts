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

  it('keeps the normal generation prompt when there is no pasted list', () => {
    const prompt = buildPrompt(request());

    expect(prompt).toContain('Create 10 English vocabulary items');
    expect(prompt).not.toContain('Explain exactly');
  });
});

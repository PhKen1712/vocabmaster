import { createMemoryDictCache } from '../../db/dictCache';
import {
  DictRequestError,
  entryToWordInput,
  lookupWord,
  lookupWords,
  mergeResults,
} from '../lookup';
import type { HttpClient, HttpResult } from '../types';

/**
 * Payloads below are trimmed copies of real responses captured on 2026-10-22
 * with `curl https://dict.minhqnd.com/api/v1/lookup?word=criminal&lang=en` and
 * `curl https://api.dictionaryapi.dev/api/v2/entries/en/criminal`.
 */
const MQ: Record<string, string> = {
  criminal: JSON.stringify({
    exists: true,
    word: 'criminal',
    results: [
      {
        lang_code: 'en',
        lang_name: 'Tiếng Anh',
        audio: '/api/v1/tts?word=criminal&lang=en',
        meanings: [
          {
            definition: 'Có tội, phạm tội, tội ác.',
            definition_lang: 'vi',
            example: 'a criminal act',
            pos: 'Tính từ',
            source: 'Wiktionary',
          },
          {
            definition: 'Kẻ phạm tội, tội phạm.',
            definition_lang: 'vi',
            example: 'war criminal',
            pos: 'Danh từ',
            source: 'Wiktionary',
          },
        ],
        pronunciations: [{ ipa: '/ˈkrɪ.mə.nᵊl/', region: null }],
        relations: [
          { related_word: 'lawbreaker', relation_type: 'Đồng nghĩa' },
          { related_word: 'criminal conversation', relation_type: 'Liên quan' },
        ],
      },
    ],
  }),
  civil: JSON.stringify({
    exists: true,
    word: 'civil',
    results: [
      {
        lang_code: 'en',
        lang_name: 'Tiếng Anh',
        audio: '/api/v1/tts?word=civil&lang=en',
        meanings: [
          {
            definition: '(Thuộc) công dân.',
            definition_lang: 'vi',
            example: 'civil rights',
            pos: 'Tính từ',
          },
        ],
        pronunciations: [
          { ipa: '/ˈsɪv.əl/', region: null },
          { ipa: 'ʹsĭv-əl', region: null },
        ],
        relations: [{ related_word: 'civil defence', relation_type: 'Liên quan' }],
      },
    ],
  }),
  justice: JSON.stringify({
    exists: true,
    word: 'justice',
    results: [
      {
        lang_code: 'en',
        lang_name: 'Tiếng Anh',
        audio: '/api/v1/tts?word=justice&lang=en',
        meanings: [
          {
            definition: 'Sự công bằng.',
            definition_lang: 'vi',
            example: 'in justice to somebody',
            pos: 'Danh từ',
          },
        ],
        pronunciations: [{ ipa: '/ˈdʒəs.təs/', region: null }],
        relations: [],
      },
    ],
  }),
  evidence: JSON.stringify({
    exists: true,
    word: 'evidence',
    results: [
      {
        lang_code: 'en',
        lang_name: 'Tiếng Anh',
        audio: '/api/v1/tts?word=evidence&lang=en',
        meanings: [
          {
            definition: 'Chứng, chứng cớ, bằng chứng.',
            definition_lang: 'vi',
            example: 'to bear (give) evidence',
            pos: 'Danh từ',
          },
        ],
        pronunciations: [{ ipa: '/ˈɛ.və.dənts/', region: null }],
        relations: [],
      },
    ],
  }),
};

const WK: Record<string, string> = {
  criminal: JSON.stringify([
    {
      word: 'criminal',
      phonetic: '/ˈkɹɪmənəl/',
      phonetics: [
        {
          text: '/ˈkɹɪmənəl/',
          audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/criminal-us.mp3',
        },
      ],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'A person who is guilty of a crime, notably breaking the law.',
              synonyms: ['lawbreaker', 'offender', 'perpetrator'],
              antonyms: [],
            },
          ],
          synonyms: ['lawbreaker', 'offender', 'perpetrator'],
          antonyms: [],
        },
      ],
    },
  ]),
  civil: JSON.stringify([
    {
      word: 'civil',
      phonetic: '/ˈsɪv.əl/',
      phonetics: [
        {
          text: '/ˈsɪv.əl/',
          audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/civil-us.mp3',
        },
      ],
      meanings: [
        {
          partOfSpeech: 'adjective',
          definitions: [
            {
              definition:
                'Having to do with people and government office as opposed to the military or religion.',
              example: 'She went into civil service because she wanted to help the people.',
              synonyms: [],
              antonyms: ['impolite'],
            },
          ],
          synonyms: [],
          antonyms: ['impolite'],
        },
      ],
    },
  ]),
  justice: JSON.stringify([
    {
      word: 'justice',
      phonetic: '/ˈdʒʌs.tɪs/',
      phonetics: [
        {
          text: '/ˈdʒʌs.tɪs/',
          audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/justice-us.mp3',
        },
      ],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'The state or characteristic of being just or fair.',
              example: 'the justice of a description',
            },
          ],
          synonyms: ['judge'],
          antonyms: ['injustice'],
        },
      ],
    },
  ]),
  evidence: JSON.stringify([
    {
      word: 'evidence',
      phonetic: '[ˈɛvəɾəns]',
      phonetics: [
        {
          text: '[ˈɛvəɾəns]',
          audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/evidence-us.mp3',
        },
      ],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'Facts or observations presented in support of an assertion.',
              example: 'There is no evidence that anyone was here earlier.',
            },
          ],
          synonyms: [],
          antonyms: [],
        },
      ],
    },
  ]),
};

function isMinhqnd(url: string): boolean {
  return url.includes('minhqnd');
}

function termOf(url: string): string {
  if (isMinhqnd(url)) {
    const match = url.match(/word=([^&]+)/);
    return decodeURIComponent(match?.[1] ?? '');
  }
  return decodeURIComponent(url.split('/').pop() ?? '');
}

function route(url: string): HttpResult {
  const term = termOf(url);
  const table = isMinhqnd(url) ? MQ : WK;
  const body = table[term];
  if (body) return { status: 200, body, headers: {} };
  return isMinhqnd(url)
    ? { status: 404, body: JSON.stringify({ exists: false, word: term }), headers: {} }
    : // The verified Cloudflare leak for unknown words.
      { status: 530, body: 'error code: 1033\n', headers: {} };
}

function fixtureClient(calls: string[] = []): HttpClient {
  return async (url) => {
    calls.push(url);
    return route(url);
  };
}

jest.setTimeout(15_000);

describe('lookupWords', () => {
  it('resolves the four verified words from both dictionaries', async () => {
    const entries = await lookupWords(['criminal', 'civil', 'justice', 'evidence'], {
      client: fixtureClient(),
      attempts: 1,
    });

    expect(entries.map((entry) => entry.status)).toEqual(['found', 'found', 'found', 'found']);
    for (const entry of entries) {
      expect(entry.sources).toEqual(expect.arrayContaining(['minhqnd', 'wiktionary']));
      expect(entry.meaningVi).toBeTruthy();
      expect(entry.ipa).toMatch(/^[/[].*[/\]]$/);
      expect(entry.audioUrl).toMatch(/^https:\/\//);
    }

    const criminal = entries[0]!;
    expect(criminal.meaningVi).toBe('Có tội, phạm tội, tội ác.');
    expect(criminal.otherMeaningsVi).toContain('Kẻ phạm tội, tội phạm.');
    expect(criminal.partOfSpeech).toBe('adjective');
    expect(criminal.definitionEn).toBe(
      'A person who is guilty of a crime, notably breaking the law.',
    );
    // Real recording is preferred over the TTS fallback.
    expect(criminal.audioUrl).toContain('dictionaryapi.dev');
    expect(criminal.synonyms).toEqual(expect.arrayContaining(['lawbreaker']));
    expect(criminal.missing).not.toContain('meaningVi');
  });

  it('reports "not found" when both dictionaries have no answer', async () => {
    const [entry] = await lookupWords(['zzqqxxvvyy'], { client: fixtureClient(), attempts: 1 });
    expect(entry!.status).toBe('notFound');
    expect(entry!.error).toBeUndefined();
    expect(entry!.missing.length).toBeGreaterThan(0);
  });

  it('keeps one bad word from breaking the rest of the batch', async () => {
    const entries = await lookupWords(['criminal', 'zzqqxxvvyy', 'civil'], {
      client: fixtureClient(),
      attempts: 1,
    });
    expect(entries.map((entry) => entry.term)).toEqual(['criminal', 'zzqqxxvvyy', 'civil']);
    expect(entries.map((entry) => entry.status)).toEqual(['found', 'notFound', 'found']);
  });

  it('marks the fields a partial answer could not fill', async () => {
    const [entry] = await lookupWords(['civil'], {
      client: async (url) =>
        isMinhqnd(url) ? route(url) : { status: 404, body: '', headers: {} },
      attempts: 1,
    });
    expect(entry!.status).toBe('found');
    expect(entry!.meaningVi).toBe('(Thuộc) công dân.');
    expect(entry!.missing).toEqual(
      expect.arrayContaining(['definitionEn', 'exampleEn', 'synonyms']),
    );
    expect(entry!.missing).not.toContain('meaningVi');
    expect(entry!.missing).not.toContain('ipa');
  });

  it('retries a 429 once and succeeds', async () => {
    let attemptsOnMinhqnd = 0;
    const client: HttpClient = async (url) => {
      if (isMinhqnd(url)) {
        attemptsOnMinhqnd += 1;
        if (attemptsOnMinhqnd === 1) {
          return { status: 429, body: '', headers: { 'retry-after': '0' } };
        }
      }
      return route(url);
    };

    const [entry] = await lookupWords(['criminal'], { client, attempts: 2 });
    expect(attemptsOnMinhqnd).toBe(2);
    expect(entry!.status).toBe('found');
  });

  it('stops after the attempt budget and reports a timeout', async () => {
    let calls = 0;
    const client: HttpClient = async () => {
      calls += 1;
      throw new DictRequestError({ code: 'timeout', message: 'Hết 8 giây chờ từ điển.' });
    };

    const [entry] = await lookupWords(['criminal'], { client, attempts: 2 });
    expect(entry!.status).toBe('failed');
    expect(entry!.error?.code).toBe('timeout');
    // Two sources × two attempts. No third layer of retries hides the failure.
    expect(calls).toBe(4);
  });

  it('never retries a 404', async () => {
    let calls = 0;
    const client: HttpClient = async (url) => {
      calls += 1;
      return isMinhqnd(url)
        ? { status: 404, body: JSON.stringify({ exists: false }), headers: {} }
        : { status: 404, body: JSON.stringify([{ title: 'No Definitions Found' }]), headers: {} };
    };

    const [entry] = await lookupWords(['criminal'], { client, attempts: 3 });
    expect(entry!.status).toBe('notFound');
    expect(calls).toBe(2);
  });

  it('caps concurrent requests', async () => {
    let inFlight = 0;
    let peak = 0;
    const client: HttpClient = async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return route(url);
    };

    await lookupWords(['criminal', 'civil', 'justice', 'evidence'], { client, concurrency: 3, attempts: 1 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('serves a repeat lookup from the cache without any request', async () => {
    const cache = createMemoryDictCache();
    const calls: string[] = [];

    await lookupWords(['criminal', 'civil'], { client: fixtureClient(calls), cache, attempts: 1 });
    const firstRound = calls.length;
    expect(firstRound).toBe(4);

    const second = await lookupWords(['criminal', 'civil'], {
      client: async (url) => {
        calls.push(url);
        throw new DictRequestError({ code: 'network', message: 'offline' });
      },
      cache,
      attempts: 1,
    });

    expect(calls.length).toBe(firstRound);
    expect(second.every((entry) => entry.cached)).toBe(true);
    expect(second.every((entry) => entry.status === 'found')).toBe(true);
    expect(second[0]!.meaningVi).toBe('Có tội, phạm tội, tội ác.');
  });

  it('uses Gemini only where a Vietnamese meaning is missing, and labels it', async () => {
    const withoutVi = JSON.stringify({
      exists: true,
      word: 'civil',
      results: [
        {
          lang_code: 'en',
          meanings: [
            { definition: 'Of or relating to citizens.', definition_lang: 'en', pos: 'Tính từ' },
          ],
          pronunciations: [{ ipa: '/ˈsɪv.əl/' }],
        },
      ],
    });

    const translated: string[] = [];
    const entries = await lookupWords(['criminal', 'civil'], {
      client: async (url) => {
        if (isMinhqnd(url) && termOf(url) === 'civil') {
          return { status: 200, body: withoutVi, headers: {} };
        }
        return route(url);
      },
      attempts: 1,
      aiTranslateLimit: 5,
      aiTranslate: async (term) => {
        translated.push(term);
        return { meaningVi: `Nghĩa do AI cho ${term}.` };
      },
    });

    expect(translated).toEqual(['civil']);
    expect(entries[0]!.aiFilled).toEqual([]);
    expect(entries[1]!.aiFilled).toContain('meaningVi');
    expect(entries[1]!.sources).toContain('gemini');
    expect(entries[1]!.missing).not.toContain('meaningVi');
  });
});

describe('entryToWordInput', () => {
  it('maps a resolved entry onto the existing word model', async () => {
    const [entry] = await lookupWords(['criminal'], { client: fixtureClient(), attempts: 1 });
    const input = entryToWordInput(entry!, { track: 'ielts', level: 4, topic: 'Law' });

    expect(input).toMatchObject({
      term: 'criminal',
      meaningVi: 'Có tội, phạm tội, tội ác.',
      track: 'ielts',
      level: 4,
      topic: 'Law',
      source: 'dictionary',
      aiGenerated: false,
      confirmed: true,
      dictSource: 'minhqnd+wiktionary',
    });
    expect(input!.missingFields).toEqual(entry!.missing);
  });

  it('refuses to turn a word without a Vietnamese meaning into a saved word', async () => {
    const [entry] = await lookupWords(['zzqqxxvvyy'], { client: fixtureClient(), attempts: 1 });
    expect(entryToWordInput(entry!, { track: 'general', level: 2 })).toBeNull();
  });
});

describe('mergeResults', () => {
  it('prefers Vietnamese data for meaning and IPA, English data for definition', () => {
    const merged = mergeResults('criminal', [
      {
        source: 'minhqnd',
        found: true,
        ipa: '/ˈkrɪ.mə.nᵊl/',
        audioUrl: null,
        partOfSpeech: 'adjective',
        meaningsVi: ['Có tội, phạm tội, tội ác.'],
        definitionsEn: [],
        exampleEn: null,
        synonyms: [],
        antonyms: [],
      },
      {
        source: 'wiktionary',
        found: true,
        ipa: '/ˈkɹɪmənəl/',
        audioUrl: 'https://example.test/criminal.mp3',
        partOfSpeech: 'noun',
        meaningsVi: [],
        definitionsEn: ['A person who is guilty of a crime.'],
        exampleEn: 'The criminal was caught.',
        synonyms: ['lawbreaker'],
        antonyms: [],
      },
    ]);

    expect(merged.status).toBe('found');
    expect(merged.meaningVi).toBe('Có tội, phạm tội, tội ác.');
    expect(merged.ipa).toBe('/ˈkrɪ.mə.nᵊl/');
    expect(merged.definitionEn).toBe('A person who is guilty of a crime.');
    expect(merged.audioUrl).toBe('https://example.test/criminal.mp3');
    expect(merged.missing).toEqual([]);
  });

  it('marks a failed lookup with the most actionable error', () => {
    const merged = mergeResults('criminal', [
      {
        source: 'minhqnd',
        found: false,
        ipa: null,
        audioUrl: null,
        partOfSpeech: null,
        meaningsVi: [],
        definitionsEn: [],
        exampleEn: null,
        synonyms: [],
        antonyms: [],
        error: { code: 'network', message: 'offline' },
      },
      {
        source: 'wiktionary',
        found: false,
        ipa: null,
        audioUrl: null,
        partOfSpeech: null,
        meaningsVi: [],
        definitionsEn: [],
        exampleEn: null,
        synonyms: [],
        antonyms: [],
        error: { code: 'rate_limited', message: '429' },
      },
    ]);

    expect(merged.status).toBe('failed');
    expect(merged.error?.code).toBe('rate_limited');
  });
});

describe('lookupWord', () => {
  it('wraps a single term', async () => {
    const entry = await lookupWord('civil', { client: fixtureClient(), attempts: 1 });
    expect(entry.term).toBe('civil');
    expect(entry.status).toBe('found');
  });
});

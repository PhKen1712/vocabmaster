import type { Level, Track } from '../types';
import type { AiRequest } from './types';

const CEFR_NOTES: Record<Level, string> = {
  0: 'absolute beginner (pre-A1): very common everyday words, short and concrete',
  1: 'CEFR A1: survival vocabulary, high-frequency everyday words',
  2: 'CEFR A2: everyday topics, simple phrasal verbs and collocations',
  3: 'CEFR B1: comfortable everyday communication and simple work topics',
  4: 'CEFR B2: confident communication, abstract topics, useful collocations',
  5: 'CEFR C1: advanced academic vocabulary, precision and paraphrase',
  6: 'CEFR C2 / specialist: nuanced, low-frequency but genuinely useful academic language',
};

const TRACK_NOTES: Record<Track, string> = {
  general:
    'General English for real conversation: daily life, family, study, work, travel, shopping, food, feelings, health, weather, environment, natural collocations and phrasal verbs.',
  ielts:
    'IELTS Academic vocabulary: academic word list items, IELTS topic vocabulary, academic collocations, synonyms for paraphrasing, useful for Writing Task 2, Speaking Part 3 and Reading.',
};

export function buildPrompt(request: AiRequest): string {
  if (request.lookupTerm && request.lookupTerm.trim()) {
    return buildLookupPrompt(request.lookupTerm.trim(), request);
  }

  const avoid = request.avoidTerms.slice(0, 80);
  const weak = request.weakTerms.slice(0, 20);
  const topic = request.topic?.trim() || 'any useful topic';
  const focus = request.focus?.trim();

  return [
    `Create ${request.count} English vocabulary items.`,
    `Track: ${request.track === 'ielts' ? 'IELTS Vocabulary' : 'General English'}.`,
    `Difficulty: ${CEFR_NOTES[request.level]}. Do not make every word harder than this level.`,
    `Topic: ${topic}.`,
    focus ? `Special focus: ${focus}.` : '',
    TRACK_NOTES[request.track],
    '',
    'Hard requirements:',
    '- Each item needs: term, IPA with slashes, part of speech, Vietnamese meaning (meaningVi), a simple English definition, one natural English example sentence and its Vietnamese translation.',
    '- Add collocations and word family where they are natural; do not invent grammar patterns.',
    '- Vietnamese meanings must be accurate and natural, not machine-literal.',
    '- Example sentences must contain the target term exactly as written.',
    '- Level must be an integer 0-6 and must match the requested difficulty. Never label a basic word as C1.',
    '- Do not repeat any of these existing terms: ' + (avoid.length ? avoid.join(', ') : '(none yet)') + '.',
    weak.length
      ? '- The learner often forgets these words; include at most two of them if they fit the topic: ' +
        weak.join(', ')
      : '',
    '- Return valid JSON only, no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"words":[{"term":"string","ipa":"/.../","partOfSpeech":"noun|verb|adjective|adverb|phrase|idiom|phrasal verb","meaningVi":"string","definitionEn":"string","exampleEn":"string","exampleVi":"string","synonyms":["string"],"antonyms":["string"],"collocations":["string"],"wordFamily":["string"],"topic":"string","level":0,"rationale":"short reason in Vietnamese"}]}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function buildLookupPrompt(term: string, request: AiRequest): string {
  return [
    `Explain exactly one English item: "${term}".`,
    `Use it for the ${request.track === 'ielts' ? 'IELTS' : 'General English'} track at level ${request.level}.`,
    '',
    'Requirements:',
    '- Return exactly one item in the words array, and its term must be exactly the item above (keep "to" only if the item starts with "to ").',
    '- Provide IPA with slashes only if you are confident; otherwise omit the field.',
    '- meaningVi must be an accurate, natural Vietnamese meaning for this item in context.',
    '- definitionEn must be simple English. exampleEn must contain the term and be a natural sentence; exampleVi is its translation.',
    '- Add collocations, word family, synonyms and antonyms only when they are real.',
    '- Do not add other words.',
    '- Return valid JSON only, no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"words":[{"term":"string","ipa":"/.../","partOfSpeech":"noun|verb|adjective|adverb|phrase|idiom|phrasal verb","meaningVi":"string","definitionEn":"string","exampleEn":"string","exampleVi":"string","synonyms":["string"],"antonyms":["string"],"collocations":["string"],"wordFamily":["string"],"topic":"string","level":0,"rationale":"short reason in Vietnamese"}]}',
  ].join('\n');
}

export const SYSTEM_INSTRUCTION =
  'You are a careful English-Vietnamese lexicographer building a personal vocabulary app. ' +
  'Accuracy matters more than volume. If you are unsure about a field, omit it rather than inventing it. ' +
  'Never output IPA you are not confident about, and never output Vietnamese with the wrong tone marks. ' +
  'Respond with JSON only.';

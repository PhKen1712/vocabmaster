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
  const explain = (request.explainTerms ?? []).map((term) => term.trim()).filter(Boolean);
  if (explain.length > 0) {
    return buildExplainPrompt(explain, request);
  }

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

/**
 * One batch request for a pasted list. The learner already chose the words, so
 * the model must not pick different ones; it explains these exact items with a
 * short, everyday Vietnamese meaning instead of copying an academic dictionary
 * sense.
 */
function buildExplainPrompt(terms: string[], request: AiRequest): string {
  return [
    `Explain exactly ${terms.length} English item(s) for a Vietnamese learner.`,
    `Track: ${request.track === 'ielts' ? 'IELTS Vocabulary' : 'General English'}. Learner level: ${request.level}.`,
    '',
    'Items (keep this order and the exact spelling):',
    ...terms.map((term, index) => `${index + 1}. ${term}`),
    '',
    'Meaning rules — this is the part that matters most:',
    '- meaningVi must be the most common, everyday Vietnamese meaning a learner meets first (2–8 words), not an academic or technical sense.',
    '- Prefer a clear explanation over a dictionary gloss: "make a decision" → "đưa ra quyết định", not "thi hành phán quyết".',
    '- If the item has several common senses, use the everyday sense; put another genuinely common sense in a second array if useful.',
    '- A phrase, idiom or collocation is ONE unit. Never split it into separate words or translate it word by word.',
    '- definitionEn must be simple A2–B1 English, not dictionary jargon.',
    '- exampleEn must be a natural sentence containing the item exactly; exampleVi is its natural translation.',
    '- partOfSpeech must match the chosen sense; omit ipa unless you are confident.',
    '- Do not add items that were not asked for and do not skip an item. If you cannot explain one, still return it with the best honest meaning.',
    '- Return valid JSON only, no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"words":[{"term":"string","ipa":"/.../","partOfSpeech":"noun|verb|adjective|adverb|phrase|idiom|phrasal verb","meaningVi":"string","definitionEn":"string","exampleEn":"string","exampleVi":"string","synonyms":["string"],"antonyms":["string"],"collocations":["string"],"wordFamily":["string"],"topic":"string","level":0}]}',
  ].join('\n');
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

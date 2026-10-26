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
    return request.translateFromVi
      ? buildTranslatePrompt(explain, request)
      : buildExplainPrompt(explain, request);
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
    `Target difficulty for choosing words: ${CEFR_NOTES[request.level]}.`,
    `Topic: ${topic}.`,
    focus ? `Special focus: ${focus}.` : '',
    TRACK_NOTES[request.track],
    '',
    'Hard requirements:',
    '- Each item needs: term, IPA with slashes, part of speech, Vietnamese meaning (meaningVi), a simple English definition, one natural English example sentence and its Vietnamese translation.',
    '- Add collocations and word family where they are natural; do not invent grammar patterns.',
    '- Vietnamese meanings must be accurate and natural, not machine-literal.',
    '- Example sentences must contain the target term exactly as written.',
    '- Level is judged per item from its actual CEFR difficulty (meaning, usage and frequency), not copied from the requested level. The requested level only guides which words you choose; a B1 word stays B1 even when the learner asked for B2.',
    '- Level must be an integer 0-6. Never label a basic word as C1 or an advanced word as A2.',
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
    `Track: ${request.track === 'ielts' ? 'IELTS Vocabulary' : 'General English'}. The learner selected level ${request.level}, but that is only a starting point: judge every item independently.`,
    '',
    'Level rules (required for every item):',
    '- Assign level 0-6 by the item\'s real CEFR difficulty: 0 pre-A1, 1 A1, 2 A2, 3 B1, 4 B2, 5 C1, 6 C2.',
    '- Judge the specific sense you chose, not just the spelling. A phrase or idiom is judged as one unit (take into account is B2, not A2 because of the individual words).',
    '- Do not copy the learner\'s selected level. If they chose B2 but the item is B1, return 3.',
    '- Never infer level from word length, and never invent a level you cannot justify.',
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
    '- Always include level for every item. This field is required, even when the learner already picked a level.',
    '- Return valid JSON only, no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"words":[{"term":"string","ipa":"/.../","partOfSpeech":"noun|verb|adjective|adverb|phrase|idiom|phrasal verb","meaningVi":"string","definitionEn":"string","exampleEn":"string","exampleVi":"string","synonyms":["string"],"antonyms":["string"],"collocations":["string"],"wordFamily":["string"],"topic":"string","level":0}]}',
  ].join('\n');
}

/**
 * Vietnamese items: translate first, then explain the English term.
 *
 * The learner typed Vietnamese, so the dictionary fields must describe the
 * English term that carries the meaning — not the Vietnamese spelling, and not
 * a loose association. The model has to copy its source back so the preview can
 * show both languages side by side.
 */
function buildTranslatePrompt(items: string[], request: AiRequest): string {
  return [
    `The learner typed ${items.length} item(s) in Vietnamese. Give each one the English term a learner should study, then explain it.`,
    `Track: ${request.track === 'ielts' ? 'IELTS Vocabulary' : 'General English'}. The learner selected level ${request.level}, but that is only a hint.`,
    '',
    'Translation rules — this is the hardest part, do it carefully:',
    '- Pick the English term or phrase that carries the SAME everyday meaning. Do not pick a loosely related word.',
    '- A Vietnamese phrase stays a phrase: "bảo vệ môi trường" → "environmental protection", never three separate words.',
    '- For a specialised term, decide the most likely context first and then use the standard English term for that context ("trách nhiệm dân sự" → "civil liability", not "civil responsibility" unless that is the standard term in that field).',
    '- Use the same style as a dictionary entry: lowercase, no "to " prefix for verbs unless the item is a verb phrase, no added articles.',
    '- Never invent a term you are unsure of. If several readings are possible, return the most common one as `term` and list the other acceptable ones in `englishOptions`.',
    '- `sourceVi` must repeat the learner\'s own text exactly, with its diacritics, unchanged.',
    '',
    'Items (keep this order; never split or merge them):',
    ...items.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Then fill the study fields for the ENGLISH term you chose:',
    '- meaningVi: the most common, everyday Vietnamese meaning of that English term (2–8 words), which must match the learner\'s original meaning.',
    '- definitionEn: simple A2–B1 English, not dictionary jargon.',
    '- exampleEn: a natural sentence containing the English term exactly; exampleVi is its natural translation.',
    '- partOfSpeech must match the English term; omit ipa unless you are confident about it.',
    '- level: judge the ENGLISH term\'s real CEFR difficulty (0 pre-A1 … 6 C2) by meaning, usage and frequency — never by word length, and never by the Vietnamese spelling. Do not copy the learner\'s selected level; a B1 term stays B1 even when they chose B2.',
    '- englishOptions: up to 3 acceptable English terms, best first, and `term` must be the first of them. Use an array with just `term` when there is only one good answer.',
    '- uncertain: true only when you were not confident about the translation. Be honest: a flagged row is reviewed by the learner, a wrong silent row is not.',
    '- Return valid JSON only, no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"words":[{"term":"string","sourceVi":"string","englishOptions":["string"],"uncertain":false,"ipa":"/.../","partOfSpeech":"noun|verb|adjective|adverb|phrase|idiom|phrasal verb","meaningVi":"string","definitionEn":"string","exampleEn":"string","exampleVi":"string","synonyms":["string"],"antonyms":["string"],"collocations":["string"],"wordFamily":["string"],"topic":"string","level":0}]}',
  ].join('\n');
}

function buildLookupPrompt(term: string, request: AiRequest): string {
  return [
    `Explain exactly one English item: "${term}".`,
    `Use it for the ${request.track === 'ielts' ? 'IELTS' : 'General English'} track. The learner selected level ${request.level}, but judge this item independently.`,
    '',
    'Requirements:',
    '- Assign level 0-6 from the item\'s actual CEFR difficulty for this specific sense. Do not copy the selected level; a B1 item stays B1 when the learner chose B2.',
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

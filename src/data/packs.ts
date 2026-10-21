import type { Level, Track } from '../types';
import type { SeedWord } from './seed';

/**
 * Bundled word packs.
 *
 * Why a pack instead of asking Gemini every time:
 * - study, review, placement and the minigame all work offline with no key;
 * - no quota, no latency, no failure modes on the critical path;
 * - the content is reviewable once, instead of an unverifiable answer per run.
 *
 * Content rules for every row (enforced by `src/data/__tests__/packs.test.ts`):
 * - high-utility words only: things a learner meets in real life or IELTS;
 * - Vietnamese meaning must be a real translation, never the English word;
 * - level is the CEFR band of the *word*, not of the learner;
 * - no duplicate (term, track) inside the packs or against `SEED_WORDS`.
 *
 * IPA is intentionally absent in this first tranche: inventing it is worse than
 * leaving it empty. `scripts/fill-ipa.mjs` can add IPA from CMUdict (public
 * license) later, and the UI already falls back to on-device speech.
 */

/** [term, meaningVi, partOfSpeech, level, topic, definitionEn?, exampleEn?] */
export type PackRow = readonly [
  term: string,
  meaningVi: string,
  partOfSpeech: string,
  level: Level,
  topic: string,
  definitionEn?: string,
  exampleEn?: string,
];

export interface WordPack {
  id: string;
  name: string;
  track: Track;
  /** Size this pack is designed to reach; rows may be fewer until complete. */
  targetSize: number;
  rows: PackRow[];
}

/**
 * Fewer words at higher levels, because the number of genuinely useful words
 * drops sharply there. Each track sums to 2500.
 */
export const TARGET_DISTRIBUTION: Record<Track, Record<Level, number>> = {
  general: { 0: 550, 1: 500, 2: 450, 3: 400, 4: 300, 5: 200, 6: 100 },
  ielts: { 0: 0, 1: 0, 2: 700, 3: 650, 4: 600, 5: 400, 6: 150 },
};

const GENERAL_ROWS: PackRow[] = [
  // Starter — things you need in the first week
  ['water', 'nước', 'noun', 0, 'Daily life', 'the liquid we drink', 'Can I have a glass of water?'],
  ['eat', 'ăn', 'verb', 0, 'Food', 'to put food in your mouth and swallow it', 'We eat rice every day.'],
  ['sleep', 'ngủ', 'verb', 0, 'Daily life', 'to rest with your eyes closed', 'I sleep eight hours a night.'],
  ['house', 'ngôi nhà', 'noun', 0, 'Home', 'a building where people live', 'Their house is near the market.'],
  ['friend', 'bạn', 'noun', 0, 'People', 'a person you like and know well', 'She is my best friend.'],
  ['family', 'gia đình', 'noun', 0, 'People', 'parents and children together', 'My family has four people.'],
  ['school', 'trường học', 'noun', 0, 'Study', 'a place where children learn', 'The children walk to school.'],
  ['book', 'sách', 'noun', 0, 'Study', 'pages with text you read', 'This book is easy to read.'],
  ['money', 'tiền', 'noun', 0, 'Money', 'coins and notes used to buy things', 'I do not have enough money.'],
  ['happy', 'vui', 'adjective', 0, 'Feelings', 'feeling good and pleased', 'She looks happy today.'],
  ['sad', 'buồn', 'adjective', 0, 'Feelings', 'feeling unhappy', 'He was sad about the news.'],
  ['hot', 'nóng', 'adjective', 0, 'Weather', 'having a high temperature', 'It is very hot in summer.'],
  ['cold', 'lạnh', 'adjective', 0, 'Weather', 'having a low temperature', 'The water is too cold.'],
  ['big', 'to, lớn', 'adjective', 0, 'Description', 'large in size', 'They live in a big city.'],
  ['small', 'nhỏ', 'adjective', 0, 'Description', 'little in size', 'This shirt is too small.'],

  // A1 — everyday actions and situations
  ['buy', 'mua', 'verb', 1, 'Shopping', 'to get something by paying money', 'I want to buy a new phone.'],
  ['sell', 'bán', 'verb', 1, 'Shopping', 'to give something for money', 'They sell fruit at the market.'],
  ['open', 'mở', 'verb', 1, 'Daily life', 'to move something so it is not closed', 'Please open the window.'],
  ['start', 'bắt đầu', 'verb', 1, 'Daily life', 'to begin doing something', 'The class starts at eight.'],
  ['finish', 'kết thúc', 'verb', 1, 'Daily life', 'to complete something', 'I finish work at six.'],
  ['help', 'giúp', 'verb', 1, 'Communication', 'to do something useful for someone', 'Can you help me with this bag?'],
  ['wait', 'chờ', 'verb', 1, 'Daily life', 'to stay until something happens', 'We waited for the bus.'],
  ['ask', 'hỏi', 'verb', 1, 'Communication', 'to say a question', 'She asked me my name.'],
  ['remember', 'nhớ', 'verb', 1, 'Study', 'to keep something in your mind', 'I remember your birthday.'],
  ['early', 'sớm', 'adjective', 1, 'Time', 'before the usual time', 'He arrives early every morning.'],
  ['late', 'muộn', 'adjective', 1, 'Time', 'after the usual time', 'Sorry I am late.'],
  ['cheap', 'rẻ', 'adjective', 1, 'Shopping', 'not costing much money', 'This restaurant is cheap and good.'],
  ['expensive', 'đắt', 'adjective', 1, 'Shopping', 'costing a lot of money', 'That bag is too expensive.'],
  ['hungry', 'đói', 'adjective', 1, 'Food', 'needing food', 'The children are hungry.'],
  ['tired', 'mệt', 'adjective', 1, 'Feelings', 'needing rest or sleep', 'I am tired after work.'],
  ['doctor', 'bác sĩ', 'noun', 1, 'Health', 'a person who treats sick people', 'You should see a doctor.'],
  ['medicine', 'thuốc', 'noun', 1, 'Health', 'something you take when you are ill', 'Take this medicine twice a day.'],
  ['ticket', 'vé', 'noun', 1, 'Travel', 'a paper that lets you travel or enter', 'I bought two train tickets.'],
  ['holiday', 'kỳ nghỉ', 'noun', 1, 'Travel', 'time away from work or school', 'We go to the beach on holiday.'],
  ['bill', 'hoá đơn', 'noun', 1, 'Money', 'a paper showing what you must pay', 'Can we have the bill, please?'],

  // A2 — handling life in English
  ['improve', 'cải thiện', 'verb', 2, 'Study', 'to make something better', 'I want to improve my English.'],
  ['prepare', 'chuẩn bị', 'verb', 2, 'Daily life', 'to get something ready', 'She prepared dinner for the family.'],
  ['decide', 'quyết định', 'verb', 2, 'Daily life', 'to choose after thinking', 'We decided to stay at home.'],
  ['explain', 'giải thích', 'verb', 2, 'Communication', 'to make something clear', 'Can you explain this rule again?'],
  ['suggest', 'đề nghị', 'verb', 2, 'Communication', 'to give an idea for others to consider', 'I suggest we leave early.'],
  ['accept', 'chấp nhận', 'verb', 2, 'Work', 'to agree to take or do something', 'She accepted the job offer.'],
  ['refuse', 'từ chối', 'verb', 2, 'Work', 'to say you will not do something', 'He refused to pay the fine.'],
  ['avoid', 'tránh', 'verb', 2, 'Health', 'to stay away from something', 'Try to avoid sugar at night.'],
  ['manage', 'xoay xở, quản lý', 'verb', 2, 'Work', 'to succeed in doing something difficult', 'I managed to finish on time.'],
  ['repair', 'sửa chữa', 'verb', 2, 'Home', 'to fix something broken', 'They repaired the roof last week.'],
  ['deliver', 'giao hàng', 'verb', 2, 'Shopping', 'to take goods to a place', 'The shop delivers in two days.'],
  ['rent', 'thuê', 'verb', 2, 'Home', 'to pay money to use something', 'We rent a small flat near work.'],
  ['salary', 'tiền lương', 'noun', 2, 'Work', 'money paid for a job each month', 'The salary is paid monthly.'],
  ['interview', 'buổi phỏng vấn', 'noun', 2, 'Work', 'a meeting to decide if someone gets a job', 'Her interview went well.'],
  ['experience', 'kinh nghiệm', 'noun', 2, 'Work', 'knowledge from doing something', 'He has five years of experience.'],
  ['advice', 'lời khuyên', 'noun', 2, 'Communication', 'an opinion about what someone should do', 'She gave me good advice.'],
  ['mistake', 'lỗi', 'noun', 2, 'Study', 'something done wrongly', 'I made a spelling mistake.'],
  ['opportunity', 'cơ hội', 'noun', 2, 'Work', 'a chance to do something good', 'This job is a great opportunity.'],
  ['pollution', 'sự ô nhiễm', 'noun', 2, 'Environment', 'dirty air, water or land', 'Air pollution is worse in the city.'],
  ['traffic', 'giao thông', 'noun', 2, 'City', 'cars and people moving on roads', 'The traffic is terrible at five.'],
  ['schedule', 'lịch trình', 'noun', 2, 'Work', 'a plan of times and activities', 'My schedule is full this week.'],
  ['prefer', 'thích hơn', 'verb', 2, 'Communication', 'to like one thing more than another', 'I prefer tea to coffee.'],

  // B1 — work, study and society
  ['achieve', 'đạt được', 'verb', 3, 'Work', 'to succeed in reaching a goal', 'She achieved her target this year.'],
  ['consider', 'cân nhắc', 'verb', 3, 'Communication', 'to think about something carefully', 'We are considering a smaller flat.'],
  ['contribute', 'đóng góp', 'verb', 3, 'Society', 'to give money, time or ideas to something', 'Everyone contributed to the project.'],
  ['encourage', 'khuyến khích', 'verb', 3, 'Society', 'to give someone confidence to do something', 'My teacher encouraged me to apply.'],
  ['arrange', 'sắp xếp', 'verb', 3, 'Work', 'to plan or organise something', 'I arranged a meeting for Monday.'],
  ['reduce', 'giảm', 'verb', 3, 'Environment', 'to make something smaller', 'We must reduce plastic waste.'],
  ['require', 'yêu cầu', 'verb', 3, 'Work', 'to need or demand something', 'The job requires good English.'],
  ['responsible', 'có trách nhiệm', 'adjective', 3, 'Work', 'having a duty to deal with something', 'She is responsible for the budget.'],
  ['efficient', 'hiệu quả', 'adjective', 3, 'Work', 'working well without waste', 'The new system is more efficient.'],
  ['flexible', 'linh hoạt', 'adjective', 3, 'Work', 'able to change easily', 'My working hours are flexible.'],
  ['pressure', 'áp lực', 'noun', 3, 'Work', 'a difficult feeling caused by demands', 'He works well under pressure.'],
  ['balance', 'cân bằng', 'noun', 3, 'Health', 'a good mix of different parts of life', 'Try to keep a balance between work and rest.'],
  ['budget', 'ngân sách', 'noun', 3, 'Money', 'a plan for how much money to spend', 'The trip was over budget.'],
  ['benefit', 'lợi ích', 'noun', 3, 'Society', 'an advantage or good effect', 'Regular exercise has many benefits.'],
  ['habit', 'thói quen', 'noun', 3, 'Health', 'something you do often without thinking', 'Reading before bed is a good habit.'],
  ['community', 'cộng đồng', 'noun', 3, 'Society', 'the people living in one area', 'The whole community joined the clean-up.'],

  // B2 — abstract and professional
  ['analyse', 'phân tích', 'verb', 4, 'Study', 'to study something in detail', 'We analysed the survey results.'],
  ['assess', 'đánh giá', 'verb', 4, 'Work', 'to judge the quality or value of something', 'Teachers assess students four times a year.'],
  ['assume', 'cho rằng', 'verb', 4, 'Study', 'to think something is true without proof', 'Do not assume everyone agrees.'],
  ['consequence', 'hậu quả', 'noun', 4, 'Society', 'a result, often a bad one', 'The policy had unexpected consequences.'],
  ['crucial', 'then chốt', 'adjective', 4, 'Work', 'extremely important', 'Timing is crucial in this project.'],
  ['establish', 'thiết lập', 'verb', 4, 'Society', 'to start something that will last', 'The company was established in 2005.'],
  ['factor', 'yếu tố', 'noun', 4, 'Study', 'one thing that affects a situation', 'Cost was the main factor in the decision.'],
  ['maintain', 'duy trì', 'verb', 4, 'Health', 'to keep something at the same level', 'It is hard to maintain that speed.'],
  ['obtain', 'có được', 'verb', 4, 'Work', 'to get something, often with effort', 'You need a visa to obtain a work permit.'],
  ['relevant', 'liên quan', 'adjective', 4, 'Study', 'connected with the subject', 'Please include only relevant details.'],
  ['restrict', 'hạn chế', 'verb', 4, 'Society', 'to limit something', 'The city restricts cars in the centre.'],

  // C1 — precision and nuance
  ['ambiguous', 'mơ hồ', 'adjective', 5, 'Communication', 'having more than one possible meaning', 'His answer was deliberately ambiguous.'],
  ['articulate', 'diễn đạt rõ ràng', 'verb', 5, 'Communication', 'to express an idea clearly', 'She articulated the problem in one sentence.'],
  ['comprehensive', 'toàn diện', 'adjective', 5, 'Study', 'including everything necessary', 'The report gives a comprehensive overview.'],
  ['contradict', 'mâu thuẫn với', 'verb', 5, 'Study', 'to say the opposite of something', 'The data contradicts the earlier claim.'],
  ['elaborate', 'triển khai chi tiết', 'verb', 5, 'Communication', 'to explain something in more detail', 'Could you elaborate on that point?'],
  ['inevitable', 'không tránh khỏi', 'adjective', 5, 'Society', 'certain to happen', 'Some delay was inevitable.'],
  ['undermine', 'làm suy yếu', 'verb', 5, 'Society', 'to make something weaker', 'Constant criticism undermines confidence.'],

  // C2 — rare but genuinely useful
  ['pragmatic', 'thực dụng', 'adjective', 6, 'Work', 'dealing with things in a practical way', 'We need a pragmatic solution, not a perfect one.'],
  ['nuance', 'sắc thái', 'noun', 6, 'Communication', 'a small difference in meaning', 'The translation loses some nuance.'],
  ['meticulous', 'tỉ mỉ', 'adjective', 6, 'Work', 'very careful about detail', 'She keeps meticulous records.'],
];

const IELTS_ROWS: PackRow[] = [
  // B1 — the vocabulary of IELTS topics
  ['education', 'giáo dục', 'noun', 3, 'IELTS Education', 'the process of teaching and learning', 'Education should be free for everyone.'],
  ['employment', 'việc làm', 'noun', 3, 'IELTS Work', 'the state of having a paid job', 'Youth employment is rising slowly.'],
  ['housing', 'nhà ở', 'noun', 3, 'IELTS Society', 'places where people live', 'Housing costs have increased sharply.'],
  ['income', 'thu nhập', 'noun', 3, 'IELTS Economy', 'money received from work or investments', 'Average income rose by 4 per cent.'],
  ['population', 'dân số', 'noun', 3, 'IELTS Society', 'the number of people in an area', 'The population is ageing quickly.'],
  ['transport', 'giao thông vận tải', 'noun', 3, 'IELTS Transport', 'the system for moving people or goods', 'Public transport reduces traffic.'],
  ['urban', 'đô thị', 'adjective', 3, 'IELTS Society', 'relating to a city', 'Urban areas offer more jobs.'],
  ['rural', 'nông thôn', 'adjective', 3, 'IELTS Society', 'relating to the countryside', 'Rural schools have fewer teachers.'],
  ['climate', 'khí hậu', 'noun', 3, 'IELTS Environment', 'the usual weather of a place', 'Climate change affects farming.'],
  ['waste', 'rác thải', 'noun', 3, 'IELTS Environment', 'unwanted material that is thrown away', 'Food waste is a growing problem.'],

  // B2 — data, arguments, trends
  ['consumption', 'tiêu thụ', 'noun', 4, 'IELTS Economy', 'the amount used or eaten', 'Energy consumption fell last year.'],
  ['diversity', 'sự đa dạng', 'noun', 4, 'IELTS Society', 'a range of different things or people', 'The city is known for its cultural diversity.'],
  ['economic', 'thuộc kinh tế', 'adjective', 4, 'IELTS Economy', 'relating to money and trade', 'Economic growth slowed in 2024.'],
  ['fluctuate', 'dao động', 'verb', 4, 'IELTS Writing Task 1', 'to go up and down repeatedly', 'Prices fluctuated between May and July.'],
  ['generate', 'tạo ra', 'verb', 4, 'IELTS Environment', 'to produce something', 'Solar panels generate electricity.'],
  ['hypothesis', 'giả thuyết', 'noun', 4, 'IELTS Academic', 'an idea to be tested', 'The study supports the original hypothesis.'],
  ['justify', 'biện minh', 'verb', 4, 'IELTS Academic', 'to give a good reason for something', 'It is hard to justify the extra cost.'],
  ['proportion', 'tỷ lệ', 'noun', 4, 'IELTS Writing Task 1', 'a part compared with the whole', 'A large proportion of students work part-time.'],
  ['reluctant', 'miễn cưỡng', 'adjective', 4, 'IELTS Society', 'not willing to do something', 'Many people are reluctant to change jobs.'],
  ['stimulate', 'kích thích', 'verb', 4, 'IELTS Economy', 'to encourage activity or growth', 'Lower taxes may stimulate spending.'],
  ['substantial', 'đáng kể', 'adjective', 4, 'IELTS Writing Task 1', 'large in amount or importance', 'There was a substantial rise in demand.'],
  ['widespread', 'lan rộng', 'adjective', 4, 'IELTS Society', 'existing in many places', 'There is widespread support for the ban.'],

  // C1 — academic precision
  ['alleviate', 'làm giảm bớt', 'verb', 5, 'IELTS Society', 'to make pain or a problem less severe', 'New housing may alleviate the shortage.'],
  ['cognitive', 'thuộc nhận thức', 'adjective', 5, 'IELTS Academic', 'relating to thinking and learning', 'Sleep affects cognitive performance.'],
  ['controversial', 'gây tranh cãi', 'adjective', 5, 'IELTS Society', 'causing strong disagreement', 'The policy remains controversial.'],
  ['criterion', 'tiêu chí', 'noun', 5, 'IELTS Academic', 'a standard used for judging', 'Cost is only one criterion.'],
  ['deficit', 'sự thiếu hụt', 'noun', 5, 'IELTS Economy', 'the amount by which something is too small', 'The country faces a trade deficit.'],
  ['empirical', 'thực nghiệm', 'adjective', 5, 'IELTS Academic', 'based on observation, not theory', 'There is little empirical evidence for this.'],
  ['framework', 'khuôn khổ', 'noun', 5, 'IELTS Academic', 'a structure for ideas or rules', 'The report sets out a legal framework.'],
  ['innovation', 'sự đổi mới', 'noun', 5, 'IELTS Economy', 'a new idea or method', 'Innovation drives long-term growth.'],
  ['intervention', 'sự can thiệp', 'noun', 5, 'IELTS Society', 'action taken to change a situation', 'Early intervention prevents bigger problems.'],
  ['perceive', 'nhận thức, cảm nhận', 'verb', 5, 'IELTS Academic', 'to understand or see something in a certain way', 'The public perceives the risk as low.'],
  ['regulation', 'quy định', 'noun', 5, 'IELTS Society', 'an official rule', 'Stricter regulations cut emissions.'],
  ['resilience', 'khả năng phục hồi', 'noun', 5, 'IELTS Society', 'the ability to recover from difficulty', 'The economy showed surprising resilience.'],
  ['sustain', 'duy trì', 'verb', 5, 'IELTS Environment', 'to keep something going over time', 'Can the system sustain such growth?'],

  // C2 — top-band lexis
  ['disparity', 'khoảng cách chênh lệch', 'noun', 6, 'IELTS Society', 'a clear difference, usually unfair', 'The income disparity between regions is wide.'],
  ['paradigm', 'mô hình, hệ hình', 'noun', 6, 'IELTS Academic', 'a typical model or way of thinking', 'The discovery created a new paradigm.'],
  ['rhetoric', 'hùng biện', 'noun', 6, 'IELTS Society', 'language used to persuade', 'The speech was pure rhetoric.'],
  ['unprecedented', 'chưa từng có', 'adjective', 6, 'IELTS Society', 'never having happened before', 'The heatwave was unprecedented.'],
  ['viable', 'khả thi', 'adjective', 6, 'IELTS Economy', 'able to work successfully', 'The plan is not financially viable.'],
];

export const WORD_PACKS: WordPack[] = [
  {
    id: 'core-general',
    name: 'General English cốt lõi',
    track: 'general',
    targetSize: 2500,
    rows: GENERAL_ROWS,
  },
  {
    id: 'core-ielts',
    name: 'IELTS Vocabulary cốt lõi',
    track: 'ielts',
    targetSize: 2500,
    rows: IELTS_ROWS,
  },
];

/** Flatten rows into the same shape the database seeder already knows. */
export function packRowsToSeedWords(packs: readonly WordPack[] = WORD_PACKS): SeedWord[] {
  return packs.flatMap((pack) =>
    pack.rows.map(([term, meaningVi, partOfSpeech, level, topic, definitionEn, exampleEn]) => ({
      term,
      meaningVi,
      partOfSpeech,
      level,
      topic,
      track: pack.track,
      ...(definitionEn ? { definitionEn } : {}),
      ...(exampleEn ? { exampleEn } : {}),
    })),
  );
}

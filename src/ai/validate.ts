import { AiError, type AiRequest } from './types';

/**
 * Reject an impossible request before it costs an API call. Shared by every
 * provider so the rules cannot drift between Gemini and Groq.
 */
export function assertRequest(request: AiRequest): void {
  const problems: string[] = [];
  if (request.track !== 'general' && request.track !== 'ielts') {
    problems.push('track không hợp lệ');
  }
  if (!Number.isInteger(request.level) || request.level < 0 || request.level > 6) {
    problems.push('cấp độ phải là số nguyên 0–6');
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 20) {
    problems.push('số từ phải từ 1 đến 20');
  }
  if (!Array.isArray(request.avoidTerms) || !Array.isArray(request.weakTerms)) {
    problems.push('danh sách từ kèm theo không hợp lệ');
  }
  if (request.explainTerms !== undefined) {
    if (!Array.isArray(request.explainTerms)) {
      problems.push('danh sách từ cần giải nghĩa không hợp lệ');
    } else if (request.explainTerms.length > 20) {
      problems.push('chỉ giải nghĩa tối đa 20 từ mỗi lần');
    } else if (request.explainTerms.some((term) => typeof term !== 'string' || !term.trim())) {
      problems.push('danh sách từ cần giải nghĩa có mục rỗng');
    }
  }
  if (problems.length > 0) {
    throw new AiError('validation', problems.join('; '), { stage: 'config' });
  }
}

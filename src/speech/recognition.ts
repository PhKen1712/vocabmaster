/**
 * Pure rules for speech-recognition failures.
 *
 * iOS reports several very different problems through the same generic banner.
 * Keeping the wording here makes it testable and keeps the hook about state.
 */

export function speechErrorMessage(code: string, message?: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Bạn chưa cấp quyền micro hoặc nhận diện giọng nói. Mở Cài đặt iOS → VocabMaster → Micro / Nhận diện giọng nói để bật.';
    case 'service-not-allowed':
      return 'iPhone chưa có gói nhận diện tiếng Anh ngoại tuyến, hoặc Siri / Đọc chính tả đang tắt. Tắt “Nhận diện trên thiết bị” rồi thử lại, hoặc bật Siri trong Cài đặt.';
    case 'language-not-supported':
      return 'iPhone không hỗ trợ nhận diện tiếng Anh (en-US) cho kiểu này. Thử tắt “Nhận diện trên thiết bị”.';
    case 'audio-capture':
      return 'Không thu được âm thanh từ micro. Kiểm tra micro đang bận (cuộc gọi, ghi âm khác) rồi thử lại.';
    case 'interrupted':
      return 'Nhận diện bị ngắt (cuộc gọi, Siri hoặc báo thức). Thử lại.';
    case 'no-speech':
      return 'Không nghe thấy giọng nói. Thử lại và đọc to hơn.';
    case 'network':
      return 'Cần mạng cho nhận diện qua mạng nhưng không kết nối được. Kiểm tra 4G/Wi-Fi rồi thử lại.';
    case 'busy':
      return 'Bộ nhận diện đang bận. Thử lại sau một giây.';
    default:
      return message?.trim() || `Không nhận diện được giọng nói (${code}).`;
  }
}

/**
 * An on-device attempt that reports a missing offline model (or disabled Siri)
 * can be retried once through Apple's servers. Other errors (no speech, no
 * permission, microphone busy) cannot be fixed by changing the network mode.
 */
export function canFallBackToNetwork(input: {
  code: string;
  usedOnDevice: boolean;
  alreadyRetried: boolean;
}): boolean {
  return (
    input.usedOnDevice &&
    !input.alreadyRetried &&
    (input.code === 'service-not-allowed' || input.code === 'language-not-supported')
  );
}

import { canFallBackToNetwork, speechErrorMessage } from '../recognition';

describe('speechErrorMessage', () => {
  it('names the permission that is missing instead of blaming the microphone', () => {
    expect(speechErrorMessage('not-allowed')).toContain('quyền micro');
    expect(speechErrorMessage('not-allowed')).toContain('Cài đặt iOS');
  });

  it('explains a missing offline English model and the Siri setting', () => {
    const message = speechErrorMessage('service-not-allowed');
    expect(message).toContain('ngoại tuyến');
    expect(message).toContain('Siri');
    expect(message).not.toContain('micro');
  });

  it('keeps the platform message for an unknown code', () => {
    expect(speechErrorMessage('unknown', 'Lỗi lạ từ iOS')).toBe('Lỗi lạ từ iOS');
    expect(speechErrorMessage('unknown')).toContain('unknown');
  });
});

describe('canFallBackToNetwork', () => {
  it('allows one network retry only for a missing on-device model', () => {
    expect(
      canFallBackToNetwork({
        code: 'service-not-allowed',
        usedOnDevice: true,
        alreadyRetried: false,
      }),
    ).toBe(true);
    expect(
      canFallBackToNetwork({
        code: 'language-not-supported',
        usedOnDevice: true,
        alreadyRetried: false,
      }),
    ).toBe(true);
  });

  it('does not retry twice, off-device, or for unrelated errors', () => {
    expect(
      canFallBackToNetwork({
        code: 'service-not-allowed',
        usedOnDevice: true,
        alreadyRetried: true,
      }),
    ).toBe(false);
    expect(
      canFallBackToNetwork({
        code: 'service-not-allowed',
        usedOnDevice: false,
        alreadyRetried: false,
      }),
    ).toBe(false);
    expect(
      canFallBackToNetwork({ code: 'no-speech', usedOnDevice: true, alreadyRetried: false }),
    ).toBe(false);
  });
});

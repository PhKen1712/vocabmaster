import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { buildSpeechCheck, type SpeechCheckResult, type SpokenSegment } from './pronunciation';
import type { QuizQuestion } from '../types';

/**
 * Speech recognition wrapper.
 *
 * `requiresOnDeviceRecognition` is requested by default so audio stays on the
 * phone. If the iPhone does not have the English on-device model, iOS reports
 * an error; the UI then offers an explicit "use network recognition" retry
 * instead of silently sending audio to Apple.
 */

export interface SpeechCheckState {
  listening: boolean;
  processing: boolean;
  transcript: string;
  result: SpeechCheckResult | null;
  error: string | null;
  onDevice: boolean;
  setOnDevice: (value: boolean) => void;
  start: (question: QuizQuestion) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

function messageForError(code: string, message?: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Bạn chưa cấp quyền micro và nhận diện giọng nói. Mở Cài đặt iOS → VocabMaster để bật.';
    case 'service-not-allowed':
      return 'Nhận diện giọng nói chưa được bật trên thiết bị này.';
    case 'no-speech':
      return 'Không nghe thấy giọng nói. Thử lại và đọc to hơn.';
    case 'network':
      return 'Nhận diện trên thiết bị không khả dụng và đang cần mạng.';
    case 'busy':
      return 'Bộ nhận diện đang bận. Thử lại sau một giây.';
    default:
      return message?.trim() || `Không nhận diện được giọng nói (${code}).`;
  }
}

export function useSpeechCheck(): SpeechCheckState {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<SpeechCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onDevice, setOnDevice] = useState(true);
  // A ref, not state: the native event listener must read the current question
  // even if it was registered on an earlier render.
  const activeQuestionRef = useRef<QuizQuestion | null>(null);

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    setProcessing(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setProcessing(false);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const first = event.results?.[0];
    const text = first?.transcript?.trim() ?? '';
    if (!text) return;
    setTranscript(text);
    const question = activeQuestionRef.current;
    if (event.isFinal && question) {
      // The package exposes per-segment confidence, but guard the shape so a
      // future change cannot crash the session screen.
      const rawSegments = (first as {
        segments?: { text?: string; confidence?: number }[];
      } | undefined)?.segments;
      const segments: SpokenSegment[] = Array.isArray(rawSegments)
        ? rawSegments
            .filter((segment) => typeof segment?.text === 'string')
            .map((segment) => ({
              text: segment.text ?? '',
              confidence: typeof segment.confidence === 'number' ? segment.confidence : 0,
            }))
        : [];
      setResult(buildSpeechCheck(question, text, segments));
      setProcessing(false);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    setProcessing(false);
    setError(messageForError(event.error ?? 'unknown', event.message));
  });

  const start = useCallback(
    async (question: QuizQuestion) => {
      setError(null);
      setResult(null);
      setTranscript('');
      activeQuestionRef.current = question;

      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setError(
            'Bạn chưa cấp quyền micro và nhận diện giọng nói. Mở Cài đặt iOS → VocabMaster để bật.',
          );
          return;
        }
        setProcessing(true);
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          continuous: false,
          requiresOnDeviceRecognition: onDevice,
          addsPunctuation: false,
        });
      } catch (caught) {
        setProcessing(false);
        setError(
          caught instanceof Error
            ? caught.message
            : 'Không khởi động được nhận diện giọng nói.',
        );
      }
    },
    [onDevice],
  );

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // The module throws when nothing is listening; ignore safely.
    }
    setListening(false);
    setProcessing(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setResult(null);
    setError(null);
    activeQuestionRef.current = null;
    setProcessing(false);
  }, []);

  return useMemo(
    () => ({
      listening,
      processing,
      transcript,
      result,
      error,
      onDevice,
      setOnDevice,
      start,
      stop,
      reset,
    }),
    [listening, processing, transcript, result, error, onDevice, start, stop, reset],
  );
}

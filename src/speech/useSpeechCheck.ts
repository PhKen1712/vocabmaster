import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { buildSpeechCheck, type SpeechCheckResult, type SpokenSegment } from './pronunciation';
import { canFallBackToNetwork, speechErrorMessage } from './recognition';
import type { QuizQuestion } from '../types';

/**
 * Speech recognition wrapper.
 *
 * `requiresOnDeviceRecognition` is requested by default so audio stays on the
 * phone. If the iPhone has no English on-device model (or Siri is off), the
 * hook switches to network recognition once and shows a note saying audio is
 * sent to Apple; it never changes modes silently.
 */

export interface SpeechCheckState {
  listening: boolean;
  processing: boolean;
  transcript: string;
  result: SpeechCheckResult | null;
  error: string | null;
  /** Explains an automatic switch to network recognition, if it happened. */
  modeNote: string | null;
  onDevice: boolean;
  setOnDevice: (value: boolean) => void;
  /** `network: true` forces one network attempt, ignoring the on-device switch. */
  start: (question: QuizQuestion, options?: { network?: boolean }) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useSpeechCheck(): SpeechCheckState {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<SpeechCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeNote, setModeNote] = useState<string | null>(null);
  const [onDevice, setOnDevice] = useState(true);
  // Set for the attempt currently running, used to decide whether an error can
  // be fixed by switching from on-device to network recognition.
  const usedOnDeviceRef = useRef(false);
  const autoRetriedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const code = event.error ?? 'unknown';
    // iOS reports a missing offline English model (or disabled Siri) as
    // service-not-allowed/language-not-supported. Instead of dead-ending with
    // "micro không dùng được", fall back to network recognition once and say so.
    const canFallBack = canFallBackToNetwork({
      code,
      usedOnDevice: usedOnDeviceRef.current,
      alreadyRetried: autoRetriedRef.current,
    });

    if (canFallBack) {
      autoRetriedRef.current = true;
      usedOnDeviceRef.current = false;
      setListening(false);
      setError(null);
      setProcessing(true);
      setModeNote(
        'iPhone chưa có gói nhận diện tiếng Anh ngoại tuyến nên đã tự chuyển sang nhận diện qua mạng. Âm thanh được gửi tới Apple.',
      );
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!activeQuestionRef.current) {
          setProcessing(false);
          return;
        }
        try {
          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: true,
            continuous: false,
            requiresOnDeviceRecognition: false,
            addsPunctuation: false,
          });
        } catch (caught) {
          setProcessing(false);
          setError(
            caught instanceof Error ? caught.message : 'Không khởi động được nhận diện qua mạng.',
          );
        }
      }, 450);
      return;
    }

    setListening(false);
    setProcessing(false);
    setError(speechErrorMessage(code, event.message));
  });

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  const start = useCallback(
    async (question: QuizQuestion, options: { network?: boolean } = {}) => {
      setError(null);
      setResult(null);
      setTranscript('');
      setModeNote(null);
      autoRetriedRef.current = false;
      activeQuestionRef.current = question;

      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setError(
            'Bạn chưa cấp quyền micro hoặc nhận diện giọng nói. Mở Cài đặt iOS → VocabMaster → Micro / Nhận diện giọng nói để bật.',
          );
          return;
        }

        // Do not ask iOS for on-device recognition when this phone has no
        // offline English model: it would fail before the microphone is used.
        let useOnDevice = options.network ? false : onDevice;
        if (useOnDevice) {
          let supported = false;
          try {
            supported = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
          } catch {
            supported = false;
          }
          if (!supported) {
            useOnDevice = false;
            setModeNote(
              'iPhone chưa có gói nhận diện tiếng Anh ngoại tuyến nên lần này dùng nhận diện qua mạng. Âm thanh được gửi tới Apple.',
            );
          }
        }

        usedOnDeviceRef.current = useOnDevice;
        setProcessing(true);
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          continuous: false,
          requiresOnDeviceRecognition: useOnDevice,
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
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // The module throws when nothing is listening; ignore safely.
    }
    setListening(false);
    setProcessing(false);
  }, []);

  const reset = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setTranscript('');
    setResult(null);
    setError(null);
    setModeNote(null);
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
      modeNote,
      onDevice,
      setOnDevice,
      start,
      stop,
      reset,
    }),
    [listening, processing, transcript, result, error, modeNote, onDevice, start, stop, reset],
  );
}

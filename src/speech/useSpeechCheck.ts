import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { buildSpeechCheck, type SpeechCheckResult, type SpokenSegment } from './pronunciation';
import { canFallBackToNetwork, speechErrorMessage } from './recognition';
import { stopSpeaking } from './tts';
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

/**
 * Hard cap for one attempt. iOS occasionally ends the audio task without
 * sending a final result (the learner stops manually, a call interrupts the
 * microphone, the app loses focus), which used to leave the button stuck on
 * "Đang nghe…" forever. After this long we stop the task and keep whatever was
 * transcribed instead of discarding the attempt.
 */
const RECOGNITION_TIMEOUT_MS = 9_000;

function readSegments(first: unknown): SpokenSegment[] {
  const raw = (first as { segments?: { text?: string; confidence?: number }[] } | undefined)
    ?.segments;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((segment) => typeof segment?.text === 'string')
    .map((segment) => ({
      text: segment.text ?? '',
      confidence: typeof segment.confidence === 'number' ? segment.confidence : 0,
    }));
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
  // Interim transcripts and segments arrive before `isFinal`; keep them so the
  // attempt still produces a result when iOS never sends a final event.
  const transcriptRef = useRef('');
  const segmentsRef = useRef<SpokenSegment[]>([]);
  const resultRef = useRef<SpeechCheckResult | null>(null);

  const finalizeFromTranscript = useCallback(() => {
    const question = activeQuestionRef.current;
    const text = transcriptRef.current.trim();
    if (!question || !text || resultRef.current) {
      setProcessing(false);
      return;
    }
    const built = buildSpeechCheck(question, text, segmentsRef.current);
    resultRef.current = built;
    setResult(built);
    setProcessing(false);
  }, []);

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    setProcessing(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setProcessing(false);
    // Some iOS versions end the task without a final result. Use the last
    // interim transcript rather than losing what the learner just said.
    finalizeFromTranscript();
  });

  useSpeechRecognitionEvent('result', (event) => {
    const first = event.results?.[0];
    const text = first?.transcript?.trim() ?? '';
    if (!text) return;
    transcriptRef.current = text;
    setTranscript(text);
    const segments = readSegments(first);
    if (segments.length > 0) segmentsRef.current = segments;
    const question = activeQuestionRef.current;
    if (event.isFinal && question) {
      const built = buildSpeechCheck(question, text, segments);
      resultRef.current = built;
      setResult(built);
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

  // A watchdog, not a normal end path: if the recogniser goes silent without
  // an error or a final result, stop it and keep the interim transcript.
  useEffect(() => {
    if (!listening && !processing) return;
    const timer = setTimeout(() => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // Nothing to stop; the fallback below still produces feedback.
      }
      setListening(false);
      if (!transcriptRef.current.trim()) {
        setProcessing(false);
        setError(
          'Không nghe thấy giọng nói. Bấm micro, đọc to từ mục tiêu rồi thử lại ở nơi ít tiếng ồn.',
        );
        return;
      }
      finalizeFromTranscript();
    }, RECOGNITION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [listening, processing, finalizeFromTranscript]);

  const start = useCallback(
    async (question: QuizQuestion, options: { network?: boolean } = {}) => {
      setError(null);
      setResult(null);
      setTranscript('');
      setModeNote(null);
      autoRetriedRef.current = false;
      activeQuestionRef.current = question;
      transcriptRef.current = '';
      segmentsRef.current = [];
      resultRef.current = null;

      try {
        // A sample word playing through expo-speech still owns the audio
        // session; starting recognition on top of it fails with
        // audio-capture on a real iPhone.
        await stopSpeaking();
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
    // Do not wait for an `end` event that may never arrive: grade what was
    // already transcribed when the learner taps "Dừng ghi âm".
    finalizeFromTranscript();
  }, [finalizeFromTranscript]);

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
    transcriptRef.current = '';
    segmentsRef.current = [];
    resultRef.current = null;
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

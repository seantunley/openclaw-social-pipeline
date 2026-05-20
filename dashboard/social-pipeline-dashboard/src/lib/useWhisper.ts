/**
 * In-browser Whisper speech-to-text via transformers.js.
 *
 * Records mic audio with MediaRecorder, decodes to 16 kHz mono PCM with
 * AudioContext, then runs `Xenova/whisper-base` locally — the model is
 * downloaded ONCE (~290 MB) and cached by the browser. Audio never leaves
 * the machine. Multilingual: EN, FR, RU, plus 90+ others.
 *
 * Lifecycle:
 *   - idle         user can start
 *   - permission   waiting on browser mic prompt
 *   - recording    actively capturing audio
 *   - loading      first-use: the model is downloading; `progress` is 0-1
 *   - transcribing audio is decoded + fed through Whisper
 *   - error        with a message
 *
 * The pipeline instance is module-scoped and reused across calls — once
 * loaded, every subsequent transcription is instant (just the inference cost).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Re-exported lazily to keep the dashboard's main bundle small. The
// transformers.js import is heavy; we don't want it loaded until the
// operator clicks the mic.
let transformersPromise: Promise<typeof import('@xenova/transformers')> | null = null;
function loadTransformers() {
  if (!transformersPromise) transformersPromise = import('@xenova/transformers');
  return transformersPromise;
}

const MODEL_ID = 'Xenova/whisper-base';
const TARGET_SAMPLE_RATE = 16_000;

// Lazy singleton pipeline. First call to `getPipeline()` triggers download +
// init; subsequent calls return the cached instance. We pass through the
// progress callback so the UI can show a 0-100 bar.
type WhisperPipeline = (
  input: Float32Array,
  options?: { language?: string; task?: string; chunk_length_s?: number },
) => Promise<{ text: string }>;
let pipelineInstance: WhisperPipeline | null = null;
let pipelineLoading: Promise<WhisperPipeline> | null = null;

async function getPipeline(
  onProgress?: (fraction: number) => void,
): Promise<WhisperPipeline> {
  if (pipelineInstance) return pipelineInstance;
  if (!pipelineLoading) {
    pipelineLoading = (async () => {
      const { pipeline, env } = await loadTransformers();
      // Allow browser cache. Disable local-only restriction so it CAN
      // download once; subsequent loads come from cache.
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      const p = (await pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        {
          progress_callback: (info: { status: string; progress?: number }) => {
            if (info.status === 'progress' && typeof info.progress === 'number') {
              onProgress?.(info.progress / 100);
            } else if (info.status === 'ready') {
              onProgress?.(1);
            }
          },
        },
      )) as unknown as WhisperPipeline;
      pipelineInstance = p;
      return p;
    })();
  }
  return pipelineLoading;
}

export interface WhisperDiagnostics {
  /** The browser error class, e.g. 'NotAllowedError'. */
  errorName?: string;
  /** Raw error message from the browser. */
  rawMessage?: string;
  /** window.isSecureContext at the moment the call ran. */
  secureContext?: boolean;
  /** Permissions API state, if it answered. */
  permissionState?: PermissionState | 'unsupported';
  /** Origin we tried to access the mic from. */
  origin?: string;
}

export type WhisperState =
  | { kind: 'idle' }
  | { kind: 'permission' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'loading'; progress: number }
  | { kind: 'transcribing' }
  | { kind: 'error'; message: string; diagnostics?: WhisperDiagnostics };

export interface UseWhisperResult {
  state: WhisperState;
  /** Whether the mic is currently active. */
  isActive: boolean;
  /** Toggle: idle -> recording, recording -> stop+transcribe. No-op otherwise. */
  toggle: () => Promise<void>;
  /** Force-cancel any in-flight recording without transcribing. */
  cancel: () => void;
}

export interface UseWhisperOptions {
  /** Called with the transcribed text when transcription succeeds. */
  onTranscript: (text: string) => void;
  /** ISO language code hint (e.g. 'en', 'fr', 'ru'). Whisper auto-detects if omitted. */
  language?: string;
}

export function useWhisper({ onTranscript, language }: UseWhisperOptions): UseWhisperResult {
  const [state, setState] = useState<WhisperState>({ kind: 'idle' });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  // Tear down the active stream when the component unmounts.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
      }
    };
  }, []);

  // Watch the Permissions API — when the operator flips microphone from
  // 'denied' → 'granted' via the browser's site-settings panel, we clear
  // the error state automatically so the next click on the mic Just Works.
  // This is the only way to recover without forcing a page reload.
  useEffect(() => {
    let cancelled = false;
    if (!('permissions' in navigator)) return;
    let perm: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        if (cancelled) return;
        perm = result;
        const onChange = () => {
          // If permission flipped to 'granted', reset the local error so
          // the operator can click the mic without seeing the stale message.
          if (perm && perm.state === 'granted') {
            setState((prev) => (prev.kind === 'error' ? { kind: 'idle' } : prev));
          }
        };
        result.addEventListener('change', onChange);
        return () => result.removeEventListener('change', onChange);
      })
      .catch(() => {
        // Permissions API not supported for microphone in this browser — fine.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: 'error',
        message: 'getUserMedia is not available in this browser. Try Chrome, Edge or Firefox.',
      });
      return;
    }
    // Secure-context check — getUserMedia silently denies on plain HTTP.
    // localhost counts as secure; everything else needs HTTPS.
    if (!window.isSecureContext) {
      setState({
        kind: 'error',
        message:
          'Speech requires HTTPS (or localhost). The page is being served over plain HTTP, so the browser blocks microphone access.',
        diagnostics: {
          secureContext: false,
          origin: window.location.origin,
        },
      });
      return;
    }

    // Snapshot permission state for diagnostics (not as a gate). The
    // Permissions API can falsely report 'denied' in some browsers /
    // contexts (incognito + system mic policy, extension interference,
    // etc.), so we no longer block on it — getUserMedia is the source
    // of truth.
    let permissionState: PermissionState | 'unsupported' = 'unsupported';
    if ('permissions' in navigator) {
      try {
        const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        permissionState = perm.state;
      } catch {
        // Some browsers don't expose 'microphone' as a PermissionName.
      }
    }

    setState({ kind: 'permission' });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = (err as Error).name;
      const rawMessage = (err as Error).message;
      let message: string;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        // The most actionable hint depends on whether Permissions API thinks
        // it's already granted. If it does, the real culprit is usually OS-level.
        if (permissionState === 'granted') {
          message =
            'The browser says microphone is allowed, but the OS blocked access. On Windows: Settings → Privacy & security → Microphone → enable both "Microphone access" and "Let apps access your microphone" AND "Let desktop apps access your microphone". On macOS: System Settings → Privacy & Security → Microphone → enable your browser.';
        } else {
          message =
            "Browser denied microphone access. Click the lock icon next to the URL → Site settings → Microphone → Allow, then RELOAD the page (Ctrl+R / Cmd+R). Most browsers don't re-prompt until the tab is reloaded.";
        }
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        message = 'No microphone device was found. Plug one in and try again.';
      } else if (name === 'NotReadableError') {
        message =
          'The microphone is in use by another application. Close any conference call / OBS / audio tool that has the mic open, then try again.';
      } else if (name === 'AbortError') {
        message = 'Microphone access was aborted before it started. Try again.';
      } else {
        message = `Could not access microphone: ${rawMessage || name || 'unknown error'}`;
      }
      setState({
        kind: 'error',
        message,
        diagnostics: {
          errorName: name,
          rawMessage,
          secureContext: window.isSecureContext,
          permissionState,
          origin: window.location.origin,
        },
      });
      return;
    }
    streamRef.current = stream;

    // MediaRecorder default mime is browser-dependent (webm/opus on Chrome,
    // mp4/aac on Safari). AudioContext.decodeAudioData handles both.
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    cancelledRef.current = false;
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stopStream();
      if (cancelledRef.current) {
        setState({ kind: 'idle' });
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) {
        setState({ kind: 'error', message: 'No audio was captured. Try again.' });
        return;
      }
      try {
        await transcribeBlob(blob, language, onTranscript, setState);
      } catch (err) {
        setState({ kind: 'error', message: `Transcription failed: ${(err as Error).message}` });
      }
    };

    recorder.start();
    setState({ kind: 'recording', startedAt: Date.now() });
  }, [language, onTranscript, stopStream]);

  const toggle = useCallback(async () => {
    if (state.kind === 'idle' || state.kind === 'error') {
      await startRecording();
      return;
    }
    if (state.kind === 'recording') {
      // Stop -> ondataavailable + onstop fire next tick.
      recorderRef.current?.stop();
    }
    // Other states (permission / loading / transcribing) ignore the toggle.
  }, [state.kind, startRecording]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      stopStream();
      setState({ kind: 'idle' });
    }
  }, [stopStream]);

  return {
    state,
    isActive:
      state.kind === 'recording' ||
      state.kind === 'permission' ||
      state.kind === 'loading' ||
      state.kind === 'transcribing',
    toggle,
    cancel,
  };
}

// ---------------------------------------------------------------------------
// Internal: decode a recorded audio Blob to 16kHz mono PCM, run Whisper.
// ---------------------------------------------------------------------------

async function transcribeBlob(
  blob: Blob,
  language: string | undefined,
  onTranscript: (text: string) => void,
  setState: (s: WhisperState) => void,
): Promise<void> {
  // The pipeline may need to download (first use) — surface progress as
  // a `loading` state until it's ready.
  setState({ kind: 'loading', progress: 0 });
  const transcriber = await getPipeline((fraction) => {
    setState({ kind: 'loading', progress: fraction });
  });

  setState({ kind: 'transcribing' });

  // Decode the blob to a Float32Array at 16 kHz mono. Whisper expects
  // exactly this format. AudioContext handles webm/opus, mp4/aac, etc.
  const arrayBuffer = await blob.arrayBuffer();
  const tmpCtx = new AudioContext();
  const decoded = await tmpCtx.decodeAudioData(arrayBuffer);
  await tmpCtx.close();

  const pcm = await resampleToMono16k(decoded);

  const result = await transcriber(pcm, {
    language: language ?? undefined,
    task: 'transcribe',
    chunk_length_s: 30,
  });
  const text = (result.text ?? '').trim();
  if (text) onTranscript(text);
  setState({ kind: 'idle' });
}

async function resampleToMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === TARGET_SAMPLE_RATE && buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  // Mix to mono first.
  const monoLength = buffer.length;
  const mono = new Float32Array(monoLength);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < monoLength; i += 1) mono[i] += channel[i];
  }
  for (let i = 0; i < monoLength; i += 1) mono[i] /= buffer.numberOfChannels;

  if (buffer.sampleRate === TARGET_SAMPLE_RATE) return mono;

  // Resample via OfflineAudioContext.
  const offline = new OfflineAudioContext(
    1,
    Math.ceil((mono.length * TARGET_SAMPLE_RATE) / buffer.sampleRate),
    TARGET_SAMPLE_RATE,
  );
  const monoBuffer = offline.createBuffer(1, mono.length, buffer.sampleRate);
  monoBuffer.copyToChannel(mono, 0);
  const src = offline.createBufferSource();
  src.buffer = monoBuffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

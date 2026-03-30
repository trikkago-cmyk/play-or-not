const DM_TTS_ENABLED_STORAGE_KEY = 'dm_luosi_tts_enabled_v1';
const VOICE_LOAD_TIMEOUT_MS = 1200;
const PRIME_TIMEOUT_MS = 180;
const BROWSER_SPEECH_START_TIMEOUT_MS = 1200;
const BROWSER_SPEECH_STATUS_POLL_MS = 80;
const REMOTE_TTS_COOLDOWN_MS = 5 * 60 * 1000;
const SILENT_AUDIO_DATA_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

const FEMALE_PREFERRED_PATTERNS = [
  /xiaoxiao/i,
  /xiaoyi/i,
  /ting-?ting/i,
  /tingting/i,
  /sin-?ji/i,
  /hiu-?maan/i,
  /hsiao-?chen/i,
  /hsiao-?yu/i,
  /huihui/i,
  /xiaohan/i,
  /female/i,
  /woman/i,
  /girl/i,
];

const MALE_HINT_PATTERNS = [
  /yunxi/i,
  /yunjian/i,
  /junjie/i,
  /kangkang/i,
  /male/i,
  /man/i,
  /boy/i,
];

type BrowserSpeechSynthesis = SpeechSynthesis & {
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void;
};

let activeSpeakToken = 0;
let voicesReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let hasPrimedDmTtsPlayback = false;
let pendingSpeakRequest: { rawText: string; options: { preferredVoiceURI?: string; force?: boolean } } | null = null;
let activeAudioElement: HTMLAudioElement | null = null;
let activeAudioObjectUrl: string | null = null;
let activeFetchController: AbortController | null = null;
let remoteTtsCooldownUntil = 0;

function canUseRemoteAudioPlayback(): boolean {
  return typeof window !== 'undefined' && typeof window.Audio !== 'undefined';
}

function canUseBrowserSpeechSynthesis(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

export function isDmTtsSupported(): boolean {
  return canUseRemoteAudioPlayback() || canUseBrowserSpeechSynthesis();
}

function isLikelyGestureRestrictedBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS|EdgiOS|FxiOS|EdgA|OPR|Opera|SamsungBrowser/i.test(userAgent);

  return isIOS || isSafari;
}

export function hasDmTtsPrimedPlayback(): boolean {
  return hasPrimedDmTtsPlayback;
}

export function getDmTtsEnabled(): boolean {
  if (!isDmTtsSupported()) {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(DM_TTS_ENABLED_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function setDmTtsEnabled(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(DM_TTS_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage failures and keep runtime behavior working.
  }

  if (!enabled) {
    stopDmTtsPlayback();
  }
}

export function buildSpeakableMessage(rawText: string): string {
  if (!rawText.trim()) {
    return '';
  }

  const withoutReferenceBlock = rawText.replace(/\n\s*\*\*参考依据\*\*[\s\S]*$/m, '');

  return withoutReferenceBlock
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[证据\d+\]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .replace(/\s+/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.!！？]{2,}/g, '。')
    .replace(/\s*([，。！？、,!.?])/g, '$1')
    .replace(/([。！？])[，,]/g, '$1')
    .trim();
}

export function pickBestDmVoice(
  voices: SpeechSynthesisVoice[],
  preferredVoiceURI?: string,
): SpeechSynthesisVoice | null {
  if (!voices.length) {
    return null;
  }

  if (preferredVoiceURI) {
    const exactMatch = voices.find((voice) => voice.voiceURI === preferredVoiceURI);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const scoredVoices = voices.map((voice) => ({
    voice,
    score: scoreDmVoice(voice),
  }));

  scoredVoices.sort((left, right) => right.score - left.score);

  if (scoredVoices[0]?.score > 0) {
    return scoredVoices[0].voice;
  }

  const zhFallback = voices.find((voice) => voice.lang.toLowerCase().startsWith('zh'));
  return zhFallback ?? voices[0] ?? null;
}

function scoreDmVoice(voice: SpeechSynthesisVoice): number {
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang === 'zh-cn') {
    score += 90;
  } else if (lang.startsWith('zh-cn')) {
    score += 80;
  } else if (lang === 'zh-hk' || lang === 'zh-tw') {
    score += 65;
  } else if (lang.startsWith('zh')) {
    score += 55;
  } else {
    score -= 40;
  }

  if (FEMALE_PREFERRED_PATTERNS.some((pattern) => pattern.test(name))) {
    score += 32;
  }

  if (MALE_HINT_PATTERNS.some((pattern) => pattern.test(name))) {
    score -= 18;
  }

  if (voice.localService) {
    score += 4;
  }

  if (voice.default) {
    score += 2;
  }

  return score;
}

export async function preloadDmVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!canUseBrowserSpeechSynthesis()) {
    return [];
  }

  if (voicesReadyPromise) {
    return voicesReadyPromise;
  }

  const speech = window.speechSynthesis as BrowserSpeechSynthesis;
  const availableVoices = speech.getVoices();
  if (availableVoices.length > 0) {
    return availableVoices;
  }

  voicesReadyPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;

    const finalize = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (speech.removeEventListener) {
        speech.removeEventListener('voiceschanged', finalize);
      }
      resolve(speech.getVoices());
      voicesReadyPromise = null;
    };

    if (speech.addEventListener) {
      speech.addEventListener('voiceschanged', finalize);
    }

    window.setTimeout(finalize, VOICE_LOAD_TIMEOUT_MS);
  });

  return voicesReadyPromise;
}

export async function primeDmTtsPlayback(): Promise<boolean> {
  if (!isDmTtsSupported()) {
    return false;
  }

  if (hasPrimedDmTtsPlayback) {
    if (pendingSpeakRequest) {
      const pendingRequest = pendingSpeakRequest;
      pendingSpeakRequest = null;
      void speakAsDm(pendingRequest.rawText, pendingRequest.options);
    }
    return true;
  }

  const didPrimeRemoteAudio = await primeRemoteAudioPlayback();
  const didPrimeSpeechSynthesis = didPrimeRemoteAudio ? false : await primeSpeechSynthesisPlayback();
  const didPrime = didPrimeRemoteAudio || didPrimeSpeechSynthesis;

  hasPrimedDmTtsPlayback = didPrime;
  if (didPrime && pendingSpeakRequest) {
    const pendingRequest = pendingSpeakRequest;
    pendingSpeakRequest = null;
    void speakAsDm(pendingRequest.rawText, pendingRequest.options);
  }

  return didPrime;
}

export async function speakAsDm(
  rawText: string,
  options: {
    preferredVoiceURI?: string;
    force?: boolean;
  } = {},
): Promise<boolean> {
  if (!isDmTtsSupported()) {
    return false;
  }

  const normalizedText = buildSpeakableMessage(rawText);
  if (!normalizedText) {
    return false;
  }

  if (!options.force && !getDmTtsEnabled()) {
    return false;
  }

  if (!hasPrimedDmTtsPlayback && isLikelyGestureRestrictedBrowser()) {
    pendingSpeakRequest = { rawText, options };
    return false;
  }

  const speakToken = ++activeSpeakToken;
  cancelActivePlayback();

  const remoteAudioBlob = await fetchRemoteTtsAudio(normalizedText);
  if (speakToken !== activeSpeakToken) {
    return false;
  }

  if (remoteAudioBlob) {
    const didPlayRemoteAudio = await playRemoteAudioBlob(remoteAudioBlob, speakToken);
    if (didPlayRemoteAudio) {
      return true;
    }
  }

  if (!canUseBrowserSpeechSynthesis()) {
    return false;
  }

  const voices = await preloadDmVoices();
  if (speakToken !== activeSpeakToken) {
    return false;
  }

  const speech = window.speechSynthesis;
  speech.cancel();

  const utterance = new window.SpeechSynthesisUtterance(normalizedText);
  const voice = pickBestDmVoice(voices, options.preferredVoiceURI);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'zh-CN';
  } else {
    utterance.lang = 'zh-CN';
  }

  utterance.rate = 0.94;
  utterance.pitch = 1.08;
  utterance.volume = 1;

  return await playBrowserSpeechUtterance(utterance, speech);
}

export function stopDmTtsPlayback() {
  activeSpeakToken += 1;
  pendingSpeakRequest = null;
  cancelActivePlayback();
}

export function resetDmTtsStateForTests() {
  activeSpeakToken = 0;
  voicesReadyPromise = null;
  hasPrimedDmTtsPlayback = false;
  pendingSpeakRequest = null;
  remoteTtsCooldownUntil = 0;
  cancelActivePlayback();
}

async function primeRemoteAudioPlayback(): Promise<boolean> {
  if (!canUseRemoteAudioPlayback()) {
    return false;
  }

  try {
    const audio = new window.Audio(SILENT_AUDIO_DATA_URI);
    audio.volume = 0;
    audio.preload = 'auto';
    await audio.play();
    audio.pause();
    if (typeof audio.currentTime === 'number') {
      audio.currentTime = 0;
    }
    return true;
  } catch (error) {
    console.warn('DM TTS remote audio prime failed:', error);
    return false;
  }
}

async function primeSpeechSynthesisPlayback(): Promise<boolean> {
  if (!canUseBrowserSpeechSynthesis()) {
    return false;
  }

  const speech = window.speechSynthesis;
  const utterance = new window.SpeechSynthesisUtterance('.');
  utterance.volume = 0;
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.lang = 'zh-CN';

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    const finalize = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      speech.cancel();
      resolve(ok);
    };

    utterance.onend = () => finalize(true);
    utterance.onerror = () => finalize(false);

    try {
      speech.cancel();
      speech.resume?.();
      speech.speak(utterance);
      window.setTimeout(() => finalize(true), PRIME_TIMEOUT_MS);
    } catch (error) {
      console.warn('DM TTS speech prime failed:', error);
      finalize(false);
    }
  });
}

async function playBrowserSpeechUtterance(
  utterance: SpeechSynthesisUtterance,
  speech: SpeechSynthesis,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let pollTimerId: number | null = null;
    const startedAt = Date.now();

    const finalize = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId);
      }
      resolve(ok);
    };

    const pollPlaybackState = () => {
      if (settled) {
        return;
      }

      if (speech.speaking || speech.pending) {
        finalize(true);
        return;
      }

      if (Date.now() - startedAt >= BROWSER_SPEECH_START_TIMEOUT_MS) {
        finalize(false);
        return;
      }

      pollTimerId = window.setTimeout(pollPlaybackState, BROWSER_SPEECH_STATUS_POLL_MS);
    };

    utterance.onstart = () => finalize(true);
    utterance.onerror = () => finalize(false);

    try {
      speech.speak(utterance);
      pollTimerId = window.setTimeout(
        pollPlaybackState,
        Math.min(BROWSER_SPEECH_STATUS_POLL_MS, BROWSER_SPEECH_START_TIMEOUT_MS),
      );
    } catch (error) {
      console.warn('DM TTS playback failed:', error);
      finalize(false);
    }
  });
}

function cancelActivePlayback() {
  if (activeFetchController) {
    activeFetchController.abort();
    activeFetchController = null;
  }

  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement.src = '';
    activeAudioElement = null;
  }

  if (activeAudioObjectUrl) {
    URL.revokeObjectURL(activeAudioObjectUrl);
    activeAudioObjectUrl = null;
  }

  if (canUseBrowserSpeechSynthesis()) {
    window.speechSynthesis.cancel();
  }
}

async function fetchRemoteTtsAudio(text: string): Promise<Blob | null> {
  if (typeof fetch === 'undefined' || Date.now() < remoteTtsCooldownUntil) {
    return null;
  }

  const controller = new AbortController();
  activeFetchController = controller;

  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    activeFetchController = null;

    if (!response.ok) {
      if (response.status === 404 || response.status === 503) {
        remoteTtsCooldownUntil = Date.now() + REMOTE_TTS_COOLDOWN_MS;
      }
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('audio/')) {
      return null;
    }

    return await response.blob();
  } catch (error) {
    activeFetchController = null;
    if (isAbortError(error)) {
      return null;
    }
    console.warn('DM remote TTS fetch failed:', error);
    return null;
  }
}

async function playRemoteAudioBlob(audioBlob: Blob, speakToken: number): Promise<boolean> {
  if (!canUseRemoteAudioPlayback()) {
    return false;
  }

  const objectUrl = URL.createObjectURL(audioBlob);
  const audio = new window.Audio(objectUrl);
  audio.preload = 'auto';

  activeAudioObjectUrl = objectUrl;
  activeAudioElement = audio;

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    const finalize = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;

      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }

      if (activeAudioObjectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        activeAudioObjectUrl = null;
      }

      resolve(ok);
    };

    audio.onended = () => finalize(true);
    audio.onerror = () => finalize(false);

    try {
      if (speakToken !== activeSpeakToken) {
        finalize(false);
        return;
      }

      void audio.play().then(() => {
        if (speakToken !== activeSpeakToken) {
          audio.pause();
          finalize(false);
        }
      }).catch((error) => {
        console.warn('DM remote TTS playback failed:', error);
        finalize(false);
      });
    } catch (error) {
      console.warn('DM remote TTS playback failed:', error);
      finalize(false);
    }
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : typeof error === 'object'
      && error !== null
      && 'name' in error
      && (error as { name?: string }).name === 'AbortError';
}

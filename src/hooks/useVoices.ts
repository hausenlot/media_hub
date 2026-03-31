import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { existsInOPFS } from '../utils/opfs';

export interface PiperVoice {
  key: string;
  name: string;
  language: {
    code: string;
    family: string;
    region: string;
    name_native: string;
    name_english: string;
    country_english: string;
  };
  quality: string;
  num_speakers: number;
  speaker_id_map: Record<string, number>;
  files: Record<string, { size_bytes: number; md5_digest: string }>;
}

const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';

export function useVoices() {
  const [voices, setVoices] = useState<Record<string, PiperVoice>>({});
  const [cachedVoices, setCachedVoices] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const preloadWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    fetch('/voices.json')
      .then((res) => res.json())
      .then((data) => {
        setVoices(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError('Failed to load voices list.');
        setIsLoading(false);
        console.error(err);
      });
  }, []);

  // Check cache status for all loaded voices (throttled/batched)
  useEffect(() => {
    if (Object.keys(voices).length === 0) return;

    const checkCache = async () => {
      const keys = Object.keys(voices);
      const cached = new Set<string>();
      
      // Check only a subset initially or on demand? 
      // For now, let's just check the ones that were preloaded or the ones we care about.
      // But actually, we can check all of them in chunks.
      for (let i = 0; i < keys.length; i += 50) {
        const chunk = keys.slice(i, i + 50);
        await Promise.all(chunk.map(async (key) => {
          const isCached = await existsInOPFS(`models/${key}`, 'model.onnx');
          if (isCached) cached.add(key);
        }));
        setCachedVoices(new Set(cached));
      }
    };

    checkCache();
  }, [voices]);

  const languages = useMemo(() => {
    const langMap: Record<string, { code: string; name: string }> = {};
    Object.values(voices).forEach((voice) => {
      if (!langMap[voice.language.code]) {
        langMap[voice.language.code] = {
          code: voice.language.code,
          name: `${voice.language.name_english} (${voice.language.country_english})`,
        };
      }
    });
    return Object.values(langMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [voices]);

  const startPreload = useCallback(() => {
    if (preloadWorkerRef.current || Object.keys(voices).length === 0) return;

    // Load failed preloads from localStorage
    const failedStr = localStorage.getItem('piper_failed_preloads') || '{}';
    const failedMap: Record<string, number> = JSON.parse(failedStr);
    const now = Date.now();
    const COOL_OFF = 60 * 60 * 1000; // 1 hour

    const worker = new Worker('/preload_worker.js');
    preloadWorkerRef.current = worker;

    // Pick the first voice of each language
    const langToVoice: Record<string, PiperVoice> = {};
    Object.values(voices).forEach((voice) => {
      if (!langToVoice[voice.language.code]) {
        langToVoice[voice.language.code] = voice;
      }
    });

    // Filter out voices that failed recently
    const voicesToPreload = Object.values(langToVoice).filter(v => {
      const lastFail = failedMap[v.key];
      return !lastFail || (now - lastFail) > COOL_OFF;
    });

    if (voicesToPreload.length === 0) {
      worker.terminate();
      preloadWorkerRef.current = null;
      return;
    }

    worker.onmessage = (event) => {
      const { kind, key, status } = event.data;
      if (kind === 'status') {
        if (status === 'cached') {
          setCachedVoices((prev) => new Set(prev).add(key));
        } else if (status === 'error') {
          // Update failed preloads in localStorage
          const currentFailed = JSON.parse(localStorage.getItem('piper_failed_preloads') || '{}');
          currentFailed[key] = Date.now();
          localStorage.setItem('piper_failed_preloads', JSON.stringify(currentFailed));
        }
      }
      if (kind === 'complete') {
        worker.terminate();
        preloadWorkerRef.current = null;
      }
    };

    worker.postMessage({
      voicesToPreload,
      baseUrl: PIPER_VOICES_BASE
    });
  }, [voices]);

  const getVoicesByLanguage = useCallback((langCode: string) => {
    return Object.values(voices)
      .filter((v) => v.language.code === langCode)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [voices]);

  return {
    voices,
    languages,
    cachedVoices,
    getVoicesByLanguage,
    startPreload,
    isLoading,
    error,
  };
}

import { useState, useCallback, useRef, useEffect } from 'react';
import { getFromOPFS, saveToOPFS, existsInOPFS } from '../utils/opfs';

export interface PiperState {
  isLoading: boolean;
  progress: number;
  error: string | null;
  audioUrl: string | null;
  isCached: boolean;
}

const ONNX_RUNTIME_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';

export function usePiper() {
  const [state, setState] = useState<PiperState>({
    isLoading: false,
    progress: 0,
    error: null,
    audioUrl: null,
    isCached: false,
  });

  const workerRef = useRef<Worker | null>(null);
  const blobsRef = useRef<Record<string, Blob>>({});

  useEffect(() => {
    const worker = new Worker('/piper_worker.js');
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const data = event.data;
      switch (data.kind) {
        case 'fetch':
          if (data.blob) {
            blobsRef.current[data.url] = data.blob;
          }
          if (data.total) {
            setState((s) => ({ ...s, progress: Math.round((data.loaded / data.total) * 100) }));
          }
          break;
        case 'output':
          if (data.file) {
            setState((s) => ({ ...s, isLoading: false, audioUrl: URL.createObjectURL(data.file), progress: 100 }));
          }
          break;
        case 'stderr':
        case 'error':
          setState((s) => ({ ...s, isLoading: false, error: data.message || 'Synthesis error' }));
          break;
        case 'complete':
          setState((s) => ({ ...s, isLoading: false }));
          break;
      }
    };

    return () => worker.terminate();
  }, []);

  const generateSpeech = useCallback(async (text: string, voiceKey: string, voiceFiles: Record<string, any>) => {
    if (!workerRef.current) return;

    setState({ isLoading: true, progress: 0, error: null, audioUrl: null, isCached: false });

    const withTimeout = (promise: Promise<any>, ms: number, msg: string) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
      ]);
    };

    try {
      const modelPath = Object.keys(voiceFiles).find(f => f.endsWith('.onnx'))!;
      const configPath = Object.keys(voiceFiles).find(f => f.endsWith('.json'))!;
      
      const modelUrl = `${PIPER_VOICES_BASE}${modelPath}`;
      const configUrl = `${PIPER_VOICES_BASE}${configPath}`;

      const opfsPath = `models/${voiceKey}`;
      let modelBlob = await withTimeout(getFromOPFS(opfsPath, 'model.onnx'), 2000, 'OPFS timeout (model)');
      let configBlob = await withTimeout(getFromOPFS(opfsPath, 'model.json'), 2000, 'OPFS timeout (config)');

      if (modelBlob && configBlob) {
        setState(s => ({ ...s, isCached: true, progress: 100 }));
      } else {
        setState(s => ({ ...s, progress: 10 }));
        const [mRes, cRes] = await Promise.all([fetch(modelUrl), fetch(configUrl)]);
        
        if (!mRes.ok || !cRes.ok) {
          const status = !mRes.ok ? mRes.status : cRes.status;
          if (status === 404) {
            throw new Error('This voice model is currently unavailable on the server (404). Please try another voice or language.');
          }
          throw new Error(`Failed to download model or config (Status: ${status}).`);
        }

        modelBlob = await mRes.blob();
        configBlob = await cRes.blob();
        
        await Promise.all([
          saveToOPFS(opfsPath, 'model.onnx', modelBlob),
          saveToOPFS(opfsPath, 'model.json', configBlob)
        ]);
      }

      blobsRef.current[modelUrl] = modelBlob;
      blobsRef.current[configUrl] = configBlob;

      workerRef.current.postMessage({
        kind: 'init',
        input: text,
        speakerId: 0,
        blobs: blobsRef.current,
        modelUrl: modelUrl,
        modelConfigUrl: configUrl,
        onnxruntimeUrl: ONNX_RUNTIME_BASE,
        piperPhonemizeJsUrl: '/piper_phonemize.js',
        piperPhonemizeWasmUrl: '/piper_phonemize.wasm',
        piperPhonemizeDataUrl: '/piper_phonemize.data',
      });

    } catch (err: any) {
      setState(s => ({ ...s, isLoading: false, error: err.message || 'Failed to prepare model' }));
    }
  }, []);

  const checkCache = useCallback(async (voiceKey: string) => {
    const opfsPath = `models/${voiceKey}`;
    const hasModel = await existsInOPFS(opfsPath, 'model.onnx');
    const hasConfig = await existsInOPFS(opfsPath, 'model.json');
    setState(s => ({ ...s, isCached: hasModel && hasConfig }));
  }, []);

  return { ...state, generateSpeech, checkCache };
}

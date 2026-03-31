import { useState, useCallback, useRef, useEffect } from 'react';

export interface TranscriptChunk {
  text: string;
  timestamp: [number, number]; // [start, end] in seconds
}

export type WhisperPhase = 'idle' | 'loading' | 'transcribing';

export function useWhisper() {
  const [isReady, setIsReady] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<WhisperPhase>('idle');
  const [transcriptionChunks, setTranscriptionChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptChunk[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const resolveSegmentsRef = useRef<((chunks: TranscriptChunk[]) => void) | null>(null);
  const readyRef = useRef(false);
  const readyResolversRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const worker = new Worker('/stt_worker.js', { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { kind, status, progress, text, message, chunks } = event.data;
      
      switch (kind) {
        case 'status':
          if (status === 'loading') {
            setPhase('loading');
          }
          if (status === 'ready') {
            readyRef.current = true;
            setIsReady(true);
            setPhase('idle');
            readyResolversRef.current.forEach(r => r());
            readyResolversRef.current = [];
          }
          if (status === 'transcribing') {
            setIsTranscribing(true);
            setPhase('transcribing');
            setTranscriptionChunks(0);
          }
          break;
        case 'transcription_progress':
          setTranscriptionChunks(event.data.chunksProcessed || 0);
          break;
        case 'progress':
          if (progress.status === 'progress' && progress.total) {
            setProgress(Math.round((progress.loaded / progress.total) * 100));
          }
          break;
        case 'result':
          setIsTranscribing(false);
          setTranscript(text);
          break;
        case 'segments_result':
          setIsTranscribing(false);
          setPhase('idle');
          setTranscript(text);
          setSegments(chunks || []);
          if (resolveSegmentsRef.current) {
            resolveSegmentsRef.current(chunks || []);
            resolveSegmentsRef.current = null;
          }
          break;
        case 'error':
          setIsTranscribing(false);
          setPhase('idle');
          setError(message || 'Transcription error');
          if (resolveSegmentsRef.current) {
            resolveSegmentsRef.current([]);
            resolveSegmentsRef.current = null;
          }
          break;
      }
    };

    return () => worker.terminate();
  }, []);

  const prepareAudioData = async (audioInput: File | Blob): Promise<Float32Array> => {
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const arrayBuffer = await audioInput.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    let audioData = audioBuffer.getChannelData(0);
    if (audioBuffer.numberOfChannels > 1) {
      const monoData = new Float32Array(audioBuffer.length);
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        const channel = audioBuffer.getChannelData(i);
        for (let j = 0; j < audioBuffer.length; j++) {
          monoData[j] += channel[j];
        }
      }
      for (let j = 0; j < monoData.length; j++) {
        monoData[j] /= audioBuffer.numberOfChannels;
      }
      audioData = monoData;
    }

    await audioContext.close();
    return audioData;
  };

  const transcribe = useCallback(async (audioFile: File) => {
    if (!workerRef.current) return;
    
    setError(null);
    setTranscript(null);
    setIsTranscribing(true);
    setProgress(0);

    try {
      const audioData = await prepareAudioData(audioFile);
      workerRef.current.postMessage({ kind: 'transcribe', audioData });
    } catch (err: any) {
      setIsTranscribing(false);
      setError(err.message || 'Failed to process audio file');
    }
  }, []);

  const transcribeWithTimestamps = useCallback(async (audioInput: File | Blob): Promise<TranscriptChunk[]> => {
    if (!workerRef.current) return [];
    
    setError(null);
    setTranscript(null);
    setSegments([]);
    setIsTranscribing(true);
    setProgress(0);

    try {
      const audioData = await prepareAudioData(audioInput);
      
      return new Promise<TranscriptChunk[]>((resolve) => {
        resolveSegmentsRef.current = resolve;
        workerRef.current!.postMessage({ kind: 'transcribe_segments', audioData });
      });
    } catch (err: any) {
      setIsTranscribing(false);
      setError(err.message || 'Failed to process audio file');
      return [];
    }
  }, []);

  const init = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ kind: 'init' });
    }
  }, []);

  const waitForReady = useCallback((): Promise<void> => {
    if (readyRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      readyResolversRef.current.push(resolve);
    });
  }, []);

  return { 
    isReady, isTranscribing, progress, phase, transcriptionChunks,
    error, transcript, segments,
    transcribe, transcribeWithTimestamps, init, waitForReady 
  };
}

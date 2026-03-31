import { useState, useCallback, useRef } from 'react';
import { useFFmpeg } from './useFFmpeg';
import { useWhisper } from './useWhisper';
import { saveToOPFS, getFromOPFS } from '../utils/opfs';

export type DubbingStep =
  | 'idle'
  | 'extracting'       // auto: extracting audio
  | 'review_audio'     // PAUSE: user reviews extracted audio + original video
  | 'transcribing'     // auto: running Whisper
  | 'editing'          // PAUSE: user reviews/edits transcript + selects voice
  | 'synthesizing'     // auto: generating TTS per segment
  | 'review_synthesis' // PAUSE: user previews each generated segment
  | 'stitching'        // auto: stitching segments
  | 'review_stitch'    // PAUSE: user previews full stitched track
  | 'muxing'           // auto: creating final video
  | 'done';            // PAUSE: user previews result + downloads

export interface DubbingSegment {
  id: string;
  text: string;
  translatedText?: string;
  startTime: number;
  endTime: number;
  audioBlob: Blob | null;
  status: 'pending' | 'generating' | 'done' | 'error';
}

export function useDubbing() {
  const [step, setStep] = useState<DubbingStep>('idle');
  const [segments, setSegments] = useState<DubbingSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [originalVideoUrl, setOriginalVideoUrl] = useState<string | null>(null);
  const [extractedAudioUrl, setExtractedAudioUrl] = useState<string | null>(null);
  const [stitchedAudioUrl, setStitchedAudioUrl] = useState<string | null>(null);

  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);

  const videoBlobRef = useRef<Blob | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const stitchedAudioBlobRef = useRef<Blob | null>(null);
  const videoDurationRef = useRef(0);

  const ffmpeg = useFFmpeg();
  const whisper = useWhisper();

  const reset = useCallback(() => {
    setStep('idle');
    setSegments([]);
    setError(null);
    setProgress(0);
    setProgressLabel('');
    if (resultVideoUrl) URL.revokeObjectURL(resultVideoUrl);
    if (originalVideoUrl) URL.revokeObjectURL(originalVideoUrl);
    if (extractedAudioUrl) URL.revokeObjectURL(extractedAudioUrl);
    if (stitchedAudioUrl) URL.revokeObjectURL(stitchedAudioUrl);
    setResultVideoUrl(null);
    setOriginalVideoUrl(null);
    setExtractedAudioUrl(null);
    setStitchedAudioUrl(null);
    setIsTranslating(false);
    setTranslationProgress(0);
    videoBlobRef.current = null;
    audioBlobRef.current = null;
    stitchedAudioBlobRef.current = null;
    videoDurationRef.current = 0;
  }, [resultVideoUrl, originalVideoUrl, extractedAudioUrl, stitchedAudioUrl]);

  // ─── Step 1: Upload video & extract audio ───
  const uploadAndExtract = useCallback(async (videoFile: File, audioFile?: File) => {
    setError(null);

    try {
      videoBlobRef.current = videoFile;
      setOriginalVideoUrl(URL.createObjectURL(videoFile));

      const videoId = `dub_${Date.now()}`;
      await saveToOPFS('videos', videoId, videoFile);

      videoDurationRef.current = await ffmpeg.getVideoDuration(videoFile);

      if (audioFile) {
        setStep('extracting');
        setProgressLabel('Processing custom audio...');
        setProgress(0);
        
        audioBlobRef.current = audioFile;
        setExtractedAudioUrl(URL.createObjectURL(audioFile));
      } else {
        // Extract audio
        setStep('extracting');
        setProgressLabel('Extracting audio from video...');
        setProgress(0);

        const audioBlob = await ffmpeg.extractAudio(videoFile);
        audioBlobRef.current = audioBlob;
        setExtractedAudioUrl(URL.createObjectURL(audioBlob));
      }

      // Pre-init Whisper in background while user reviews audio
      whisper.init();

      // PAUSE: let user review
      setStep('review_audio');
      setProgress(100);
      setProgressLabel(audioFile ? 'Audio processing complete! Review before continuing.' : 'Audio extracted! Review before continuing.');
    } catch (err: any) {
      setError(err.message || 'Failed to extract audio');
      setStep('idle');
    }
  }, [ffmpeg, whisper]);

  // ─── Step 2: Transcribe (user clicked "Continue") ───
  const startTranscription = useCallback(async () => {
    setError(null);

    try {
      setStep('transcribing');
      setProgressLabel('Loading Whisper model...');
      setProgress(0);

      // Wait for whisper to be ready (uses ref, not stale state)
      await whisper.waitForReady();

      setProgressLabel('Transcribing speech...');

      const chunks = await whisper.transcribeWithTimestamps(audioBlobRef.current!);

      const dubbingSegments: DubbingSegment[] = chunks.map((chunk, i) => ({
        id: `seg_${i}`,
        text: chunk.text.trim(),
        startTime: chunk.timestamp[0],
        endTime: chunk.timestamp[1] ?? chunk.timestamp[0] + 2,
        audioBlob: null,
        status: 'pending' as const,
      }));

      setSegments(dubbingSegments);

      // PAUSE: let user review/edit transcript
      setStep('editing');
      setProgress(100);
      setProgressLabel('Transcript ready! Review and edit as needed.');
    } catch (err: any) {
      setError(err.message || 'Transcription failed');
      setStep('review_audio');
    }
  }, [whisper]);

  // ─── Step 3: Synthesize TTS (user clicked "Generate Audio") ───
  const synthesizeAll = useCallback(async (voiceKey: string, voiceFiles: Record<string, any>) => {
    setStep('synthesizing');
    setError(null);

    try {
      // Get the latest segments from state
      const currentSegments = await new Promise<DubbingSegment[]>((resolve) => {
        setSegments(prev => {
          resolve(prev);
          return prev;
        });
      });

      const total = currentSegments.filter(s => s.text.trim()).length;
      let completed = 0;

      for (const seg of currentSegments) {
        const textToSynthesize = seg.translatedText?.trim() ? seg.translatedText : seg.text;
        if (!textToSynthesize.trim()) continue;

        setProgressLabel(`Synthesizing segment ${completed + 1} of ${total}...`);
        setProgress(Math.round((completed / total) * 100));

        setSegments(prev => prev.map(s =>
          s.id === seg.id ? { ...s, status: 'generating' } : s
        ));

        const audioBlob = await generateSegmentAudio(textToSynthesize, voiceKey, voiceFiles);

        setSegments(prev => prev.map(s =>
          s.id === seg.id ? { ...s, audioBlob, status: 'done' } : s
        ));

        completed++;
      }

      // PAUSE: let user preview generated audio
      setStep('review_synthesis');
      setProgress(100);
      setProgressLabel('All segments synthesized! Preview before creating video.');
    } catch (err: any) {
      setError(err.message || 'Synthesis failed');
      setStep('editing');
    }
  }, []);

  // ─── Step 4: Stitch audio (user clicked "Auto-stitch") ───
  const stitchAudio = useCallback(async () => {
    setError(null);

    try {
      setStep('stitching');
      setProgressLabel('Stitching audio segments...');
      setProgress(0);

      const currentSegments = await new Promise<DubbingSegment[]>((resolve) => {
        setSegments(prev => {
          resolve(prev);
          return prev;
        });
      });

      const segmentsWithAudio = currentSegments
        .filter(s => s.audioBlob && (s.translatedText?.trim() || s.text.trim()))
        .map(s => ({
          audioBlob: s.audioBlob!,
          startTime: s.startTime,
          endTime: s.endTime,
        }));

      const stitchedAudio = await ffmpeg.stitchSegments(
        segmentsWithAudio,
        videoDurationRef.current
      );
      setProgress(100);

      const url = URL.createObjectURL(stitchedAudio);
      setStitchedAudioUrl(url);
      stitchedAudioBlobRef.current = stitchedAudio;

      // PAUSE: let user preview
      setStep('review_stitch');
      setProgressLabel('Audio track stitched successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to stitch audio');
      setStep('review_synthesis');
    }
  }, [ffmpeg]);

  // ─── Step 5: Mux Video (user clicked "Export video") ───
  const muxVideo = useCallback(async () => {
    setError(null);

    try {
      setStep('muxing');
      setProgressLabel('Creating final video...');
      setProgress(0);

      const finalVideo = await ffmpeg.muxAudioVideo(
        videoBlobRef.current!,
        stitchedAudioBlobRef.current!
      );
      setProgress(100);

      setResultVideoUrl(URL.createObjectURL(finalVideo));

      // PAUSE: done
      setStep('done');
      setProgressLabel('Done! Your dubbed video is ready.');
    } catch (err: any) {
      setError(err.message || 'Failed to create video');
      setStep('review_stitch');
    }
  }, [ffmpeg]);

  // ─── Segment editing helpers ───
  const updateSegmentText = useCallback((id: string, newText: string) => {
    setSegments(prev => prev.map(s =>
      s.id === id ? { ...s, text: newText, audioBlob: null, status: 'pending' as const } : s
    ));
  }, []);

  const updateSegmentTranslation = useCallback((id: string, newText: string) => {
    setSegments(prev => prev.map(s =>
      s.id === id ? { ...s, translatedText: newText, audioBlob: null, status: 'pending' as const } : s
    ));
  }, []);

  const removeSegment = useCallback((id: string) => {
    setSegments(prev => prev.filter(s => s.id !== id));
  }, []);

  const addSegment = useCallback((afterId: string) => {
    setSegments(prev => {
      const idx = prev.findIndex(s => s.id === afterId);
      if (idx === -1) return prev;

      const current = prev[idx];
      const next = prev[idx + 1];
      const startTime = current.endTime;
      const endTime = next ? next.startTime : startTime + 2;

      const newSeg: DubbingSegment = {
        id: `seg_${Date.now()}`,
        text: '',
        startTime,
        endTime,
        audioBlob: null,
        status: 'pending',
      };

      const updated = [...prev];
      updated.splice(idx + 1, 0, newSeg);
      return updated;
    });
  }, []);

  // Go back to editing from synthesis review
  const backToEditing = useCallback(() => {
    setStep('editing');
    setProgress(0);
    setProgressLabel('');
  }, []);

  // Replace audio manually
  const replaceAudio = useCallback((newAudioFile: File) => {
    audioBlobRef.current = newAudioFile;
    if (extractedAudioUrl) {
      URL.revokeObjectURL(extractedAudioUrl);
    }
    setExtractedAudioUrl(URL.createObjectURL(newAudioFile));
    // Reset pipeline back to review phase
    setSegments([]);
    setStep('review_audio');
    setProgress(100);
    setProgressLabel('Audio replaced! Review before continuing.');
    setError(null);
  }, [extractedAudioUrl]);

  // Auto-translate using Google Translate
  const autoTranslate = useCallback(async (targetLang: string) => {
    if (segments.length === 0) return;
    setIsTranslating(true);
    setTranslationProgress(0);
    setError(null);

    const updatedSegments = [...segments];

    try {
      for (let i = 0; i < updatedSegments.length; i++) {
        const seg = updatedSegments[i];
        if (!seg.text.trim()) continue;

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(seg.text)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Translation API failed');
        const data = await res.json();
        const translated = data[0].map((x: any) => x[0]).join('');

        updatedSegments[i] = { ...seg, translatedText: translated };
        setTranslationProgress(Math.round(((i + 1) / updatedSegments.length) * 100));
        
        // Update state progressively so UI reflects changes immediately
        setSegments([...updatedSegments]);

        // slight delay to prevent absolute hammering rate limit if too many small segments
        await new Promise(r => setTimeout(r, 100)); 
      }
    } catch (err: any) {
      setError('Translation failed: ' + err.message);
    } finally {
      setIsTranslating(false);
    }
  }, [segments]);

  return {
    step,
    segments,
    error,
    progress,
    progressLabel,
    resultVideoUrl,
    originalVideoUrl,
    extractedAudioUrl,
    stitchedAudioUrl,
    whisperReady: whisper.isReady,
    whisperProgress: whisper.progress,
    whisperPhase: whisper.phase,
    whisperChunks: whisper.transcriptionChunks,
    ffmpegProgress: ffmpeg.progress,
    ffmpegLoading: ffmpeg.isLoading,
    initWhisper: whisper.init,
    isTranslating,
    translationProgress,
    autoTranslate,
    uploadAndExtract,
    startTranscription,
    synthesizeAll,
    stitchAudio,
    muxVideo,
    updateSegmentText,
    updateSegmentTranslation,
    removeSegment,
    addSegment,
    backToEditing,
    replaceAudio,
    reset,
  };
}

// Helper: Generate audio for a single segment using Piper
async function generateSegmentAudio(
  text: string,
  voiceKey: string,
  voiceFiles: Record<string, any>
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const ONNX_RUNTIME_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';

    const worker = new Worker('/piper_worker.js');
    const blobs: Record<string, Blob> = {};

    worker.onmessage = async (event) => {
      const data = event.data;
      switch (data.kind) {
        case 'fetch':
          if (data.blob) {
            blobs[data.url] = data.blob;
          }
          break;
        case 'output':
          if (data.file) {
            resolve(data.file as Blob);
            worker.terminate();
          }
          break;
        case 'error':
        case 'stderr':
          reject(new Error(data.message || 'TTS synthesis failed'));
          worker.terminate();
          break;
      }
    };

    const modelPath = Object.keys(voiceFiles).find(f => f.endsWith('.onnx'))!;
    const configPath = Object.keys(voiceFiles).find(f => f.endsWith('.json'))!;
    const modelUrl = `${PIPER_VOICES_BASE}${modelPath}`;
    const configUrl = `${PIPER_VOICES_BASE}${configPath}`;

    const opfsPath = `models/${voiceKey}`;
    Promise.all([
      getFromOPFS(opfsPath, 'model.onnx'),
      getFromOPFS(opfsPath, 'model.json'),
    ]).then(async ([modelBlob, configBlob]) => {
      if (!modelBlob || !configBlob) {
        const [mRes, cRes] = await Promise.all([fetch(modelUrl), fetch(configUrl)]);
        modelBlob = await mRes.blob();
        configBlob = await cRes.blob();
      }

      blobs[modelUrl] = modelBlob;
      blobs[configUrl] = configBlob;

      worker.postMessage({
        kind: 'init',
        input: text,
        speakerId: 0,
        blobs,
        modelUrl,
        modelConfigUrl: configUrl,
        onnxruntimeUrl: ONNX_RUNTIME_BASE,
        piperPhonemizeJsUrl: '/piper_phonemize.js',
        piperPhonemizeWasmUrl: '/piper_phonemize.wasm',
        piperPhonemizeDataUrl: '/piper_phonemize.data',
      });
    }).catch(reject);
  });
}

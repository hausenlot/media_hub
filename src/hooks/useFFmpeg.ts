import { useState, useCallback, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export function useFFmpeg() {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const loadedRef = useRef(false);

  const getFFmpeg = useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current && loadedRef.current) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    ffmpeg.on('progress', ({ progress: p }) => {
      setProgress(Math.round(p * 100));
    });

    ffmpeg.on('log', ({ message }) => {
      console.log('[ffmpeg]', message);
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    loadedRef.current = true;
    return ffmpeg;
  }, []);

  const extractAudio = useCallback(async (videoFile: File | Blob): Promise<Blob> => {
    setIsLoading(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await getFFmpeg();
      const inputData = await fetchFile(videoFile);
      
      await ffmpeg.writeFile('input.mp4', inputData);
      
      // Extract audio as 16kHz mono WAV (optimal for Whisper)
      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-vn',
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        'output.wav'
      ]);

      const data = await ffmpeg.readFile('output.wav');
      const blob = new Blob([data as any], { type: 'audio/wav' });

      // Cleanup
      await ffmpeg.deleteFile('input.mp4');
      await ffmpeg.deleteFile('output.wav');

      setIsLoading(false);
      setProgress(100);
      return blob;
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message || 'Failed to extract audio');
      throw err;
    }
  }, [getFFmpeg]);

  const stitchSegments = useCallback(async (
    segments: Array<{ audioBlob: Blob; startTime: number; endTime: number }>,
    totalDuration: number
  ): Promise<Blob> => {
    setIsLoading(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await getFFmpeg();

      // Write each segment audio file to ffmpeg's virtual FS
      for (let i = 0; i < segments.length; i++) {
        const segData = await fetchFile(segments[i].audioBlob);
        await ffmpeg.writeFile(`seg_${i}.wav`, segData);
      }

      // Build a complex filter that:
      // 1. Creates silence for the full duration
      // 2. Overlays each segment at its start timestamp
      const inputs: string[] = [
        '-f', 'lavfi', '-i', `anullsrc=r=22050:cl=mono`,
        '-t', totalDuration.toString(),
      ];

      for (let i = 0; i < segments.length; i++) {
        inputs.push('-i', `seg_${i}.wav`);
      }

      // Build the amerge/overlay filter
      // We use the adelay filter to position each segment at the right time
      let filterParts: string[] = [];
      let mixInputs: string[] = ['[0:a]']; // silence base

      for (let i = 0; i < segments.length; i++) {
        const delayMs = Math.round(segments[i].startTime * 1000);
        const inputIdx = i + 1;
        filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[delayed${i}]`);
        mixInputs.push(`[delayed${i}]`);
      }

      filterParts.push(
        `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[out]`
      );

      const filterComplex = filterParts.join(';');

      await ffmpeg.exec([
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-t', totalDuration.toString(),
        '-ar', '22050',
        '-ac', '1',
        'stitched.wav'
      ]);

      const data = await ffmpeg.readFile('stitched.wav');
      const blob = new Blob([data as any], { type: 'audio/wav' });

      // Cleanup
      for (let i = 0; i < segments.length; i++) {
        await ffmpeg.deleteFile(`seg_${i}.wav`);
      }
      await ffmpeg.deleteFile('stitched.wav');

      setIsLoading(false);
      setProgress(100);
      return blob;
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message || 'Failed to stitch audio segments');
      throw err;
    }
  }, [getFFmpeg]);

  const muxAudioVideo = useCallback(async (
    videoBlob: Blob,
    audioBlob: Blob
  ): Promise<Blob> => {
    setIsLoading(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await getFFmpeg();

      await ffmpeg.writeFile('video.mp4', await fetchFile(videoBlob));
      await ffmpeg.writeFile('audio.wav', await fetchFile(audioBlob));

      // Replace audio track: copy video stream, encode new audio as AAC
      await ffmpeg.exec([
        '-i', 'video.mp4',
        '-i', 'audio.wav',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        'output.mp4'
      ]);

      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data as any], { type: 'video/mp4' });

      // Cleanup
      await ffmpeg.deleteFile('video.mp4');
      await ffmpeg.deleteFile('audio.wav');
      await ffmpeg.deleteFile('output.mp4');

      setIsLoading(false);
      setProgress(100);
      return blob;
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message || 'Failed to mux audio and video');
      throw err;
    }
  }, [getFFmpeg]);

  const getVideoDuration = useCallback(async (videoBlob: Blob): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => reject(new Error('Failed to load video metadata'));
      video.src = URL.createObjectURL(videoBlob);
    });
  }, []);

  const convertMedia = useCallback(async (
    inputFile: File | Blob,
    ffmpegArgs: string[],
    outputFilename: string,
    outputMimeType: string = 'video/mp4'
  ): Promise<Blob> => {
    setIsLoading(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await getFFmpeg();
      const ext = inputFile instanceof File ? inputFile.name.split('.').pop() || 'input' : 'input';
      const inputName = `convert_input.${ext}`;

      await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

      // Replace the placeholder input name in args
      const resolvedArgs = ffmpegArgs.map(a => a === '__INPUT__' ? inputName : a);

      await ffmpeg.exec(resolvedArgs);

      const data = await ffmpeg.readFile(outputFilename);
      const blob = new Blob([data as any], { type: outputMimeType });

      // Cleanup
      await ffmpeg.deleteFile(inputName);
      try { await ffmpeg.deleteFile(outputFilename); } catch {}

      setIsLoading(false);
      setProgress(100);
      return blob;
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message || 'Conversion failed');
      throw err;
    }
  }, [getFFmpeg]);

  return {
    isLoading,
    progress,
    error,
    extractAudio,
    stitchSegments,
    muxAudioVideo,
    getVideoDuration,
    convertMedia,
  };
}


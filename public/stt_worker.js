import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Configure environment for the worker
env.allowLocalModels = false;
env.useBrowserCache = true; // Use Transformers.js built-in persistent cache

let transcriber = null;

async function getTranscriber(progress_callback) {
  if (transcriber) return transcriber;
  
  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
    progress_callback,
  });
  return transcriber;
}

self.onmessage = async (event) => {
  const { audioData, kind } = event.data;

  if (kind === 'init') {
    self.postMessage({ kind: 'status', status: 'loading' });
    try {
      await getTranscriber((p) => {
        self.postMessage({ kind: 'progress', progress: p });
      });
      self.postMessage({ kind: 'status', status: 'ready' });
    } catch (err) {
      self.postMessage({ kind: 'error', message: err.message });
    }
    return;
  }

  if (kind === 'transcribe') {
    try {
      const p = await getTranscriber();
      
      self.postMessage({ kind: 'status', status: 'transcribing' });
      
      const output = await p(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        callback_function: (p) => {
          // Chunk progress
          // self.postMessage({ kind: 'chunk_progress', progress: p });
        }
      });

      self.postMessage({ kind: 'result', text: output.text });
    } catch (err) {
      self.postMessage({ kind: 'error', message: err.message });
    }
  }

  if (kind === 'transcribe_segments') {
    try {
      const p = await getTranscriber((prog) => {
        self.postMessage({ kind: 'progress', progress: prog });
      });
      
      self.postMessage({ kind: 'status', status: 'transcribing' });
      
      let chunksProcessed = 0;
      const output = await p(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        callback_function: (cbData) => {
          chunksProcessed++;
          self.postMessage({ 
            kind: 'transcription_progress', 
            chunksProcessed,
          });
        }
      });

      // output.chunks is an array of { text, timestamp: [start, end] }
      self.postMessage({ 
        kind: 'segments_result', 
        chunks: output.chunks || [],
        text: output.text,
      });
    } catch (err) {
      self.postMessage({ kind: 'error', message: err.message });
    }
  }
};

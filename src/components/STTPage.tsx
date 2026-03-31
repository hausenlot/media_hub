import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { useWhisper } from '../hooks/useWhisper';
import './TTSPage.css';
import './STTPage.css';

export function STTPage() {
  const whisper = useWhisper();

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- File handling ---
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) setAudioFile(file);
  }, []);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setAudioFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleBrowse = useCallback(() => fileInputRef.current?.click(), []);

  const handleTranscribe = useCallback(() => {
    if (!audioFile) return;
    whisper.init();
    whisper.transcribeWithTimestamps(audioFile);
  }, [audioFile, whisper]);

  const handleCopy = useCallback(() => {
    if (!whisper.transcript) return;
    navigator.clipboard.writeText(whisper.transcript).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }, [whisper.transcript]);

  const handleReset = useCallback(() => {
    setAudioFile(null);
  }, []);

  const isRunning = whisper.isTranscribing || whisper.phase === 'loading';
  const hasResult = !isRunning && whisper.segments.length > 0;

  return (
    <div className="standalone-page">
      <div className="standalone-shell stt-shell">
        <div className="standalone-card">
          {/* Header */}
          <div className="card-head">
            <div className="card-icon" style={{ background: '#E6F1FB' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M4 7h10M4 12h7M4 17h12" stroke="#185FA5" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M18 10v8M15 15l3 3 3-3" stroke="#185FA5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className="card-title">Speech to Text</div>
              <div className="card-sub">Whisper · English only</div>
            </div>
          </div>

          <div className="card-desc">
            Upload an audio file and transcribe it to text using Whisper, entirely in your browser. Supports English only.
          </div>

          {/* Hidden file input */}
          <input
            type="file"
            accept="audio/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* Upload / file info zone */}
          {!audioFile ? (
            <div
              className={`stt-upload-zone ${isDragging ? 'drag-active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleBrowse}
            >
              <svg className="upload-icon" viewBox="0 0 28 28" fill="none">
                <path d="M14 18V10M10 14l4-4 4 4" stroke="#333" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3" y="3" width="22" height="22" rx="4" stroke="#333" strokeWidth="1.2" />
              </svg>
              <span className="uz-title">Drop audio file here</span>
              <span className="uz-sub">MP3, WAV, M4A, OGG · Max 2 GB</span>
            </div>
          ) : (
            <div className="stt-file-box">
              <div className="stt-file-row">
                <div className="stt-file-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M9 18V5l12-2v13" stroke="#185FA5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="6" cy="18" r="3" stroke="#185FA5" strokeWidth="1.5" />
                    <circle cx="18" cy="16" r="3" stroke="#185FA5" strokeWidth="1.5" />
                  </svg>
                  <span className="stt-file-name">{audioFile.name}</span>
                </div>
                {!isRunning && (
                  <button className="btn-g btn-sm" onClick={handleReset}>Change</button>
                )}
              </div>
              <audio controls src={URL.createObjectURL(audioFile)} style={{ width: '100%', height: '40px' }} />
            </div>
          )}

          {/* Progress */}
          {isRunning && (
            <div style={{ marginTop: '1.25rem' }}>
              <div className="pbar">
                <div
                  className={`pfill stt-fill ${whisper.phase === 'transcribing' ? 'indeterminate' : ''}`}
                  style={{
                    width: whisper.phase === 'transcribing'
                      ? undefined
                      : `${whisper.progress}%`
                  }}
                />
              </div>
              <p className="plabel">
                {whisper.phase === 'loading'
                  ? `Downloading Whisper model… ${whisper.progress}%`
                  : whisper.transcriptionChunks > 0
                  ? `Transcribing… ${whisper.transcriptionChunks} chunks processed`
                  : 'Preparing transcription…'}
              </p>
            </div>
          )}

          {/* Error */}
          {whisper.error && (
            <div className="error-box" style={{ marginTop: '1rem' }}>{whisper.error}</div>
          )}

          {/* Results */}
          {hasResult && (
            <div className="stt-results">
              <div className="stt-results-header">
                <span className="stt-results-label">Transcript</span>
                <button className="btn-g btn-sm" onClick={handleCopy}>
                  {copyDone ? '✓ Copied' : 'Copy text'}
                </button>
              </div>
              <div className="stt-segments">
                {whisper.segments.map((seg, i) => (
                  <div key={i} className="stt-segment">
                    <span className="stt-seg-time">
                      {seg.timestamp[0].toFixed(1)}s – {seg.timestamp[1].toFixed(1)}s
                    </span>
                    <p className="stt-seg-text">{seg.text.trim()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              className="btn-p stt-btn"
              onClick={handleTranscribe}
              disabled={!audioFile || isRunning}
              style={{ flex: 1, opacity: !audioFile || isRunning ? 0.45 : 1 }}
            >
              {isRunning ? 'Transcribing…' : hasResult ? 'Re-transcribe' : 'Run Transcription'}
            </button>
            {hasResult && (
              <button className="btn-g" onClick={handleReset}>
                New File
              </button>
            )}
          </div>

          {/* Chips */}
          <div className="chips" style={{ display: 'flex', marginTop: '1.25rem' }}>
            <span className="chip">Whisper WASM</span>
            <span className="chip">Timestamped</span>
            <span className="chip">English only</span>
          </div>
        </div>
      </div>
    </div>
  );
}

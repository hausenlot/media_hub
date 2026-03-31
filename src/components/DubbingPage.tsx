import { useState, useRef, useCallback, useEffect } from 'react';
import type { TouchEvent, MouseEvent, DragEvent, ChangeEvent } from 'react';
import { useDubbing } from '../hooks/useDubbing';
import { useVoices } from '../hooks/useVoices';
import './DubbingPage.css';

const LABELS = [
  "Upload video",
  "Audio extraction",
  "Speech to text",
  "Translate",
  "Text to speech",
  "Stitch",
  "Add audio"
];

export function DubbingPage() {
  const dubbing = useDubbing();
  const voiceData = useVoices();
  const [cur, setCur] = useState(0);
  const total = LABELS.length;
  const vpRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [startX, setStartX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // --- TTS State ---
  const [ttsLang, setTtsLang] = useState<string>('en_US');
  const [ttsVoice, setTtsVoice] = useState<string>('');

  const availableVoices = voiceData.getVoicesByLanguage(ttsLang);
  useEffect(() => {
    if (availableVoices.length > 0 && !availableVoices.some(v => v.key === ttsVoice)) {
      setTtsVoice(availableVoices[0].key);
    }
  }, [ttsLang, availableVoices, ttsVoice]);

  const handleGenerateTTS = () => {
    if (ttsVoice && voiceData.voices[ttsVoice]) {
      dubbing.synthesizeAll(ttsVoice, voiceData.voices[ttsVoice].files);
    }
  };

  // --- Upload Handlers ---
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      dubbing.uploadAndExtract(file);
      setCur(1);
    }
  }, [dubbing]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      dubbing.uploadAndExtract(file);
      setCur(1);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [dubbing]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Navigation
  const go = (dir: number) => {
    setCur((prev) => Math.max(0, Math.min(total - 1, prev + dir)));
  };
  const goTo = (i: number) => {
    if (i >= 0 && i < total) setCur(i);
  };

  // Touch and Drag handlers
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    setStartX(e.touches[0].clientX);
  };
  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    setStartX(e.clientX);
    setIsDragging(true);
  };
  const handleMouseUp = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };
  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  const getSlideStyle = (index: number) => {
    const diff = index - cur;
    const absDiff = Math.abs(diff);

    if (absDiff > 1) {
      return {
        transform: `translateX(${diff * 110}%) scale(0.65)`,
        opacity: 0,
        zIndex: 0,
        pointerEvents: 'none' as const,
      };
    }

    if (diff === 0) {
      return {
        transform: 'translateX(0) scale(1)',
        opacity: 1,
        zIndex: 10,
        background: '#fff',
      };
    }

    const sign = Math.sign(diff);
    return {
      transform: `translateX(${sign * 80}%) scale(0.8)`,
      opacity: 0.6,
      zIndex: 5,
      cursor: 'pointer',
      background: diff < 0 ? '#fafafa' : '#f0f0f0',
    };
  };

  const handleSlideClick = (index: number) => {
    if (index !== cur) {
      goTo(index);
    }
  };

  return (
    <div className="dubbing-pipeline-container">
      <div className="shell">
        {/* Pip indicators */}
        <div className="pip-row">
          {LABELS.map((_, i) => (
            <div
              key={i}
              className={`pip ${i < cur ? 'done' : ''} ${i === cur ? 'active' : ''}`}
              onClick={() => goTo(i)}
            ></div>
          ))}
        </div>

        {/* Slides */}
        <div
          className="viewport"
          ref={vpRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <div className="track">
            {/* Stage 0: Upload video */}
            <div 
              className="slide" 
              style={getSlideStyle(0)}
              onClick={() => handleSlideClick(0)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#EEEDFE' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#534AB7" strokeWidth="1.2" fill="none"/>
                      <path d="M6 6l4 2-4 2V6z" fill="#534AB7"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Upload video</div>
                    <div className="card-sub">Source file input</div>
                  </div>
                </div>
                <div className="card-desc">Upload the source video you want to dub. We'll extract audio and process it through the pipeline.</div>
                
                <input 
                  type="file" 
                  accept="video/*" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange} 
                />
                <div 
                  className={`upload-zone ${isDraggingFile ? 'drag-active' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={handleClickUpload}
                >
                  <svg className="upload-icon" viewBox="0 0 28 28" fill="none">
                    <path d="M14 18V10M10 14l4-4 4 4" stroke="#333" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    <rect x="3" y="3" width="22" height="22" rx="4" stroke="#333" strokeWidth="1.2"/>
                  </svg>
                  <span className="uz-title">Drop video file here</span>
                  <span className="uz-sub">MP4, MOV, AVI, MKV · Max 2 GB</span>
                </div>
                <div>
                  <span className="btn-p" onClick={handleClickUpload}>Browse files</span>
                </div>
                <div className="chips">
                  <span className="chip">MP4</span>
                  <span className="chip">MOV</span>
                  <span className="chip">AVI</span>
                  <span className="chip">MKV</span>
                </div>
              </div>
            </div>

            {/* Stage 1: Audio extraction */}
            <div 
              className="slide" 
              style={getSlideStyle(1)}
              onClick={() => handleSlideClick(1)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#E1F5EE' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2v12M4 5v6M12 5v6M2 8h2M12 8h2" stroke="#0F6E56" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Audio extraction</div>
                    <div className="card-sub">Strip audio track</div>
                  </div>
                </div>
                <div className="card-desc">Isolate the original audio track from your video. This becomes the source for transcription.</div>
                
                {(dubbing.step === 'idle' || dubbing.step === 'extracting' || dubbing.step === 'review_audio' || dubbing.progress > 0) && (
                  <div>
                    <div className="pbar">
                      <div className="pfill" style={{ width: `${dubbing.step === 'idle' ? 0 : dubbing.progress}%` }}></div>
                    </div>
                    <p className="plabel">
                      {dubbing.step === 'idle' ? 'Waiting for video upload...' :
                       dubbing.step === 'extracting' ? dubbing.progressLabel || 'Extracting...' :
                       'Extraction complete'}
                    </p>
                    {dubbing.step === 'review_audio' ? (
                      <span className="btn-p" onClick={() => setCur(2)}>Continue to STT</span>
                    ) : (
                      <span className="btn-p" style={{ opacity: 0.5 }}>Extract audio</span>
                    )}
                  </div>
                )}

                {dubbing.error && (dubbing.step === 'idle' || dubbing.step === 'extracting') && (
                  <div style={{ color: '#ef4444', fontSize: '14px', marginBottom: '1rem', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                    {dubbing.error}
                  </div>
                )}

                {dubbing.extractedAudioUrl && (
                  <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#444' }}>Audio Track Preview</span>
                    <audio controls src={dubbing.extractedAudioUrl} style={{ width: '100%', height: '40px' }} />
                  </div>
                )}

                <div className="chips" style={{ marginTop: dubbing.extractedAudioUrl ? '1rem' : 'auto' }}>
                  <span className="chip">WAV output</span>
                  <span className="chip">Stereo / mono</span>
                  <span className="chip">Auto-trim</span>
                </div>
              </div>
            </div>

            {/* Stage 2: Speech to text */}
            <div 
              className="slide" 
              style={getSlideStyle(2)}
              onClick={() => handleSlideClick(2)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#E6F1FB' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 5h7M3 8h5M3 11h8" stroke="#185FA5" strokeWidth="1.2" strokeLinecap="round"/>
                      <path d="M12 7v5M10 10l2 2 2-2" stroke="#185FA5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Speech to text</div>
                    <div className="card-sub">Transcribe audio</div>
                  </div>
                </div>
                <div className="card-desc">Transcribe the extracted audio into a timestamped text transcript. Auto-detect or select the source language.</div>
                
                {['idle', 'extracting', 'review_audio', 'transcribing'].includes(dubbing.step) ? (
                  <>
                    <div style={{ marginBottom: '1.5rem', opacity: dubbing.step !== 'transcribing' ? 0.5 : 1 }}>
                      <div className="pbar">
                        <div 
                          className={`pfill ${dubbing.whisperPhase === 'transcribing' ? 'indeterminate' : ''}`} 
                          style={{ width: dubbing.whisperPhase === 'transcribing' ? undefined : `${dubbing.step === 'transcribing' ? dubbing.whisperProgress : 0}%` }}
                        ></div>
                      </div>
                      <p className="plabel">
                        {dubbing.step === 'transcribing' 
                          ? dubbing.progressLabel || 'Loading Whisper model...' 
                          : 'Waiting to start transcription'}
                      </p>
                    </div>

                    <div style={{ pointerEvents: dubbing.step === 'transcribing' ? 'none' : 'auto' }}>
                      <span 
                        className="btn-p" 
                        onClick={dubbing.startTranscription}
                        style={{ opacity: dubbing.step === 'transcribing' ? 0.5 : 1 }}
                      >
                        {dubbing.step === 'transcribing' ? 'Transcribing...' : 'Run transcription'}
                      </span>
                    </div>

                    <div className="chips" style={{ marginTop: 'auto' }}>
                      <span className="chip">Timestamped</span>
                      <span className="chip">Auto-detect Language</span>
                      <span className="chip">Editable</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="segments-list">
                      {dubbing.segments.map(seg => (
                        <div key={seg.id} className="segment-item">
                          <div className="segment-header">
                            <span className="segment-time">{seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s</span>
                          </div>
                          <textarea 
                            className="segment-text"
                            value={seg.text}
                            onChange={(e) => dubbing.updateSegmentText(seg.id, e.target.value)}
                            rows={Math.max(2, Math.ceil(seg.text.length / 50))}
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <span className="btn-p" onClick={() => setCur(3)}>Continue to Translate</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Stage 3: Translate */}
            <div 
              className="slide" 
              style={getSlideStyle(3)}
              onClick={() => handleSlideClick(3)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#FAEEDA' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8h4M10 8h4M6 5l-2 3 2 3M10 5l2 3-2 3" stroke="#854F0B" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Translate</div>
                    <div className="card-sub">Target language</div>
                  </div>
                </div>
                <div className="card-desc">Provide manual translations for each segment, or skip to use the original transcript for Voiceover generation.</div>
                
                <div className="segments-list" style={{ marginTop: '0.5rem', maxHeight: '300px' }}>
                  {dubbing.segments.map(seg => (
                    <div key={seg.id} className="segment-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div className="segment-header" style={{ marginBottom: 0 }}>
                        <span className="segment-time">{seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s</span>
                      </div>
                      <div style={{ padding: '8px', background: '#f5f5f5', borderRadius: '8px', fontSize: '13px', color: '#555' }}>
                        {seg.text}
                      </div>
                      <textarea 
                        className="segment-text"
                        placeholder="Enter translation (optional)..."
                        value={seg.translatedText || ''}
                        onChange={(e) => dubbing.updateSegmentTranslation(seg.id, e.target.value)}
                        rows={Math.max(2, Math.ceil((seg.translatedText || seg.text).length / 50))}
                        style={{ border: '1px solid #ddd', padding: '8px', borderRadius: '8px', background: '#fff' }}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span className="btn-p" onClick={() => setCur(4)}>Continue to TTS</span>
                  <span className="btn-g" onClick={() => setCur(4)} style={{ fontSize: '13px' }}>Skip (Use Original)</span>
                </div>

                <div className="chips">
                  <span className="chip">100+ languages</span>
                  <span className="chip">Timing preserved</span>
                </div>
              </div>
            </div>

            {/* Stage 4: Text to speech */}
            <div 
              className="slide" 
              style={getSlideStyle(4)}
              onClick={() => handleSlideClick(4)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#FAECE7' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="7" r="3" stroke="#993C1D" strokeWidth="1.2" fill="none"/>
                      <path d="M5 12.5c0-1.66 1.34-3 3-3s3 1.34 3 3" stroke="#993C1D" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Text to speech</div>
                    <div className="card-sub">Generate voiceover</div>
                  </div>
                </div>
                <div className="card-desc">Convert the translated text into a natural-sounding voiceover using your chosen voice model.</div>
                
                {['idle', 'extracting', 'review_audio', 'transcribing', 'editing'].includes(dubbing.step) ? (
                  <>
                    <div className="row" style={{ marginTop: '0.5rem' }}>
                      <select className="sel" value={ttsLang} onChange={e => setTtsLang(e.target.value)}>
                        {voiceData.languages.map(l => (
                          <option key={l.code} value={l.code}>{l.name}</option>
                        ))}
                      </select>
                      <select className="sel" value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} disabled={availableVoices.length === 0}>
                        {availableVoices.length === 0 ? <option>No voices</option> : availableVoices.map(v => (
                          <option key={v.key} value={v.key}>{v.name} ({v.quality})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span 
                        className="btn-p" 
                        onClick={handleGenerateTTS}
                        style={{ opacity: !ttsVoice ? 0.5 : 1, pointerEvents: !ttsVoice ? 'none' : 'auto' }}
                      >
                        Generate voice
                      </span>
                    </div>

                    <div className="chips" style={{ marginTop: 'auto' }}>
                      <span className="chip">Local WASM Engine</span>
                      <span className="chip">No Cloud API</span>
                      <span className="chip">Piper TTS</span>
                    </div>
                  </>
                ) : (
                  <>
                    {dubbing.step === 'synthesizing' && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <div className="pbar"><div className="pfill" style={{ width: `${dubbing.progress}%` }}></div></div>
                        <p className="plabel">{dubbing.progressLabel || 'Synthesizing voiceovers...'}</p>
                      </div>
                    )}
                    
                    <div className="segments-list" style={{ marginTop: '0.5rem', maxHeight: '250px' }}>
                      {dubbing.segments.filter(s => (s.translatedText || s.text).trim()).map(seg => (
                        <div key={seg.id} className="segment-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div className="segment-header" style={{ marginBottom: 0 }}>
                            <span className="segment-time">{seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s</span>
                            {seg.status === 'generating' && <span style={{ fontSize: '12px', color: '#888', fontWeight: 600 }}>Generating...</span>}
                            {seg.status === 'done' && <span style={{ fontSize: '12px', color: '#4ade80', fontWeight: 600 }}>Done</span>}
                          </div>
                          <div style={{ fontSize: '13px', color: '#444' }}>{seg.translatedText?.trim() ? seg.translatedText : seg.text}</div>
                          {seg.audioBlob && (
                            <audio controls src={URL.createObjectURL(seg.audioBlob)} style={{ width: '100%', height: '36px', marginTop: '4px' }} />
                          )}
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
                      {dubbing.step !== 'synthesizing' && (
                        <>
                          <span className="btn-p" onClick={() => setCur(5)}>Continue to Stitching</span>
                          <span className="btn-g" onClick={dubbing.backToEditing} style={{ fontSize: '13px' }}>Re-edit Text</span>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Stage 5: Stitch */}
            <div 
              className="slide" 
              style={getSlideStyle(5)}
              onClick={() => handleSlideClick(5)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#FBEAF0' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8h3l2-4 2 8 2-4h3" stroke="#993556" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Stitch</div>
                    <div className="card-sub">Align and sync</div>
                  </div>
                </div>
                <div className="card-desc">Align the voiceover segments to the video timeline. Auto-sync or fine-tune offsets manually.</div>
                
                {['idle', 'extracting', 'review_audio', 'transcribing', 'editing', 'synthesizing', 'review_synthesis', 'stitching'].includes(dubbing.step) ? (
                  <>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div className="pbar">
                        <div 
                          className="pfill" 
                          style={{ width: `${dubbing.step === 'stitching' ? dubbing.progress : 0}%` }}
                        ></div>
                      </div>
                      <p className="plabel">
                        {dubbing.step === 'stitching' 
                          ? dubbing.progressLabel || 'Stitching audio segments...' 
                          : 'Waiting for TTS output'}
                      </p>
                    </div>
                    <div>
                      <span 
                        className="btn-p" 
                        onClick={dubbing.stitchAudio}
                        style={{ opacity: dubbing.step === 'stitching' ? 0.5 : 1, pointerEvents: dubbing.step === 'stitching' ? 'none' : 'auto' }}
                      >
                        {dubbing.step === 'stitching' ? 'Stitching...' : 'Auto-stitch'}
                      </span>
                    </div>

                    <div className="chips" style={{ marginTop: 'auto' }}>
                      <span className="chip">Auto-sync</span>
                      <span className="chip">Silence padding</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#444', display: 'block', marginBottom: '8px' }}>Final Audio Track</span>
                      {dubbing.stitchedAudioUrl && (
                        <audio controls src={dubbing.stitchedAudioUrl} style={{ width: '100%', height: '40px' }} />
                      )}
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span className="btn-p" onClick={() => setCur(6)}>Continue to Export</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Stage 6: Add audio */}
            <div 
              className="slide" 
              style={getSlideStyle(6)}
              onClick={() => handleSlideClick(6)}
            >
              <div className="card">
                <div className="card-head">
                  <div className="card-icon" style={{ background: '#EAF3DE' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#3B6D11" strokeWidth="1.2" fill="none"/>
                      <path d="M5 8h6M8 5v6" stroke="#3B6D11" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="card-title">Add audio</div>
                    <div className="card-sub">Merge and export</div>
                  </div>
                </div>
                <div className="card-desc">Merge the final voiceover with your video and export the dubbed file in your preferred format.</div>
                
                {dubbing.step === 'done' && dubbing.resultVideoUrl ? (
                  <>
                    <div style={{ flex: 1, minHeight: 0, marginBottom: '1rem', background: '#000', borderRadius: '12px', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                      <video src={dubbing.resultVideoUrl} controls style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    </div>
                    
                    <div style={{ marginTop: 'auto', display: 'flex', gap: '12px' }}>
                      <a href={dubbing.resultVideoUrl} download="dubbed_video.mp4" className="btn-p" style={{ flex: 1, textDecoration: 'none' }}>Download MP4</a>
                      <span className="btn-g" onClick={() => dubbing.reset()} style={{ fontSize: '13px' }}>Start Over</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: '1.5rem', opacity: dubbing.step !== 'muxing' ? 0.5 : 1 }}>
                      <div className="pbar">
                        <div 
                          className="pfill" 
                          style={{ width: `${dubbing.step === 'muxing' ? dubbing.progress : 0}%` }}
                        ></div>
                      </div>
                      <p className="plabel">
                        {dubbing.step === 'muxing' 
                          ? dubbing.progressLabel || 'Creating final video...' 
                          : 'Ready to export'}
                      </p>
                    </div>

                    <div>
                      <div className="row">
                        <select className="sel" disabled={dubbing.step === 'muxing'}>
                          <option>MP4 (H.264)</option>
                        </select>
                        <select className="sel" disabled={dubbing.step === 'muxing'}>
                          <option>Mute original</option>
                        </select>
                      </div>
                      <span 
                        className="btn-p" 
                        onClick={dubbing.muxVideo}
                        style={{ opacity: dubbing.step === 'muxing' ? 0.5 : 1, pointerEvents: dubbing.step === 'muxing' ? 'none' : 'auto' }}
                      >
                        {dubbing.step === 'muxing' ? 'Exporting...' : 'Export video'}
                      </span>
                    </div>

                    <div className="chips" style={{ marginTop: 'auto' }}>
                      <span className="chip">Local Export</span>
                      <span className="chip">Hardware Accelerated</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

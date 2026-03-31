import { useState, useEffect, useRef, useCallback } from 'react';
import { usePiper } from '../hooks/usePiper';
import { useVoices } from '../hooks/useVoices';
import './TTSPage.css';

export function TTSPage() {
  const piper = usePiper();
  const voiceData = useVoices();

  const [ttsLang, setTtsLang] = useState('en_US');
  const [ttsVoice, setTtsVoice] = useState('');
  const [inputText, setInputText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const availableVoices = voiceData.getVoicesByLanguage(ttsLang);

  // Auto-select first voice when language changes
  useEffect(() => {
    if (availableVoices.length > 0 && !availableVoices.some(v => v.key === ttsVoice)) {
      setTtsVoice(availableVoices[0].key);
    }
  }, [ttsLang, availableVoices, ttsVoice]);

  // Check cache when voice changes
  useEffect(() => {
    if (ttsVoice) piper.checkCache(ttsVoice);
  }, [ttsVoice, piper.checkCache]);

  const handleGenerate = useCallback(() => {
    if (!ttsVoice || !inputText.trim() || !voiceData.voices[ttsVoice]) return;
    piper.generateSpeech(inputText.trim(), ttsVoice, voiceData.voices[ttsVoice].files);
  }, [ttsVoice, inputText, voiceData.voices, piper.generateSpeech]);

  const selectedVoice = ttsVoice ? voiceData.voices[ttsVoice] : null;
  const isCached = piper.isCached;
  const canGenerate = !!ttsVoice && !!inputText.trim() && !piper.isLoading;

  return (
    <div className="standalone-page">
      <div className="standalone-shell">
        <div className="standalone-card">
          {/* Header */}
          <div className="card-head">
            <div className="card-icon" style={{ background: '#FAECE7' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="#993C1D" strokeWidth="1.4" fill="none" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="#993C1D" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="12" y1="19" x2="12" y2="23" stroke="#993C1D" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="8" y1="23" x2="16" y2="23" stroke="#993C1D" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className="card-title">Text to Speech</div>
              <div className="card-sub">Piper TTS · Local WASM</div>
            </div>
          </div>

          <div className="card-desc">
            Type or paste your text below, choose a voice, and generate a natural-sounding audio clip — entirely in your browser with no cloud API.
          </div>

          {/* Voice selectors */}
          <div className="row" style={{ marginBottom: '1.25rem' }}>
            <select
              className="sel"
              value={ttsLang}
              onChange={e => setTtsLang(e.target.value)}
              disabled={voiceData.isLoading || piper.isLoading}
            >
              {voiceData.isLoading
                ? <option>Loading languages…</option>
                : voiceData.languages.map(l => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))
              }
            </select>
            <select
              className="sel"
              value={ttsVoice}
              onChange={e => setTtsVoice(e.target.value)}
              disabled={availableVoices.length === 0 || piper.isLoading}
            >
              {availableVoices.length === 0
                ? <option>No voices</option>
                : availableVoices.map(v => (
                  <option key={v.key} value={v.key}>
                    {v.name} ({v.quality})
                  </option>
                ))
              }
            </select>
          </div>

          {/* Voice info badge */}
          {selectedVoice && (
            <div className="voice-meta">
              <span className="vm-badge">{selectedVoice.language.name_english}</span>
              <span className="vm-badge">{selectedVoice.quality} quality</span>
              {isCached && <span className="vm-badge vm-cached">✓ Cached</span>}
            </div>
          )}

          {/* Text input */}
          <div className="tts-input-wrap">
            <textarea
              ref={textareaRef}
              className="tts-textarea"
              placeholder="Enter text to synthesize…"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              rows={6}
              disabled={piper.isLoading}
            />
            <div className="tts-char-count">{inputText.length} chars</div>
          </div>

          {/* Progress */}
          {piper.isLoading && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="pbar">
                <div className="pfill" style={{ width: `${piper.progress}%` }} />
              </div>
              <p className="plabel">
                {piper.progress < 15
                  ? 'Preparing model…'
                  : piper.progress < 95
                  ? `Downloading model… ${piper.progress}%`
                  : 'Synthesizing audio…'}
              </p>
            </div>
          )}

          {/* Error */}
          {piper.error && (
            <div className="error-box">{piper.error}</div>
          )}

          {/* Audio output */}
          {piper.audioUrl && !piper.isLoading && (
            <div className="audio-result">
              <span className="audio-result-label">Generated Audio</span>
              <audio controls src={piper.audioUrl} style={{ width: '100%', height: '44px' }} />
              <a
                href={piper.audioUrl}
                download="tts_output.wav"
                className="btn-g btn-sm"
                style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
              >
                Download WAV
              </a>
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              className="btn-p"
              onClick={handleGenerate}
              disabled={!canGenerate}
              style={{ flex: 1, opacity: canGenerate ? 1 : 0.45 }}
            >
              {piper.isLoading ? 'Generating…' : 'Generate Speech'}
            </button>
            {piper.audioUrl && !piper.isLoading && (
              <button
                className="btn-g"
                onClick={handleGenerate}
                disabled={!canGenerate}
              >
                Regenerate
              </button>
            )}
          </div>

          {/* Chips */}
          <div className="chips" style={{ display: 'flex', marginTop: '1.25rem' }}>
            <span className="chip">Local WASM Engine</span>
            <span className="chip">No Cloud API</span>
            <span className="chip">Piper TTS</span>
          </div>
        </div>
      </div>
    </div>
  );
}

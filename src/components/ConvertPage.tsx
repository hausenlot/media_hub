import { useState, useRef, useCallback, useMemo } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { useFFmpeg } from '../hooks/useFFmpeg';
import './TTSPage.css';
import './ConvertPage.css';

// ─── Format definitions ──────────────────────────────────────────────────────

type FormatId = 'mp4' | 'webm' | 'mkv' | 'mov' | 'avi' | 'mp3' | 'aac' | 'wav' | 'ogg' | 'flac';
type PresetId = 'fast' | 'balanced' | 'hq' | 'custom';

interface FormatDef {
  id: FormatId;
  label: string;
  mime: string;
  isAudio: boolean;
  defaultVideoCodec: string;
  defaultAudioCodec: string;
  defaultCrf: number;
  defaultAudioBitrate: string;
  encoderSpeedFlag: string;
}

const FORMATS: FormatDef[] = [
  { id: 'mp4',  label: 'MP4',  mime: 'video/mp4',        isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'aac',        defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'webm', label: 'WebM', mime: 'video/webm',       isAudio: false, defaultVideoCodec: 'libvpx-vp9', defaultAudioCodec: 'libopus',    defaultCrf: 30, defaultAudioBitrate: '128k', encoderSpeedFlag: '-deadline' },
  { id: 'mkv',  label: 'MKV',  mime: 'video/x-matroska', isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'aac',        defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'mov',  label: 'MOV',  mime: 'video/quicktime',  isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'aac',        defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'avi',  label: 'AVI',  mime: 'video/x-msvideo',  isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'mp3',        defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'mp3',  label: 'MP3',  mime: 'audio/mpeg',       isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'libmp3lame', defaultCrf: 0,  defaultAudioBitrate: '192k', encoderSpeedFlag: '' },
  { id: 'aac',  label: 'AAC',  mime: 'audio/aac',        isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'aac',        defaultCrf: 0,  defaultAudioBitrate: '192k', encoderSpeedFlag: '' },
  { id: 'wav',  label: 'WAV',  mime: 'audio/wav',        isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'pcm_s16le', defaultCrf: 0,  defaultAudioBitrate: '0',    encoderSpeedFlag: '' },
  { id: 'ogg',  label: 'OGG',  mime: 'audio/ogg',        isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'libvorbis', defaultCrf: 0,  defaultAudioBitrate: '192k', encoderSpeedFlag: '' },
  { id: 'flac', label: 'FLAC', mime: 'audio/flac',       isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'flac',      defaultCrf: 0,  defaultAudioBitrate: '0',    encoderSpeedFlag: '' },
];

type PresetSettings = {
  crfDelta: number;
  speedValue: string;
  audioBitrateMultiplier: number;
};

const PRESETS: Record<PresetId, PresetSettings> = {
  fast:     { crfDelta: +5, speedValue: 'ultrafast', audioBitrateMultiplier: 0.75 },
  balanced: { crfDelta:  0, speedValue: 'medium',    audioBitrateMultiplier: 1    },
  hq:       { crfDelta: -5, speedValue: 'slow',      audioBitrateMultiplier: 1.5  },
  custom:   { crfDelta:  0, speedValue: 'medium',    audioBitrateMultiplier: 1    },
};

const RES_OPTIONS = [
  { label: 'Keep original', value: '' },
  { label: '3840×2160 (4K)',   value: '3840:2160' },
  { label: '1920×1080 (1080p)',value: '1920:1080' },
  { label: '1280×720 (720p)',  value: '1280:720'  },
  { label: '854×480 (480p)',   value: '854:480'   },
  { label: '640×360 (360p)',   value: '640:360'   },
];

const FPS_OPTIONS = [
  { label: 'Keep original', value: '' },
  { label: '60 fps', value: '60' },
  { label: '30 fps', value: '30' },
  { label: '25 fps', value: '25' },
  { label: '24 fps', value: '24' },
];

const AUDIO_BITRATE_OPTIONS = [
  { label: 'Keep original', value: '' },
  { label: '320k', value: '320k' },
  { label: '256k', value: '256k' },
  { label: '192k', value: '192k' },
  { label: '128k', value: '128k' },
  { label: '96k',  value: '96k'  },
  { label: '64k',  value: '64k'  },
];

const SAMPLE_RATE_OPTIONS = [
  { label: 'Keep original', value: '' },
  { label: '48000 Hz', value: '48000' },
  { label: '44100 Hz', value: '44100' },
  { label: '22050 Hz', value: '22050' },
  { label: '16000 Hz', value: '16000' },
];

// ─── Arg builder ─────────────────────────────────────────────────────────────

interface BuildArgs {
  fmt: FormatDef;
  preset: PresetId;
  resolution: string;
  fps: string;
  audioBitrate: string;
  videoCodec: string;
  audioCodec: string;
  crf: number;
  speedValue: string;
  audioBitrateCustom: string;
  sampleRate: string;
  extraFlags: string;
}

function buildFFmpegArgs(p: BuildArgs): string[] {
  const { fmt, preset, resolution, fps } = p;
  const isCustom = preset === 'custom';

  const videoCodec = isCustom ? p.videoCodec : fmt.defaultVideoCodec;
  const audioCodec = isCustom ? p.audioCodec : fmt.defaultAudioCodec;

  const presetCfg = PRESETS[preset];
  const crf = isCustom ? p.crf : Math.max(0, fmt.defaultCrf + presetCfg.crfDelta);

  let aBitrate = '';
  if (fmt.defaultAudioBitrate !== '0') {
    aBitrate = !isCustom
      ? p.audioBitrate || scaleKbps(fmt.defaultAudioBitrate, presetCfg.audioBitrateMultiplier)
      : p.audioBitrateCustom || fmt.defaultAudioBitrate;
  }

  const args: string[] = ['-i', '__INPUT__'];

  if (fmt.isAudio) {
    args.push('-vn', '-c:a', audioCodec);
    if (aBitrate) args.push('-b:a', aBitrate);
  } else {
    args.push('-c:v', videoCodec);
    if (fmt.encoderSpeedFlag) {
      args.push(fmt.encoderSpeedFlag, isCustom ? p.speedValue : resolveSpeed(preset, fmt));
    }
    if (crf > 0) args.push('-crf', String(crf));
    if (resolution) args.push('-vf', `scale=${resolution}`);
    if (fps) args.push('-r', fps);
    args.push('-c:a', audioCodec);
    if (aBitrate) args.push('-b:a', aBitrate);
  }

  if (isCustom && p.sampleRate) args.push('-ar', p.sampleRate);

  if (isCustom && p.extraFlags.trim()) {
    args.push(...p.extraFlags.trim().split(/\s+/));
  }

  args.push(`output.${fmt.id}`);
  return args;
}

function scaleKbps(bitrate: string, mult: number): string {
  const n = parseInt(bitrate);
  return isNaN(n) ? bitrate : `${Math.round(n * mult)}k`;
}

function resolveSpeed(preset: PresetId, fmt: FormatDef): string {
  if (fmt.id === 'webm') {
    return ({ fast: 'realtime', balanced: 'good', hq: 'best', custom: 'good' } as Record<PresetId, string>)[preset];
  }
  return PRESETS[preset].speedValue;
}

// ─── Side-by-side comparison overlay ─────────────────────────────────────────

function VideoComparison({
  inputUrl, outputUrl, outputName, fmt,
  onClose, onConvertAgain,
}: {
  inputUrl: string; outputUrl: string; outputName: string; fmt: FormatDef;
  onClose: () => void; onConvertAgain: () => void;
}) {
  return (
    <div className="compare-overlay">
      <div className="compare-topbar">
        <div className="compare-title">
          <span className="compare-badge input-badge">Original</span>
          <span className="compare-arrow">→</span>
          <span className="compare-badge output-badge">{fmt.label.toUpperCase()}</span>
          <span className="compare-label">Side-by-side comparison</span>
        </div>
        <div className="compare-actions">
          <a href={outputUrl} download={outputName} className="compare-dl-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download {fmt.label}
          </a>
          <button className="compare-again-btn" onClick={onConvertAgain}>Convert again</button>
          <button className="compare-close-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="compare-body">
        <div className="compare-panel">
          <div className="compare-panel-label">Original</div>
          <video
            src={inputUrl}
            controls
            className="compare-video"
            loop
          />
        </div>
        <div className="compare-divider" />
        <div className="compare-panel">
          <div className="compare-panel-label output-label">{fmt.label} · Converted</div>
          <video
            src={outputUrl}
            controls
            className="compare-video"
            loop
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConvertPage() {
  const ff = useFFmpeg();

  const [file, setFile]             = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [outputFmt, setOutputFmt]   = useState<FormatId>('mp4');
  const [preset, setPreset]         = useState<PresetId>('balanced');
  const [showAdv, setShowAdv]       = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  // Quick params
  const [resolution, setResolution]     = useState('');
  const [fps, setFps]                   = useState('');
  const [audioBitrate, setAudioBitrate] = useState('');

  // Custom/Advanced params
  const fmt = FORMATS.find(f => f.id === outputFmt)!;
  const [videoCodec, setVideoCodec]               = useState(fmt.defaultVideoCodec);
  const [audioCodec, setAudioCodec]               = useState(fmt.defaultAudioCodec);
  const [crf, setCrf]                             = useState(fmt.defaultCrf);
  const [speedValue, setSpeedValue]               = useState(PRESETS.balanced.speedValue);
  const [audioBitrateCustom, setAudioBitrateCus]  = useState(fmt.defaultAudioBitrate);
  const [sampleRate, setSampleRate]               = useState('');
  const [extraFlags, setExtraFlags]               = useState('');

  const [outputUrl, setOutputUrl]   = useState<string | null>(null);
  const [outputName, setOutputName] = useState('output.mp4');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputPreviewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  const isVideoInput    = file?.type.startsWith('video/') ?? false;
  const isVideoOutput   = !fmt.isAudio;
  const canCompare      = isVideoInput && isVideoOutput && !!outputUrl && !!inputPreviewUrl;

  const handleFormatChange = useCallback((id: FormatId) => {
    const f = FORMATS.find(x => x.id === id)!;
    setOutputFmt(id);
    setVideoCodec(f.defaultVideoCodec);
    setAudioCodec(f.defaultAudioCodec);
    setCrf(f.defaultCrf);
    setAudioBitrateCus(f.defaultAudioBitrate);
    setOutputUrl(null);
    setShowCompare(false);
  }, []);

  const handlePresetChange = useCallback((p: PresetId) => {
    setPreset(p);
    setShowAdv(p === 'custom');
    if (p !== 'custom') setSpeedValue(PRESETS[p].speedValue);
  }, []);

  const handleDragOver  = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop      = useCallback((e: DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setOutputUrl(null); setShowCompare(false); }
  }, []);
  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setOutputUrl(null); setShowCompare(false); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file || !ff.convertMedia) return;
    setOutputUrl(null);
    setShowCompare(false);

    const args = buildFFmpegArgs({
      fmt, preset, resolution, fps, audioBitrate,
      videoCodec, audioCodec, crf, speedValue,
      audioBitrateCustom, sampleRate, extraFlags,
    });

    const outFile = `output.${fmt.id}`;
    setOutputName(`${file.name.replace(/\.[^.]+$/, '')}_converted.${fmt.id}`);

    try {
      const blob = await ff.convertMedia(file, args, outFile, fmt.mime);
      setOutputUrl(URL.createObjectURL(blob));
    } catch {
      // error already in ff.error
    }
  }, [file, ff, fmt, preset, resolution, fps, audioBitrate, videoCodec, audioCodec, crf, speedValue, audioBitrateCustom, sampleRate, extraFlags]);

  const handleReset = useCallback(() => {
    setFile(null);
    setOutputUrl(null);
    setShowCompare(false);
  }, []);

  const isRunning = ff.isLoading;

  return (
    <>
      {/* ── Side-by-side comparison overlay ── */}
      {showCompare && canCompare && (
        <VideoComparison
          inputUrl={inputPreviewUrl!}
          outputUrl={outputUrl!}
          outputName={outputName}
          fmt={fmt}
          onClose={() => setShowCompare(false)}
          onConvertAgain={() => { setShowCompare(false); setOutputUrl(null); }}
        />
      )}

      <div className="standalone-page">
        <div className="standalone-shell convert-shell">
          {/* Card: header is fixed, body scrolls, footer (actions) is fixed */}
          <div className="standalone-card convert-card">

            {/* ── Fixed header ── */}
            <div className="card-head" style={{ flexShrink: 0 }}>
              <div className="card-icon" style={{ background: '#dcfce7' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12v-2a8 8 0 0 1 16 0"   stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 12v2a8 8 0 0 1-16 0"   stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="4 8 4 12 8 12"     stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="20 16 20 12 16 12" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <div className="card-title">Convert</div>
                <div className="card-sub">Format conversion · FFmpeg WASM</div>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className="convert-body">

              {!file ? (
                <>
                  <div className="card-desc">
                    Convert any video or audio file to a different format — entirely in your browser. Pick your output format and optional parameters below.
                  </div>
                  <div
                    className={`stt-upload-zone convert-drop ${isDragging ? 'drag-active' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg className="upload-icon" viewBox="0 0 28 28" fill="none">
                      <path d="M14 18V10M10 14l4-4 4 4" stroke="#333" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      <rect x="3" y="3" width="22" height="22" rx="4" stroke="#333" strokeWidth="1.2" />
                    </svg>
                    <span className="uz-title">Drop a video or audio file here</span>
                    <span className="uz-sub">MP4, MOV, AVI, MKV, WebM, MP3, WAV…</span>
                  </div>
                </>
              ) : (
                <>
                  {/* ── File row ── */}
                  <div className="stt-file-box" style={{ marginBottom: '1rem' }}>
                    <div className="stt-file-row">
                      <div className="stt-file-info">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="3" width="18" height="18" rx="3" stroke="#16a34a" strokeWidth="1.5" />
                          <polygon points="10 8 16 12 10 16 10 8" fill="#16a34a" />
                        </svg>
                        <span className="stt-file-name">{file.name}</span>
                      </div>
                      {!isRunning && (
                        <button className="btn-g btn-sm" onClick={handleReset}>Change</button>
                      )}
                    </div>
                    {isVideoInput && inputPreviewUrl && (
                      <video src={inputPreviewUrl} muted controls style={{ width: '100%', maxHeight: '110px', borderRadius: '8px', objectFit: 'contain', background: '#000' }} />
                    )}
                    {file.type.startsWith('audio/') && inputPreviewUrl && (
                      <audio controls src={inputPreviewUrl} style={{ width: '100%', height: '40px' }} />
                    )}
                  </div>

                  {/* ── Output format grid ── */}
                  <div className="convert-section-label">Output format</div>
                  <div className="format-grid">
                    <div className="format-group-label">Video</div>
                    {FORMATS.filter(f => !f.isAudio).map(f => (
                      <button key={f.id} className={`fmt-pill ${outputFmt === f.id ? 'active' : ''}`} onClick={() => handleFormatChange(f.id)} disabled={isRunning}>
                        {f.label}
                      </button>
                    ))}
                    <div className="format-group-label" style={{ marginLeft: '12px' }}>Audio</div>
                    {FORMATS.filter(f => f.isAudio).map(f => (
                      <button key={f.id} className={`fmt-pill ${outputFmt === f.id ? 'active' : ''}`} onClick={() => handleFormatChange(f.id)} disabled={isRunning}>
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* ── Quick params ── */}
                  <div className="convert-section-label" style={{ marginTop: '1rem' }}>Parameters</div>
                  <div className="quick-params">
                    {!fmt.isAudio && (
                      <>
                        <div className="qp-field">
                          <label className="qp-label">Resolution</label>
                          <select className="sel qp-sel" value={resolution} onChange={e => setResolution(e.target.value)} disabled={isRunning}>
                            {RES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="qp-field">
                          <label className="qp-label">Frame rate</label>
                          <select className="sel qp-sel" value={fps} onChange={e => setFps(e.target.value)} disabled={isRunning}>
                            {FPS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      </>
                    )}
                    <div className="qp-field">
                      <label className="qp-label">Audio bitrate</label>
                      <select className="sel qp-sel" value={audioBitrate} onChange={e => setAudioBitrate(e.target.value)} disabled={isRunning || ['wav','flac'].includes(outputFmt)}>
                        {AUDIO_BITRATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* ── Preset toggle ── */}
                  <div className="convert-section-label" style={{ marginTop: '1rem' }}>Preset</div>
                  <div className="preset-tabs">
                    {(['fast', 'balanced', 'hq', 'custom'] as PresetId[]).map(p => (
                      <button key={p} className={`preset-tab ${preset === p ? 'active' : ''}`} onClick={() => handlePresetChange(p)} disabled={isRunning}>
                        {p === 'fast' ? '⚡ Fast' : p === 'balanced' ? '⚖ Balanced' : p === 'hq' ? '✦ HQ' : '⚙ Custom'}
                      </button>
                    ))}
                  </div>

                  {/* ── Advanced params ── */}
                  <div className={`adv-panel ${showAdv ? 'open' : ''}`}>
                    <div className="adv-inner">
                      <div className="adv-grid">
                        {!fmt.isAudio && (
                          <>
                            <label className="adv-label">Video codec<span className="adv-hint">e.g. libx264, libvpx-vp9</span></label>
                            <input className="adv-input" value={videoCodec} onChange={e => setVideoCodec(e.target.value)} disabled={isRunning} />

                            <label className="adv-label">Encoder speed<span className="adv-hint">ultrafast → slow</span></label>
                            <input className="adv-input" value={speedValue} onChange={e => setSpeedValue(e.target.value)} disabled={isRunning} />

                            <label className="adv-label">CRF quality<span className="adv-hint">0 = lossless, 51 = worst</span></label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input type="range" min="0" max="51" value={crf} onChange={e => setCrf(Number(e.target.value))} disabled={isRunning} style={{ flex: 1 }} />
                              <span className="adv-crf-val">{crf}</span>
                            </div>
                          </>
                        )}
                        <label className="adv-label">Audio codec<span className="adv-hint">e.g. aac, libmp3lame</span></label>
                        <input className="adv-input" value={audioCodec} onChange={e => setAudioCodec(e.target.value)} disabled={isRunning} />

                        <label className="adv-label">Audio bitrate<span className="adv-hint">e.g. 192k (ignored for wav/flac)</span></label>
                        <input className="adv-input" value={audioBitrateCustom} onChange={e => setAudioBitrateCus(e.target.value)} disabled={isRunning || ['wav','flac'].includes(outputFmt)} />

                        <label className="adv-label">Sample rate<span className="adv-hint">Hz, blank = keep</span></label>
                        <select className="sel adv-sel" value={sampleRate} onChange={e => setSampleRate(e.target.value)} disabled={isRunning}>
                          {SAMPLE_RATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>

                        <label className="adv-label">Extra flags<span className="adv-hint">raw ffmpeg flags</span></label>
                        <input className="adv-input" placeholder="-threads 2 -movflags +faststart" value={extraFlags} onChange={e => setExtraFlags(e.target.value)} disabled={isRunning} />
                      </div>

                      <div className="cmd-preview">
                        <span className="cmd-label">Generated command</span>
                        <code className="cmd-code">
                          ffmpeg {buildFFmpegArgs({ fmt, preset, resolution, fps, audioBitrate, videoCodec, audioCodec, crf, speedValue, audioBitrateCustom, sampleRate, extraFlags }).map((a, i) => i === 1 ? '<input>' : a).join(' ')}
                        </code>
                      </div>
                    </div>
                  </div>

                  {/* ── Progress ── */}
                  {isRunning && (
                    <div style={{ marginTop: '1rem' }}>
                      <div className="pbar">
                        <div className="pfill convert-fill" style={{ width: `${ff.progress}%` }} />
                      </div>
                      <p className="plabel">
                        {ff.progress < 5 ? 'Loading FFmpeg…' : ff.progress < 99 ? `Converting… ${ff.progress}%` : 'Finalizing…'}
                      </p>
                    </div>
                  )}

                  {/* ── Error ── */}
                  {ff.error && <div className="error-box" style={{ marginTop: '0.75rem' }}>{ff.error}</div>}

                  {/* ── Inline output (audio, or video thumbnail) ── */}
                  {outputUrl && !isRunning && (
                    <div className="convert-output">
                      <div className="convert-output-header">
                        <span className="audio-result-label">✓ Conversion complete</span>
                        {canCompare && (
                          <button className="compare-trigger-btn" onClick={() => setShowCompare(true)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="2" width="8" height="20" rx="1"/><rect x="14" y="2" width="8" height="20" rx="1"/>
                            </svg>
                            Compare side-by-side
                          </button>
                        )}
                      </div>
                      {fmt.isAudio
                        ? <audio controls src={outputUrl} style={{ width: '100%', height: '40px' }} />
                        : <video controls src={outputUrl} style={{ width: '100%', maxHeight: '100px', borderRadius: '8px', objectFit: 'contain', background: '#000' }} />
                      }
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Fixed footer ── */}
            <div className="convert-footer">
              {!file ? (
                <button className="btn-p convert-btn" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}>
                  Browse files
                </button>
              ) : (
                <>
                  <button
                    className="btn-p convert-btn"
                    onClick={handleConvert}
                    disabled={isRunning}
                    style={{ flex: 1, opacity: isRunning ? 0.45 : 1 }}
                  >
                    {isRunning ? 'Converting…' : `Convert to ${fmt.label}`}
                  </button>
                  {outputUrl && !isRunning && (
                    <a
                      href={outputUrl}
                      download={outputName}
                      className="btn-p convert-btn"
                      style={{ textDecoration: 'none' }}
                    >
                      Download {fmt.label}
                    </a>
                  )}
                </>
              )}
            </div>

            {/* ── Chips ── */}
            <div className="chips" style={{ display: 'flex', flexShrink: 0, paddingTop: '0.75rem' }}>
              <span className="chip">FFmpeg WASM</span>
              <span className="chip">10 formats</span>
              <span className="chip">No upload</span>
            </div>

          </div>
        </div>
      </div>

      <input type="file" accept="video/*,audio/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
    </>
  );
}

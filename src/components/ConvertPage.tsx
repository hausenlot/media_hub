import { useState, useRef, useCallback, useMemo } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { useFFmpeg } from '../hooks/useFFmpeg';
import './TTSPage.css';   // shared standalone-* base
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
  defaultAudioBitrate: string; // e.g. "192k"
  encoderSpeedFlag: string;    // e.g. "-preset"
}

const FORMATS: FormatDef[] = [
  { id: 'mp4',  label: 'MP4',  mime: 'video/mp4',       isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'aac',         defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'webm', label: 'WebM', mime: 'video/webm',      isAudio: false, defaultVideoCodec: 'libvpx-vp9', defaultAudioCodec: 'libopus',     defaultCrf: 30, defaultAudioBitrate: '128k', encoderSpeedFlag: '-deadline' },
  { id: 'mkv',  label: 'MKV',  mime: 'video/x-matroska',isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'aac',         defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'mov',  label: 'MOV',  mime: 'video/quicktime', isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'aac',         defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'avi',  label: 'AVI',  mime: 'video/x-msvideo', isAudio: false, defaultVideoCodec: 'libx264',    defaultAudioCodec: 'mp3',         defaultCrf: 23, defaultAudioBitrate: '128k', encoderSpeedFlag: '-preset' },
  { id: 'mp3',  label: 'MP3',  mime: 'audio/mpeg',      isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'libmp3lame',  defaultCrf: 0,  defaultAudioBitrate: '192k', encoderSpeedFlag: '' },
  { id: 'aac',  label: 'AAC',  mime: 'audio/aac',       isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'aac',         defaultCrf: 0,  defaultAudioBitrate: '192k', encoderSpeedFlag: '' },
  { id: 'wav',  label: 'WAV',  mime: 'audio/wav',       isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'pcm_s16le',   defaultCrf: 0,  defaultAudioBitrate: '0',    encoderSpeedFlag: '' },
  { id: 'ogg',  label: 'OGG',  mime: 'audio/ogg',       isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'libvorbis',   defaultCrf: 0,  defaultAudioBitrate: '192k', encoderSpeedFlag: '' },
  { id: 'flac', label: 'FLAC', mime: 'audio/flac',      isAudio: true,  defaultVideoCodec: '',           defaultAudioCodec: 'flac',        defaultCrf: 0,  defaultAudioBitrate: '0',    encoderSpeedFlag: '' },
];

type PresetSettings = {
  crfDelta: number;          // added to format default
  speedValue: string;        // ultrafast / medium / slow  (or realtime/good/best for vp9)
  audioBitrateMultiplier: number; // 0.75 / 1 / 1.5
};

const PRESETS: Record<PresetId, PresetSettings> = {
  fast:     { crfDelta: +5,  speedValue: 'ultrafast', audioBitrateMultiplier: 0.75 },
  balanced: { crfDelta:  0,  speedValue: 'medium',    audioBitrateMultiplier: 1    },
  hq:       { crfDelta: -5,  speedValue: 'slow',      audioBitrateMultiplier: 1.5  },
  custom:   { crfDelta:  0,  speedValue: 'medium',    audioBitrateMultiplier: 1    },
};

const RES_OPTIONS = [
  { label: 'Keep original', value: '' },
  { label: '3840×2160 (4K)', value: '3840:2160' },
  { label: '1920×1080 (1080p)', value: '1920:1080' },
  { label: '1280×720 (720p)',   value: '1280:720'  },
  { label: '854×480 (480p)',    value: '854:480'   },
  { label: '640×360 (360p)',    value: '640:360'   },
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
  audioBitrate: string;    // quick param (overrides custom)
  // custom fields
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
  const crf = isCustom
    ? p.crf
    : Math.max(0, fmt.defaultCrf + presetCfg.crfDelta);

  // Resolve audio bitrate
  let aBitrate = '';
  if (fmt.defaultAudioBitrate !== '0') {
    if (!isCustom) {
      // quick param wins if set, otherwise computed from preset
      aBitrate = p.audioBitrate || scaleKbps(fmt.defaultAudioBitrate, presetCfg.audioBitrateMultiplier);
    } else {
      aBitrate = p.audioBitrateCustom || fmt.defaultAudioBitrate;
    }
  }

  const args: string[] = ['-i', '__INPUT__'];

  if (fmt.isAudio) {
    args.push('-vn');
    args.push('-c:a', audioCodec);
    if (aBitrate) args.push('-b:a', aBitrate);
  } else {
    args.push('-c:v', videoCodec);
    if (fmt.encoderSpeedFlag) {
      const spd = isCustom ? p.speedValue : resolveSpeed(preset, fmt);
      args.push(fmt.encoderSpeedFlag, spd);
    }
    if (crf > 0) args.push('-crf', String(crf));
    if (resolution) args.push('-vf', `scale=${resolution}`);
    if (fps) args.push('-r', fps);
    args.push('-c:a', audioCodec);
    if (aBitrate) args.push('-b:a', aBitrate);
  }

  if (isCustom && p.sampleRate) args.push('-ar', p.sampleRate);

  // Extra custom flags (split on space, respecting quotes naively)
  if (isCustom && p.extraFlags.trim()) {
    const extra = p.extraFlags.trim().split(/\s+/);
    args.push(...extra);
  }

  args.push(`output.${fmt.id}`);
  return args;
}

function scaleKbps(bitrate: string, mult: number): string {
  const n = parseInt(bitrate);
  if (isNaN(n)) return bitrate;
  return `${Math.round(n * mult)}k`;
}

function resolveSpeed(preset: PresetId, fmt: FormatDef): string {
  if (fmt.id === 'webm') {
    return { fast: 'realtime', balanced: 'good', hq: 'best', custom: 'good' }[preset];
  }
  return PRESETS[preset].speedValue;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConvertPage() {
  const ff = useFFmpeg();

  const [file, setFile]           = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [outputFmt, setOutputFmt] = useState<FormatId>('mp4');
  const [preset, setPreset]       = useState<PresetId>('balanced');
  const [showAdv, setShowAdv]     = useState(false);

  // Quick params
  const [resolution, setResolution]     = useState('');
  const [fps, setFps]                   = useState('');
  const [audioBitrate, setAudioBitrate] = useState('');

  // Custom/Advanced params
  const fmt = FORMATS.find(f => f.id === outputFmt)!;
  const [videoCodec, setVideoCodec]             = useState(fmt.defaultVideoCodec);
  const [audioCodec, setAudioCodec]             = useState(fmt.defaultAudioCodec);
  const [crf, setCrf]                           = useState(fmt.defaultCrf);
  const [speedValue, setSpeedValue]             = useState(PRESETS.balanced.speedValue);
  const [audioBitrateCustom, setAudioBitrateCus] = useState(fmt.defaultAudioBitrate);
  const [sampleRate, setSampleRate]             = useState('');
  const [extraFlags, setExtraFlags]             = useState('');

  const [outputUrl, setOutputUrl]   = useState<string | null>(null);
  const [outputName, setOutputName] = useState('output.mp4');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync custom defaults when format changes
  const handleFormatChange = useCallback((id: FormatId) => {
    const f = FORMATS.find(x => x.id === id)!;
    setOutputFmt(id);
    setVideoCodec(f.defaultVideoCodec);
    setAudioCodec(f.defaultAudioCodec);
    setCrf(f.defaultCrf);
    setAudioBitrateCus(f.defaultAudioBitrate);
    setOutputUrl(null);
  }, []);

  // When preset changes, sync speed default
  const handlePresetChange = useCallback((p: PresetId) => {
    setPreset(p);
    setShowAdv(p === 'custom');
    if (p !== 'custom') setSpeedValue(PRESETS[p].speedValue);
  }, []);

  // File drop
  const handleDragOver = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setOutputUrl(null); }
  }, []);
  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setOutputUrl(null); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Preview URL for input file
  const inputPreviewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

  const handleConvert = useCallback(async () => {
    if (!file || !ff.convertMedia) return;
    setOutputUrl(null);

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

  const isRunning = ff.isLoading;

  return (
    <div className="standalone-page">
      <div className="standalone-shell convert-shell">
        <div className="standalone-card">

          {/* ── Header ── */}
          <div className="card-head">
            <div className="card-icon" style={{ background: '#dcfce7' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M4 12v-2a8 8 0 0 1 16 0"        stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 12v2a8 8 0 0 1-16 0"        stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="4 8 4 12 8 12"          stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="20 16 20 12 16 12"      stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className="card-title">Convert</div>
              <div className="card-sub">Format conversion · FFmpeg WASM</div>
            </div>
          </div>

          {/* ── File Drop ── */}
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
              {/* ── File info + preview ── */}
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
                    <button className="btn-g btn-sm" onClick={() => { setFile(null); setOutputUrl(null); }}>Change</button>
                  )}
                </div>
                {file.type.startsWith('video/') && inputPreviewUrl && (
                  <video src={inputPreviewUrl} muted controls style={{ width: '100%', maxHeight: '120px', borderRadius: '8px', objectFit: 'contain', background: '#000' }} />
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
                  <button
                    key={f.id}
                    className={`fmt-pill ${outputFmt === f.id ? 'active' : ''}`}
                    onClick={() => handleFormatChange(f.id)}
                    disabled={isRunning}
                  >
                    {f.label}
                  </button>
                ))}
                <div className="format-group-label" style={{ marginLeft: '12px' }}>Audio</div>
                {FORMATS.filter(f => f.isAudio).map(f => (
                  <button
                    key={f.id}
                    className={`fmt-pill ${outputFmt === f.id ? 'active' : ''}`}
                    onClick={() => handleFormatChange(f.id)}
                    disabled={isRunning}
                  >
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
                  <button
                    key={p}
                    className={`preset-tab ${preset === p ? 'active' : ''}`}
                    onClick={() => handlePresetChange(p)}
                    disabled={isRunning}
                  >
                    {p === 'fast' ? '⚡ Fast' : p === 'balanced' ? '⚖ Balanced' : p === 'hq' ? '✦ HQ' : '⚙ Custom'}
                  </button>
                ))}
              </div>

              {/* ── Advanced params (Custom only) ── */}
              <div className={`adv-panel ${showAdv ? 'open' : ''}`}>
                <div className="adv-inner">
                  <div className="adv-grid">
                    {!fmt.isAudio && (
                      <>
                        <label className="adv-label">Video codec<span className="adv-hint">e.g. libx264, libvpx-vp9</span></label>
                        <input className="adv-input" value={videoCodec} onChange={e => setVideoCodec(e.target.value)} disabled={isRunning || fmt.isAudio} />

                        <label className="adv-label">Encoder speed<span className="adv-hint">ultrafast → slow</span></label>
                        <input className="adv-input" value={speedValue} onChange={e => setSpeedValue(e.target.value)} disabled={isRunning || fmt.isAudio} />

                        <label className="adv-label">CRF quality<span className="adv-hint">0 = lossless, 51 = worst</span></label>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input type="range" min="0" max="51" value={crf} onChange={e => setCrf(Number(e.target.value))} disabled={isRunning || fmt.isAudio} style={{ flex: 1 }} />
                          <span className="adv-crf-val">{crf}</span>
                        </div>
                      </>
                    )}

                    <label className="adv-label">Audio codec<span className="adv-hint">e.g. aac, libmp3lame, libvorbis</span></label>
                    <input className="adv-input" value={audioCodec} onChange={e => setAudioCodec(e.target.value)} disabled={isRunning} />

                    <label className="adv-label">Audio bitrate<span className="adv-hint">e.g. 192k (ignored for wav/flac)</span></label>
                    <input className="adv-input" value={audioBitrateCustom} onChange={e => setAudioBitrateCus(e.target.value)} disabled={isRunning || ['wav','flac'].includes(outputFmt)} />

                    <label className="adv-label">Sample rate<span className="adv-hint">Hz, leave blank = keep</span></label>
                    <select className="sel adv-sel" value={sampleRate} onChange={e => setSampleRate(e.target.value)} disabled={isRunning}>
                      {SAMPLE_RATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>

                    <label className="adv-label">Extra flags<span className="adv-hint">raw ffmpeg flags, space-separated</span></label>
                    <input className="adv-input" placeholder="-threads 2 -movflags +faststart" value={extraFlags} onChange={e => setExtraFlags(e.target.value)} disabled={isRunning} />
                  </div>

                  {/* Live preview of generated command */}
                  <div className="cmd-preview">
                    <span className="cmd-label">Generated command</span>
                    <code className="cmd-code">
                      ffmpeg {buildFFmpegArgs({ fmt, preset, resolution, fps, audioBitrate, videoCodec, audioCodec, crf, speedValue, audioBitrateCustom, sampleRate, extraFlags }).map((a, i) => i === 1 ? `<input>` : a).join(' ')}
                    </code>
                  </div>
                </div>
              </div>

              {/* ── Progress ── */}
              {isRunning && (
                <div style={{ marginTop: '0.75rem' }}>
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

              {/* ── Output ── */}
              {outputUrl && !isRunning && (
                <div className="convert-output">
                  <span className="audio-result-label">✓ Conversion complete</span>
                  {fmt.isAudio
                    ? <audio controls src={outputUrl} style={{ width: '100%', height: '40px' }} />
                    : <video controls src={outputUrl} style={{ width: '100%', maxHeight: '100px', borderRadius: '8px', objectFit: 'contain', background: '#000' }} />
                  }
                  <a
                    href={outputUrl}
                    download={outputName}
                    className="btn-p convert-dl-btn"
                    style={{ textDecoration: 'none', alignSelf: 'flex-start' }}
                  >
                    Download {fmt.label}
                  </a>
                </div>
              )}
            </>
          )}

          <input
            type="file"
            accept="video/*,audio/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* ── Actions ── */}
          <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', alignItems: 'center', paddingTop: '1rem' }}>
            {!file ? (
              <button
                className="btn-p convert-btn"
                onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1 }}
              >
                Browse files
              </button>
            ) : (
              <button
                className="btn-p convert-btn"
                onClick={handleConvert}
                disabled={isRunning}
                style={{ flex: 1, opacity: isRunning ? 0.45 : 1 }}
              >
                {isRunning ? 'Converting…' : `Convert to ${fmt.label}`}
              </button>
            )}
            {!isRunning && outputUrl && (
              <button className="btn-g" onClick={() => setOutputUrl(null)}>Convert again</button>
            )}
          </div>

          {/* ── Chips ── */}
          <div className="chips" style={{ display: 'flex', marginTop: '1.25rem' }}>
            <span className="chip">FFmpeg WASM</span>
            <span className="chip">10 formats</span>
            <span className="chip">No upload</span>
          </div>

        </div>
      </div>
    </div>
  );
}

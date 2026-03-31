import { useState, useRef } from 'react';
import { type DubbingSegment } from '../hooks/useDubbing';

interface TranscriptEditorProps {
  segments: DubbingSegment[];
  onUpdateText: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onAdd: (afterId: string) => void;
  originalAudioUrl: string | null;
  disabled?: boolean;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export function TranscriptEditor({
  segments,
  onUpdateText,
  onRemove,
  onAdd,
  originalAudioUrl,
  disabled = false,
}: TranscriptEditorProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playOriginalSegment = (startTime: number, endTime: number, segId: string) => {
    if (!originalAudioUrl) return;
    
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(originalAudioUrl);
    audioRef.current = audio;
    audio.currentTime = startTime;
    setPlayingId(segId);

    audio.ontimeupdate = () => {
      if (audio.currentTime >= endTime) {
        audio.pause();
        setPlayingId(null);
      }
    };
    audio.onended = () => setPlayingId(null);
    audio.play();
  };

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  return (
    <div className="transcript-editor">
      <div className="editor-header">
        <h3>Transcript Segments</h3>
        <span className="segment-count">{segments.length} segments</span>
      </div>
      
      <div className="segments-list">
        {segments.map((seg, idx) => (
          <div 
            key={seg.id} 
            className={`segment-item ${seg.status === 'generating' ? 'generating' : ''} ${seg.status === 'done' ? 'done' : ''}`}
          >
            <div className="segment-header">
              <span className="segment-number">#{idx + 1}</span>
              <span className="segment-time">
                {formatTime(seg.startTime)} → {formatTime(seg.endTime)}
              </span>
              <span className={`segment-status status-${seg.status}`}>
                {seg.status === 'generating' && '⟳ Generating...'}
                {seg.status === 'done' && '✓ Ready'}
                {seg.status === 'pending' && '○ Pending'}
                {seg.status === 'error' && '✕ Error'}
              </span>
            </div>
            
            <div className="segment-body">
              <textarea
                className="segment-text"
                value={seg.text}
                onChange={(e) => onUpdateText(seg.id, e.target.value)}
                disabled={disabled}
                rows={2}
                placeholder="Enter text for this segment..."
              />
              
              <div className="segment-actions">
                {originalAudioUrl && (
                  <button
                    className="btn-icon"
                    onClick={() => {
                      if (playingId === seg.id) {
                        stopPlayback();
                      } else {
                        playOriginalSegment(seg.startTime, seg.endTime, seg.id);
                      }
                    }}
                    title="Play original audio for this segment"
                    disabled={disabled}
                  >
                    {playingId === seg.id ? '⏹' : '▶'}
                  </button>
                )}
                <button
                  className="btn-icon btn-add"
                  onClick={() => onAdd(seg.id)}
                  title="Add segment after this one"
                  disabled={disabled}
                >
                  +
                </button>
                <button
                  className="btn-icon btn-remove"
                  onClick={() => onRemove(seg.id)}
                  title="Remove this segment"
                  disabled={disabled || segments.length <= 1}
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

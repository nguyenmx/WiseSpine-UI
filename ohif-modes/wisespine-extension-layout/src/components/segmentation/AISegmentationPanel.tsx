import React, { useRef, useState } from 'react';
import { useAISegmentation } from './useAISegmentation';

const DOT_COLORS = [
  '#DC3C3C', '#E66E28', '#F0A01E', '#DCC828', '#82C83C', '#32B450',
  '#28AAA0', '#2882C8', '#3C50C8', '#6432C8', '#A028C8', '#C82888',
];

function SegmentDot({ index }: { index: number }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      backgroundColor: DOT_COLORS[index % DOT_COLORS.length],
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

function ProgressBar({ active }: { active: boolean }) {
  return (
    <div style={{ height: 4, borderRadius: 2, backgroundColor: '#374151', overflow: 'hidden', margin: '8px 0' }}>
      {active && (
        <div style={{
          height: '100%', width: '40%', backgroundColor: '#3B82F6', borderRadius: 2,
          animation: 'wisespine-slide 1.8s ease-in-out infinite',
        }} />
      )}
      <style>{`
        @keyframes wisespine-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%);  }
        }
      `}</style>
    </div>
  );
}

const STAGE_STYLES: Record<string, { bg: string; fg: string }> = {
  fetch:   { bg: '#1E3A5F', fg: '#60A5FA' },
  convert: { bg: '#3B1F5E', fg: '#A78BFA' },
  upload:  { bg: '#3D2A1A', fg: '#FB923C' },
};

const ACCEPTED = '.nii,.nii.gz,.dcm';

interface AISegmentationPanelProps {
  servicesManager: any;
  extensionManager: any;
}

export default function AISegmentationPanel({ servicesManager, extensionManager }: AISegmentationPanelProps) {
  const { state, uploadMask, reset } = useAISegmentation({ servicesManager, extensionManager });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isActive = state.status === 'submitting' || state.status === 'running' || state.status === 'loading';

  const handleFile = (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.nii') && !name.endsWith('.nii.gz') && !name.endsWith('.dcm')) {
      alert('Unsupported format. Please use .nii, .nii.gz, or .dcm');
      return;
    }
    setSelectedFile(file);
    reset();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleUpload = () => {
    if (selectedFile) uploadMask(selectedFile);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#000', color: '#fff', fontFamily: 'sans-serif', fontSize: 13 }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #1F2937', fontWeight: 600, fontSize: 13, letterSpacing: '0.02em', color: '#E5E7EB' }}>
        Segmentation Mask Upload
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>

        {/* Drop zone */}
        <div
          onClick={() => !isActive && fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragging ? '#3B82F6' : '#374151'}`,
            borderRadius: 8,
            padding: '20px 12px',
            textAlign: 'center',
            cursor: isActive ? 'not-allowed' : 'pointer',
            backgroundColor: dragging ? '#1E3A5F22' : 'transparent',
            transition: 'border-color 0.15s, background-color 0.15s',
            marginBottom: 10,
          }}
        >
          <div style={{ color: '#9CA3AF', fontSize: 22, marginBottom: 6 }}>⬆</div>
          <div style={{ color: '#D1D5DB', fontWeight: 500, marginBottom: 4 }}>
            Drop mask file here
          </div>
          <div style={{ color: '#6B7280', fontSize: 11 }}>
            .nii.gz &nbsp;·&nbsp; .nii &nbsp;·&nbsp; .dcm
          </div>
          <div style={{ color: '#4B5563', fontSize: 11, marginTop: 4 }}>or click to browse</div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />

        {/* Selected file + action buttons */}
        {selectedFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ flex: 1, color: '#93C5FD', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedFile.name}
            </span>
            <button
              onClick={handleUpload}
              disabled={isActive}
              style={{
                padding: '5px 12px', borderRadius: 6, border: 'none',
                cursor: isActive ? 'not-allowed' : 'pointer',
                backgroundColor: isActive ? '#374151' : '#2563EB',
                color: isActive ? '#6B7280' : '#fff',
                fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
              }}
            >
              {isActive ? 'Uploading…' : '▶ Upload'}
            </button>
            {!isActive && (
              <button
                onClick={() => { setSelectedFile(null); reset(); }}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #374151', cursor: 'pointer', backgroundColor: 'transparent', color: '#9CA3AF', fontSize: 12 }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Progress */}
        {(isActive || (state.message && state.status !== 'done' && state.status !== 'error')) && (
          <div style={{ marginBottom: 10 }}>
            {(state.stage && state.stage !== 'queued') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                  backgroundColor: STAGE_STYLES[state.stage]?.bg ?? '#1F2937',
                  color: STAGE_STYLES[state.stage]?.fg ?? '#9CA3AF',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {state.stage}
                </span>
                {state.elapsedSeconds > 0 && (
                  <span style={{ color: '#6B7280', fontSize: 11 }}>
                    {Math.floor(state.elapsedSeconds / 60)}m {state.elapsedSeconds % 60}s
                  </span>
                )}
              </div>
            )}
            <div style={{ color: '#93C5FD', marginBottom: 4 }}>{state.message}</div>
            <ProgressBar active={isActive} />
          </div>
        )}

        {/* Error */}
        {state.status === 'error' && state.error && (
          <div style={{ backgroundColor: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 6, padding: '8px 10px', color: '#FCA5A5', marginBottom: 10, fontSize: 12 }}>
            {state.error}
            <button onClick={() => { setSelectedFile(null); reset(); }} style={{ display: 'block', marginTop: 6, color: '#FCA5A5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 11, padding: 0 }}>
              Try again
            </button>
          </div>
        )}

        {/* Success */}
        {state.status === 'done' && (
          <div style={{ backgroundColor: '#052E16', border: '1px solid #14532D', borderRadius: 6, padding: '8px 10px', color: '#86EFAC', marginBottom: 10, fontSize: 12 }}>
            ✓ {state.message}
          </div>
        )}

        {/* Segment list */}
        {state.segments.length > 0 && (
          <div>
            <div style={{ color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Segments ({state.segments.length})
            </div>
            <div style={{ backgroundColor: '#111827', borderRadius: 6, padding: '6px 8px', maxHeight: 200, overflowY: 'auto' }}>
              {state.segments.map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', padding: '3px 0', borderBottom: i < state.segments.length - 1 ? '1px solid #1F2937' : 'none' }}>
                  <SegmentDot index={i} />
                  <span style={{ color: '#D1D5DB' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Idle hint */}
        {state.status === 'idle' && !selectedFile && (
          <div style={{ color: '#4B5563', fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
            Open a CT series in the viewer, then drop your segmentation mask above.
            Supports NIfTI (.nii, .nii.gz) and DICOM SEG (.dcm).
          </div>
        )}
      </div>
    </div>
  );
}

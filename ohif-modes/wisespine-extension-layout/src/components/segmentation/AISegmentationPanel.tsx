import React from 'react';
import { useAISegmentation } from './useAISegmentation';

// Simple colour pill shown next to each segment name
const DOT_COLORS = [
  '#DC3C3C', '#E66E28', '#F0A01E', '#DCC828', '#82C83C', '#32B450',
  '#28AAA0', '#2882C8', '#3C50C8', '#6432C8', '#A028C8', '#C82888',
];

function SegmentDot({ index }: { index: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        backgroundColor: DOT_COLORS[index % DOT_COLORS.length],
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function ProgressBar({ active }: { active: boolean }) {
  return (
    <div
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: '#374151',
        overflow: 'hidden',
        margin: '8px 0',
      }}
    >
      {active && (
        <div
          style={{
            height: '100%',
            width: '40%',
            backgroundColor: '#3B82F6',
            borderRadius: 2,
            animation: 'wisespine-slide 1.8s ease-in-out infinite',
          }}
        />
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

interface AISegmentationPanelProps {
  servicesManager: any;
  extensionManager: any;
}

export default function AISegmentationPanel({
  servicesManager,
  extensionManager,
}: AISegmentationPanelProps) {
  const { state, runSegmentation, reset } = useAISegmentation({
    servicesManager,
    extensionManager,
  });

  const isActive = state.status === 'submitting' || state.status === 'running' || state.status === 'loading';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#000',
        color: '#fff',
        fontFamily: 'sans-serif',
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px 8px',
          borderBottom: '1px solid #1F2937',
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: '0.02em',
          color: '#E5E7EB',
        }}
      >
        TotalSegmentator
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>

        {/* Run / Reset buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            onClick={runSegmentation}
            disabled={isActive}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: 6,
              border: 'none',
              cursor: isActive ? 'not-allowed' : 'pointer',
              backgroundColor: isActive ? '#374151' : '#2563EB',
              color: isActive ? '#6B7280' : '#fff',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {isActive ? 'Running…' : '▶ Run Segmentation'}
          </button>

          {(state.status === 'done' || state.status === 'error') && (
            <button
              onClick={reset}
              style={{
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid #374151',
                cursor: 'pointer',
                backgroundColor: 'transparent',
                color: '#9CA3AF',
                fontSize: 13,
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Status / progress */}
        {(isActive || state.message) && state.status !== 'error' && state.status !== 'done' && (
          <div style={{ marginBottom: 10 }}>
            {/* Stage badge + elapsed time */}
            {(state.stage || state.elapsedSeconds > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {state.stage && state.stage !== 'queued' && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor:
                        state.stage === 'fetch'   ? '#1E3A5F' :
                        state.stage === 'segment' ? '#3B1F5E' :
                        state.stage === 'convert' ? '#1F3D2A' :
                        state.stage === 'upload'  ? '#3D2A1A' :
                        '#1F2937',
                      color:
                        state.stage === 'fetch'   ? '#60A5FA' :
                        state.stage === 'segment' ? '#A78BFA' :
                        state.stage === 'convert' ? '#4ADE80' :
                        state.stage === 'upload'  ? '#FB923C' :
                        '#9CA3AF',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {state.stage}
                  </span>
                )}
                {state.elapsedSeconds > 0 && (
                  <span style={{ color: '#6B7280', fontSize: 11 }}>
                    {Math.floor(state.elapsedSeconds / 60)}m {state.elapsedSeconds % 60}s
                  </span>
                )}
              </div>
            )}
            <div style={{ color: '#93C5FD', marginBottom: 4 }}>{state.message}</div>
            <ProgressBar active={isActive} />
            {state.status === 'running' && (
              <div style={{ color: '#6B7280', fontSize: 11, marginTop: 4 }}>
                CPU mode — spine only. Typical time: ~5–20 min depending on scan length.
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {state.status === 'error' && state.error && (
          <div
            style={{
              backgroundColor: '#450A0A',
              border: '1px solid #7F1D1D',
              borderRadius: 6,
              padding: '8px 10px',
              color: '#FCA5A5',
              marginBottom: 10,
              fontSize: 12,
            }}
          >
            {state.error}
          </div>
        )}

        {/* Success message */}
        {state.status === 'done' && (
          <div
            style={{
              backgroundColor: '#052E16',
              border: '1px solid #14532D',
              borderRadius: 6,
              padding: '8px 10px',
              color: '#86EFAC',
              marginBottom: 10,
              fontSize: 12,
            }}
          >
            ✓ {state.message}
          </div>
        )}

        {/* Segment list */}
        {state.segments.length > 0 && (
          <div>
            <div
              style={{
                color: '#6B7280',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 6,
              }}
            >
              Detected structures ({state.segments.length})
            </div>
            <div
              style={{
                backgroundColor: '#111827',
                borderRadius: 6,
                padding: '6px 8px',
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              {state.segments.map((label, i) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '3px 0',
                    borderBottom: i < state.segments.length - 1 ? '1px solid #1F2937' : 'none',
                  }}
                >
                  <SegmentDot index={i} />
                  <span style={{ color: '#D1D5DB' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Idle hint */}
        {state.status === 'idle' && (
          <div style={{ color: '#4B5563', fontSize: 12, lineHeight: 1.5 }}>
            Open a CT spine series in the viewer, then click Run Segmentation.
            TotalSegmentator will automatically segment all visible vertebrae and
            the spinal cord and load the result as a DICOM SEG overlay.
          </div>
        )}
      </div>
    </div>
  );
}

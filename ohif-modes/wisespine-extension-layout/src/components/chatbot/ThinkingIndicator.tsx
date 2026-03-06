import React, { useState, useEffect } from 'react';

const THINKING_PHRASES = [
  'Thinking...', 'Analyzing...', 'Processing...', 'Reasoning...',
  'Consulting...', 'Evaluating...', 'Examining...', 'Deliberating...',
  'Contemplating...', 'Reflecting...', 'Investigating...', 'Pondering...',
];

export default function ThinkingIndicator() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % THINKING_PHRASES.length);
        setVisible(true);
      }, 350);
    }, 1800);
    return () => clearInterval(cycle);
  }, []);
  return (
    <span style={{ transition: 'opacity 0.35s ease', opacity: visible ? 1 : 0 }}>
      {THINKING_PHRASES[idx]}
    </span>
  );
}

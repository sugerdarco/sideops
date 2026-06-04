import { useEffect, useRef } from 'react';
import styles from './LogViewer.module.css';

export function LogViewer({ logs, phase }) {
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className={styles.terminal}>
      <div className={styles.header}>
        <div className={styles.dots}>
          <span className={styles.dot} style={{ background: '#ff5f57' }} />
          <span className={styles.dot} style={{ background: '#febc2e' }} />
          <span className={styles.dot} style={{ background: '#28c840' }} />
        </div>
        <span className={styles.title}>build output</span>
        <span className={styles.count}>{logs.length} lines</span>
      </div>
      <div className={styles.body}>
        {logs.map((line, i) => (
          <div key={i} className={`${styles.line} ${getLineClass(line, styles)}`}>
            <span className={styles.lineNum}>{String(i + 1).padStart(4, ' ')}</span>
            <span className={styles.lineText}>{line}</span>
          </div>
        ))}
        {(phase === 'queued' || phase === 'building') && (
          <div className={styles.cursor}>▋</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function getLineClass(line, styles) {
  if (line.includes('✓') || line.includes('complete') || line.includes('success')) return styles.lineSuccess;
  if (line.includes('✗') || line.includes('ERROR') || line.includes('error')) return styles.lineError;
  if (line.includes('[s3]')) return styles.lineS3;
  if (line.includes('[build]')) return styles.lineBuild;
  return '';
}

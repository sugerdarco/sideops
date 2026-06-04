import styles from './StatusBadge.module.css';

const CONFIG = {
  idle:     { label: 'idle',     color: 'muted'   },
  queued:   { label: 'queued',   color: 'warning', pulse: true },
  building: { label: 'building', color: 'accent',  pulse: true },
  success:  { label: 'success',  color: 'success'  },
  failed:   { label: 'failed',   color: 'danger'   },
};

export function StatusBadge({ phase }) {
  const { label, color, pulse } = CONFIG[phase] ?? CONFIG.idle;
  return (
    <span className={`${styles.badge} ${styles[color]} ${pulse ? styles.pulse : ''}`}>
      <span className={styles.dot} />
      {label}
    </span>
  );
}

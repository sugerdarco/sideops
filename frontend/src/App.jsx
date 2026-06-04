import { useState } from 'react';
import { useBuild } from './hooks/useBuild.js';
import { StatusBadge } from './components/StatusBadge.jsx';
import { LogViewer } from './components/LogViewer.jsx';
import styles from './App.module.css';

const BASE_DOMAIN = import.meta.env.VITE_BASE_DOMAIN || 'localhost:8080';

export default function App() {
  const [gitUrl, setGitUrl] = useState('');
  const { phase, projectId, logs, error, deploy, reset } = useBuild();

  const deployedUrl = projectId ? `http://${projectId}.${BASE_DOMAIN}` : null;
  const isActive = phase === 'queued' || phase === 'building';
  const isDone = phase === 'success' || phase === 'failed';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!gitUrl.trim() || isActive) return;
    deploy(gitUrl.trim());
  };

  const handleReset = () => {
    setGitUrl('');
    reset();
  };

  return (
    <div className={styles.page}>
      {/* ── Background grid ── */}
      <div className={styles.grid} aria-hidden />

      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="url(#lg)" />
            <path d="M8 14h4l2-6 2 12 2-6h2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="28" y2="28">
                <stop stopColor="#5b6af0" />
                <stop offset="1" stopColor="#818cf8" />
              </linearGradient>
            </defs>
          </svg>
          <span>SideOps</span>
        </div>
        <span className={styles.tagline}>Deploy any static site from GitHub</span>
      </header>

      {/* ── Main card ── */}
      <main className={styles.main}>
        <div className={styles.card}>

          {/* Title row */}
          <div className={styles.cardHeader}>
            <div>
              <h1 className={styles.title}>New Deployment</h1>
              <p className={styles.sub}>Paste a GitHub repo URL — we handle the rest.</p>
            </div>
            {phase !== 'idle' && <StatusBadge phase={phase} />}
          </div>

          {/* ── Deploy form ── */}
          {!isDone && (
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.inputWrap}>
                <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
                <input
                  className={styles.input}
                  type="url"
                  placeholder="https://github.com/username/repo"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  disabled={isActive}
                  autoFocus
                  spellCheck={false}
                />
              </div>
              <button
                className={`${styles.btn} ${isActive ? styles.btnActive : ''}`}
                type="submit"
                disabled={!gitUrl.trim() || isActive}
              >
                {isActive ? (
                  <>
                    <Spinner />
                    {phase === 'queued' ? 'Queued…' : 'Building…'}
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="5 12 12 5 19 12" />
                      <line x1="12" y1="5" x2="12" y2="19" />
                    </svg>
                    Deploy
                  </>
                )}
              </button>
            </form>
          )}

          {/* ── Error banner ── */}
          {error && (
            <div className={styles.errorBanner}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* ── Success banner ── */}
          {phase === 'success' && deployedUrl && (
            <div className={styles.successBanner}>
              <div className={styles.successTop}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Deployed successfully!</span>
              </div>
              <a
                className={styles.deployedLink}
                href={deployedUrl}
                target="_blank"
                rel="noreferrer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {deployedUrl}
              </a>
            </div>
          )}

          {/* ── Failed banner ── */}
          {phase === 'failed' && !error && (
            <div className={styles.errorBanner}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              Build failed. Check the logs below for details.
            </div>
          )}

          {/* ── Log viewer ── */}
          <LogViewer logs={logs} phase={phase} />

          {/* ── Reset button ── */}
          {isDone && (
            <button className={styles.resetBtn} onClick={handleReset}>
              ← Deploy another project
            </button>
          )}

        </div>

        {/* ── How it works ── */}
        {phase === 'idle' && (
          <div className={styles.steps}>
            {[
              { n: '01', title: 'Paste URL', body: 'Any public GitHub repo with a build step.' },
              { n: '02', title: 'We build it', body: 'Cloned, installed, and built inside an isolated container.' },
              { n: '03', title: 'Instant URL', body: 'Your app is live at a unique subdomain in seconds.' },
            ].map(({ n, title, body }) => (
              <div key={n} className={styles.step}>
                <span className={styles.stepNum}>{n}</span>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        Built with Node.js · BullMQ · Redis · AWS S3 · ECS
      </footer>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

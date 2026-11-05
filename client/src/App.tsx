import { useMemo } from 'react';
import styles from './App.module.css';
import { Dropzone } from './components/Dropzone';
import { GallerySection } from './components/GallerySection';
import { Icon, type IconName } from './components/Icon';
import type { ImageCardActions } from './components/ImageCard';
import { ToastProvider } from './components/toast/ToastProvider';
import {
  selectInProgressCards,
  selectSectionCards,
  selectSectionCount,
} from './features/uploads/selectors';
import {
  UploadsProvider,
  useLiveStatus,
  useUploadsActions,
  useUploadsState,
} from './features/uploads/UploadsProvider';
import type { LiveStatus } from './features/uploads/useImageEvents';
import { cx } from './lib/cx';

// Mirrors the server's default validation thresholds (see .env.example).
const GUIDELINES: Array<{ icon: IconName; text: string }> = [
  { icon: 'file', text: 'JPG, PNG or HEIC' },
  { icon: 'user', text: 'Exactly one person, face clearly visible' },
  { icon: 'focus', text: 'Sharp and in focus' },
  { icon: 'resolution', text: 'At least 512 px on the shorter side' },
  { icon: 'layers', text: 'No duplicates or near-duplicates' },
];

export function App() {
  return (
    <ToastProvider>
      <UploadsProvider>
        <UploadPage />
      </UploadsProvider>
    </ToastProvider>
  );
}

function UploadPage() {
  const state = useUploadsState();
  const actions = useUploadsActions();

  const inProgress = useMemo(() => selectInProgressCards(state), [state]);
  const accepted = useMemo(() => selectSectionCards(state, 'accepted'), [state]);
  const rejected = useMemo(() => selectSectionCards(state, 'rejected'), [state]);

  const cardActions = useMemo<ImageCardActions>(
    () => ({
      onDelete: (imageId) => void actions.deleteImage(imageId),
      onDismiss: actions.dismissUpload,
      onRetry: actions.retryUpload,
    }),
    [actions],
  );

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <Icon name="image" size={18} />
          </span>
          <span>Clearshot</span>
        </div>
        <LiveIndicator />
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="page-title">
          <div className={styles.intro}>
            <h1 id="page-title">Upload your photos</h1>
            <p>
              Each photo is checked automatically. Accepted photos are ready to use, and rejected
              ones tell you exactly what to fix.
            </p>
          </div>
          <Dropzone onFiles={(files) => void actions.addFiles(files)} />
          <ul className={styles.guidelines} aria-label="Photo requirements">
            {GUIDELINES.map((guideline) => (
              <li key={guideline.text}>
                <Icon name={guideline.icon} size={15} />
                {guideline.text}
              </li>
            ))}
          </ul>
        </section>

        {inProgress.length > 0 && (
          <GallerySection
            title="In progress"
            description="Uploading and checking. Results appear below as soon as they are ready."
            tone="accent"
            icon="upload"
            count={inProgress.length}
            cards={inProgress}
            actions={cardActions}
            emptyMessage=""
          />
        )}

        <GallerySection
          title="Accepted"
          description="These photos passed every check."
          tone="success"
          icon="check"
          count={selectSectionCount(state, 'accepted')}
          cards={accepted}
          actions={cardActions}
          emptyMessage="Accepted photos will appear here."
          loading={state.sections.accepted.loading}
          loaded={state.sections.accepted.loaded}
          error={state.sections.accepted.error}
          hasMore={state.sections.accepted.nextCursor !== null}
          onLoadMore={() => actions.loadMore('accepted')}
          onRetry={() => actions.reloadSection('accepted')}
        />

        <GallerySection
          title="Rejected"
          description="Each photo lists what to fix. Upload a better version to try again."
          tone="danger"
          icon="close"
          count={selectSectionCount(state, 'rejected')}
          cards={rejected}
          actions={cardActions}
          emptyMessage="Nothing rejected so far."
          loading={state.sections.rejected.loading}
          loaded={state.sections.rejected.loaded}
          error={state.sections.rejected.error}
          hasMore={state.sections.rejected.nextCursor !== null}
          onLoadMore={() => actions.loadMore('rejected')}
          onRetry={() => actions.reloadSection('rejected')}
        />
      </main>
    </div>
  );
}

const LIVE_LABELS: Record<LiveStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live updates',
  reconnecting: 'Reconnecting…',
};

function LiveIndicator() {
  const status = useLiveStatus();
  return (
    <span
      className={cx(styles.liveBadge, styles[status])}
      title="Photo statuses update in real time"
    >
      <span className={styles.liveDot} aria-hidden="true" />
      {LIVE_LABELS[status]}
    </span>
  );
}

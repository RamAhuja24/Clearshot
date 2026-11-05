import { useState } from 'react';
import type { CardModel } from '../features/uploads/selectors';
import { cx } from '../lib/cx';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import styles from './ImageCard.module.css';
import { StatusBadge, statusLabel } from './StatusBadge';

export interface ImageCardActions {
  onDelete: (imageId: string) => void;
  onDismiss: (localId: string) => void;
  onRetry: (localId: string) => void;
}

const REASON_ICONS: Record<string, IconName> = {
  BLURRY: 'focus',
  NO_FACE: 'user',
  MULTIPLE_FACES: 'user',
  FACE_TOO_SMALL: 'user',
  DUPLICATE: 'layers',
  TOO_SIMILAR: 'layers',
  RESOLUTION_TOO_LOW: 'resolution',
  FILE_TOO_SMALL: 'resolution',
  UNREADABLE_IMAGE: 'file',
  NOT_UPLOADED: 'file',
};

function statusLine(card: CardModel): string | null {
  switch (card.status) {
    case 'queued':
      return 'Waiting to upload…';
    case 'uploading':
      return `Uploading… ${Math.round((card.progress ?? 0) * 100)}%`;
    case 'processing':
      return 'Checking photo quality…';
    default:
      return card.meta;
  }
}

export function ImageCard({ card, actions }: { card: CardModel; actions: ImageCardActions }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isBusy =
    card.status === 'queued' || card.status === 'uploading' || card.status === 'processing';
  const canDelete = card.imageId !== null && !isBusy && card.localId === null;
  const canDismiss =
    card.localId !== null && (card.status === 'blocked' || card.status === 'error');
  const showPreview = card.previewUrl !== null && !previewFailed;

  return (
    <article
      className={cx(styles.card, styles[card.status])}
      aria-label={`${card.name}: ${statusLabel(card.status)}`}
    >
      <div className={styles.preview}>
        {showPreview ? (
          <img
            src={card.previewUrl!}
            alt={`Preview of ${card.name}`}
            loading="lazy"
            decoding="async"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className={styles.placeholder}>
            <Icon name="image" size={30} />
            {isBusy && <span>Preview after processing</span>}
          </div>
        )}

        {isBusy && <div className={styles.scanning} aria-hidden="true" />}
        <StatusBadge status={card.status} className={styles.badge} />

        <div className={styles.toolbar}>
          {card.downloadUrl && !isBusy && (
            <a
              className={styles.iconButton}
              href={card.downloadUrl}
              aria-label={`Download ${card.name}`}
              title="Download"
            >
              <Icon name="download" size={17} />
            </a>
          )}
          {canDelete && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Delete ${card.name}`}
              title="Delete"
            >
              <Icon name="trash" size={17} />
            </button>
          )}
          {canDismiss && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => actions.onDismiss(card.localId!)}
              aria-label={`Dismiss ${card.name}`}
              title="Dismiss"
            >
              <Icon name="close" size={17} />
            </button>
          )}
        </div>

        {card.status === 'uploading' && (
          <div
            className={styles.progress}
            role="progressbar"
            aria-label={`Uploading ${card.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((card.progress ?? 0) * 100)}
          >
            <div
              className={styles.progressFill}
              style={{ width: `${(card.progress ?? 0) * 100}%` }}
            />
          </div>
        )}

        {confirmingDelete && (
          <div className={styles.confirm} role="alertdialog" aria-label={`Delete ${card.name}?`}>
            <p>Delete this photo?</p>
            <div className={styles.confirmActions}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                autoFocus
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirmingDelete(false);
                  actions.onDelete(card.imageId!);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <p className={styles.name} title={card.name}>
          {card.name}
        </p>
        <p className={styles.meta}>{statusLine(card)}</p>

        {card.reasons.length > 0 && (
          <ul className={styles.reasons}>
            {card.reasons.map((reason) => (
              <li key={reason.code + reason.message}>
                <Icon
                  name={REASON_ICONS[reason.code] ?? 'alert'}
                  size={15}
                  className={styles.reasonIcon}
                />
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        )}

        {card.status === 'error' && (
          <div className={styles.errorRow}>
            <span>{card.error}</span>
            <Button size="sm" variant="secondary" onClick={() => actions.onRetry(card.localId!)}>
              <Icon name="refresh" size={14} />
              Retry
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

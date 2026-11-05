import type { CardStatus } from '../features/uploads/selectors';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';
import styles from './StatusBadge.module.css';

const BADGES: Record<
  CardStatus,
  { label: string; tone: string; icon?: IconName; spinner?: boolean }
> = {
  queued: { label: 'Queued', tone: 'neutral' },
  uploading: { label: 'Uploading', tone: 'accent', spinner: true },
  processing: { label: 'Checking', tone: 'accent', spinner: true },
  accepted: { label: 'Accepted', tone: 'success', icon: 'check' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert' },
  blocked: { label: 'Not uploaded', tone: 'warning', icon: 'alert' },
  error: { label: 'Upload failed', tone: 'danger', icon: 'alert' },
};

export function statusLabel(status: CardStatus): string {
  return BADGES[status].label;
}

export function StatusBadge({ status, className }: { status: CardStatus; className?: string }) {
  const badge = BADGES[status];
  return (
    <span className={cx(styles.badge, styles[badge.tone], className)}>
      {badge.spinner ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        badge.icon && <Icon name={badge.icon} size={13} />
      )}
      {badge.label}
    </span>
  );
}

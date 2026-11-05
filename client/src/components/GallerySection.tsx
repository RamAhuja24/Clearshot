import { useId } from 'react';
import type { CardModel } from '../features/uploads/selectors';
import { cx } from '../lib/cx';
import { Button } from './Button';
import styles from './GallerySection.module.css';
import { Icon, type IconName } from './Icon';
import { ImageCard, type ImageCardActions } from './ImageCard';

interface GallerySectionProps {
  title: string;
  description: string;
  tone: 'accent' | 'success' | 'danger';
  icon: IconName;
  count: number;
  cards: CardModel[];
  actions: ImageCardActions;
  emptyMessage: string;
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
}

const SKELETON_CARDS = 4;

export function GallerySection(props: GallerySectionProps) {
  const headingId = useId();
  const { cards, loading = false, loaded = true, error = null } = props;
  const showSkeleton = cards.length === 0 && loading && !loaded;

  return (
    <section className={styles.section} aria-labelledby={headingId} aria-busy={loading}>
      <header className={styles.header}>
        <span className={cx(styles.icon, styles[props.tone])}>
          <Icon name={props.icon} size={16} />
        </span>
        <div className={styles.heading}>
          <h2 id={headingId}>
            {props.title}
            <span className={cx(styles.count, styles[props.tone])}>{props.count}</span>
          </h2>
          <p>{props.description}</p>
        </div>
      </header>

      {error && cards.length === 0 ? (
        <div className={styles.notice}>
          <span>Couldn't load these photos. {error}</span>
          {props.onRetry && (
            <Button size="sm" variant="secondary" onClick={props.onRetry}>
              Try again
            </Button>
          )}
        </div>
      ) : showSkeleton ? (
        <ul className={styles.grid} aria-hidden="true">
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <li key={i} className={styles.skeleton} />
          ))}
        </ul>
      ) : cards.length === 0 ? (
        <p className={styles.empty}>{props.emptyMessage}</p>
      ) : (
        <ul className={styles.grid}>
          {cards.map((card) => (
            <li key={card.key}>
              <ImageCard card={card} actions={props.actions} />
            </li>
          ))}
        </ul>
      )}

      {props.hasMore && props.onLoadMore && (
        <div className={styles.more}>
          <Button variant="secondary" onClick={props.onLoadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </section>
  );
}

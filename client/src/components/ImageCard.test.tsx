import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CardModel } from '../features/uploads/selectors';
import { ImageCard } from './ImageCard';

const baseCard: CardModel = {
  key: 'img-1',
  name: 'portrait.jpg',
  status: 'rejected',
  previewUrl: '/thumb.webp',
  progress: null,
  meta: '800 × 1000 · 120 KB · JPEG',
  reasons: [
    { code: 'BLURRY', message: 'Image is too blurry (sharpness 12, minimum 100).' },
    { code: 'MULTIPLE_FACES', message: '2 faces detected; the photo must show only one person.' },
  ],
  error: null,
  imageId: 'img-1',
  localId: null,
  downloadUrl: '/download',
};

const actions = () => ({ onDelete: vi.fn(), onDismiss: vi.fn(), onRetry: vi.fn() });

describe('ImageCard', () => {
  it('shows the status and every rejection reason', () => {
    render(<ImageCard card={baseCard} actions={actions()} />);
    expect(screen.getByRole('article', { name: 'portrait.jpg: Rejected' })).toBeInTheDocument();
    expect(screen.getByText(/too blurry/)).toBeInTheDocument();
    expect(screen.getByText(/2 faces detected/)).toBeInTheDocument();
  });

  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    render(<ImageCard card={baseCard} actions={handlers} />);

    await user.click(screen.getByRole('button', { name: 'Delete portrait.jpg' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete portrait.jpg' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(handlers.onDelete).toHaveBeenCalledWith('img-1');
  });

  it('reports upload progress and offers a retry after a failure', async () => {
    const { rerender } = render(
      <ImageCard
        card={{ ...baseCard, status: 'uploading', progress: 0.42, localId: 'l1', reasons: [] }}
        actions={actions()}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();

    const handlers = actions();
    rerender(
      <ImageCard
        card={{
          ...baseCard,
          status: 'error',
          error: 'Network error.',
          localId: 'l1',
          imageId: null,
          reasons: [],
        }}
        actions={handlers}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Retry/ }));
    expect(handlers.onRetry).toHaveBeenCalledWith('l1');
  });
});

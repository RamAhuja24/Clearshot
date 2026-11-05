import { useEffect, useEffectEvent, useState } from 'react';
import { eventsUrl } from '../../api/client';
import type { ImageDto, ImageEvent } from '../../api/types';

export interface ImageEventHandlers {
  onUpdated: (image: ImageDto) => void;
  onDeleted: (id: string) => void;
  /** Called after a dropped connection is restored, to catch up on missed events. */
  onReconnected: () => void;
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/** Subscribes to server-sent image events. EventSource reconnects on its own. */
export function useImageEvents(handlers: ImageEventHandlers): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const onUpdated = useEffectEvent(handlers.onUpdated);
  const onDeleted = useEffectEvent(handlers.onDeleted);
  const onReconnected = useEffectEvent(handlers.onReconnected);

  useEffect(() => {
    const source = new EventSource(eventsUrl());
    let hasConnected = false;

    const parse = (event: Event) => JSON.parse((event as MessageEvent<string>).data) as ImageEvent;

    source.addEventListener('open', () => {
      if (hasConnected) onReconnected();
      hasConnected = true;
      setStatus('live');
    });
    source.addEventListener('error', () => setStatus(hasConnected ? 'reconnecting' : 'connecting'));
    source.addEventListener('image.updated', (event) => {
      const data = parse(event);
      if (data.type === 'image.updated') onUpdated(data.image);
    });
    source.addEventListener('image.deleted', (event) => {
      const data = parse(event);
      if (data.type === 'image.deleted') onDeleted(data.id);
    });

    return () => source.close();
  }, []);

  return status;
}

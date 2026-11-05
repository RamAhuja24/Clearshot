import type { Request, Response } from 'express';

const HEARTBEAT_MS = 25_000;
const CLIENT_RETRY_MS = 3_000;

/**
 * Fans server events out to connected browsers over Server-Sent Events.
 * Heartbeats keep idle connections open through proxies and load balancers.
 */
export class SseHub {
  private readonly clients = new Set<Response>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.writeAll(': heartbeat\n\n'), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  get size(): number {
    return this.clients.size;
  }

  connect(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${CLIENT_RETRY_MS}\n\n`);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  broadcast(event: string, data: unknown): void {
    this.writeAll(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  private writeAll(chunk: string): void {
    for (const client of this.clients) client.write(chunk);
  }
}

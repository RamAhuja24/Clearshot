import type { Knex } from 'knex';
import type { ImageFormat } from '../../lib/fileType.js';
import type {
  ImageRecord,
  ImageStatus,
  ImageWithReasons,
  RejectionCode,
  RejectionReason,
} from './domain.js';
import type { PageCursor } from './pagination.js';

/** Application-wide advisory lock that serialises the final duplicate check. */
const SIMILARITY_LOCK_KEY = 7_284_310_001;

export interface NewImage {
  id: string;
  original_filename: string;
  format: ImageFormat;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  original_key: string;
}

export interface ListImagesOptions {
  statuses?: ImageStatus[];
  limit: number;
  cursor?: PageCursor;
}

export interface ProcessingResult {
  status: 'accepted' | 'rejected';
  width: number | null;
  height: number | null;
  phash: bigint | null;
  blurScore: number | null;
  faceCount: number | null;
  faceAreaRatio: number | null;
  similarToId: string | null;
  thumbnailKey: string | null;
  convertedKey: string | null;
  reasons: RejectionReason[];
}

export interface SimilarImageMatch {
  id: string;
  distance: number;
  exact: boolean;
}

interface ReasonRow {
  image_id: string;
  code: RejectionCode;
  message: string;
  details: Record<string, unknown> | null;
}

type ListedImageRow = ImageRecord & { cursor_created_at: string };

/** Postgres has no unsigned 64-bit type, so hashes are stored as signed bigints. */
const toSignedInt64 = (value: bigint) => BigInt.asIntN(64, value).toString();

export class ImageRepository {
  constructor(private readonly db: Knex) {}

  transaction<T>(work: (repo: ImageRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((trx) => work(new ImageRepository(trx)));
  }

  async insert(image: NewImage): Promise<ImageRecord> {
    const [row] = await this.db<ImageRecord>('images').insert(image).returning('*');
    if (!row) throw new Error('Insert returned no row');
    return row;
  }

  findById(id: string): Promise<ImageRecord | undefined> {
    return this.db<ImageRecord>('images').where({ id }).first();
  }

  async findWithReasons(id: string): Promise<ImageWithReasons | undefined> {
    const image = await this.findById(id);
    if (!image) return undefined;
    const reasons = await this.reasonsByImageId([id]);
    return { image, reasons: reasons.get(id) ?? [] };
  }

  /** Keyset pagination: index-backed at any depth, unlike OFFSET. */
  async list({ statuses, limit, cursor }: ListImagesOptions): Promise<{
    items: ImageWithReasons[];
    nextCursor: PageCursor | null;
  }> {
    const query = this.db<ImageRecord>('images')
      .select<ListedImageRow[]>(
        '*',
        this.db.raw(
          `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
        ),
      )
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit + 1);

    if (statuses?.length) query.whereIn('status', statuses);
    if (cursor) {
      query.whereRaw('(created_at, id) < (?::timestamptz, ?::uuid)', [cursor.createdAt, cursor.id]);
    }

    const rows = await query;
    const page = rows.slice(0, limit);
    const last = rows.length > limit ? page.at(-1) : undefined;
    const reasons = await this.reasonsByImageId(page.map((row) => row.id));

    return {
      items: page.map(({ cursor_created_at: _, ...image }) => ({
        image,
        reasons: reasons.get(image.id) ?? [],
      })),
      nextCursor: last ? { createdAt: last.cursor_created_at, id: last.id } : null,
    };
  }

  async countByStatus(): Promise<Record<ImageStatus, number>> {
    const rows = await this.db('images')
      .select<{ status: ImageStatus; count: number }[]>(
        'status',
        this.db.raw('count(*)::int AS count'),
      )
      .groupBy('status');
    const counts: Record<ImageStatus, number> = {
      processing: 0,
      accepted: 0,
      rejected: 0,
      failed: 0,
    };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  async deleteById(id: string): Promise<ImageRecord | undefined> {
    const [row] = await this.db<ImageRecord>('images').where({ id }).delete().returning('*');
    return row;
  }

  /** Records the hash as soon as it is known, so later uploads can see this image is pending. */
  async saveHash(id: string, phash: bigint): Promise<void> {
    await this.db('images')
      .where({ id, status: 'processing' })
      .update({ phash: toSignedInt64(phash) });
  }

  /**
   * True if an older upload that may be the same picture is still being processed.
   * Its hash may not be known yet, so a missing hash also counts. Uploads older than
   * `staleAfterSeconds` are ignored, so a stuck job can never block newer ones.
   */
  async hasPendingPredecessor(options: {
    id: string;
    sha256: string;
    phash: bigint;
    maxDistance: number;
    staleAfterSeconds: number;
  }): Promise<boolean> {
    const phash = toSignedInt64(options.phash);
    const row = await this.db('images as other')
      .first(this.db.raw('1 AS pending'))
      .where('other.status', 'processing')
      .whereRaw('(other.created_at, other.id) < (SELECT created_at, id FROM images WHERE id = ?)', [
        options.id,
      ])
      .whereRaw('other.created_at > now() - make_interval(secs => ?)', [options.staleAfterSeconds])
      .where((similar) =>
        similar
          .whereNull('other.phash')
          .orWhere('other.sha256', options.sha256)
          .orWhereRaw('bit_count((other.phash # ?::bigint)::bit(64)) <= ?', [
            phash,
            options.maxDistance,
          ]),
      );
    return row !== undefined;
  }

  /** Must run inside a transaction; released automatically on commit or rollback. */
  async acquireSimilarityLock(): Promise<void> {
    await this.db.raw('SELECT pg_advisory_xact_lock(?::bigint)', [SIMILARITY_LOCK_KEY]);
  }

  /**
   * Finds the closest accepted image: an exact byte match first, then the
   * nearest perceptual hash within `maxDistance` bits (Hamming distance).
   */
  async findSimilarAccepted(options: {
    excludeId: string;
    sha256: string;
    phash: bigint;
    maxDistance: number;
  }): Promise<SimilarImageMatch | null> {
    const exact = await this.db<ImageRecord>('images')
      .select('id')
      .where({ status: 'accepted', sha256: options.sha256 })
      .whereNot({ id: options.excludeId })
      .first();
    if (exact) return { id: exact.id, distance: 0, exact: true };

    const phash = toSignedInt64(options.phash);
    const near = await this.db('images')
      .select<{ id: string; distance: number }[]>(
        'id',
        this.db.raw('bit_count((phash # ?::bigint)::bit(64))::int AS distance', [phash]),
      )
      .where({ status: 'accepted' })
      .whereNot({ id: options.excludeId })
      .whereRaw('bit_count((phash # ?::bigint)::bit(64)) <= ?', [phash, options.maxDistance])
      .orderBy('distance')
      .first();
    return near ? { id: near.id, distance: near.distance, exact: false } : null;
  }

  /**
   * Stores the outcome and replaces any reasons from an earlier attempt.
   * Returns false if the image was deleted or already finalised meanwhile.
   */
  async completeProcessing(id: string, result: ProcessingResult): Promise<boolean> {
    const updated = await this.db('images')
      .where({ id, status: 'processing' })
      .update({
        status: result.status,
        width: result.width,
        height: result.height,
        phash: result.phash === null ? null : toSignedInt64(result.phash),
        blur_score: result.blurScore,
        face_count: result.faceCount,
        face_area_ratio: result.faceAreaRatio,
        similar_to_id: result.similarToId,
        thumbnail_key: result.thumbnailKey,
        converted_key: result.convertedKey,
        error_message: null,
        processed_at: this.db.fn.now(),
      });
    if (updated === 0) return false;

    await this.db('image_rejection_reasons').where({ image_id: id }).delete();
    if (result.reasons.length > 0) {
      await this.db('image_rejection_reasons').insert(
        result.reasons.map((reason) => ({
          image_id: id,
          code: reason.code,
          message: reason.message,
          details: reason.details ? JSON.stringify(reason.details) : null,
        })),
      );
    }
    return true;
  }

  async markFailed(id: string, message: string): Promise<boolean> {
    const updated = await this.db('images')
      .where({ id, status: 'processing' })
      .update({ status: 'failed', error_message: message, processed_at: this.db.fn.now() });
    return updated > 0;
  }

  /** One query for any number of images, avoiding N+1 lookups. */
  private async reasonsByImageId(imageIds: string[]): Promise<Map<string, RejectionReason[]>> {
    const byImage = new Map<string, RejectionReason[]>();
    if (imageIds.length === 0) return byImage;

    const rows = await this.db<ReasonRow>('image_rejection_reasons')
      .select('image_id', 'code', 'message', 'details')
      .whereIn('image_id', imageIds)
      .orderBy('id');

    for (const row of rows) {
      const reason: RejectionReason = { code: row.code, message: row.message };
      if (row.details) reason.details = row.details;
      const list = byImage.get(row.image_id) ?? [];
      list.push(reason);
      byImage.set(row.image_id, list);
    }
    return byImage;
  }
}

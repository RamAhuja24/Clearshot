import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '../config/env.js';

export interface PutOptions {
  contentType: string;
  cacheControl?: string;
}

export interface PresignOptions {
  expiresInSeconds: number;
  contentDisposition?: string;
}

/** The storage operations the app needs. Any S3-compatible backend can implement it. */
export interface ObjectStorage {
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(keys: string[]): Promise<void>;
  presignGet(key: string, options: PresignOptions): Promise<string>;
  ensureBucket(): Promise<void>;
  ping(): Promise<void>;
}

export function createS3Storage(config: S3Config): ObjectStorage {
  const baseClientConfig: S3ClientConfig = {
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Only send checksums when an operation requires them; several
    // S3-compatible stores reject the newer default checksum headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(config.accessKeyId &&
      config.secretAccessKey && {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
  };

  const client = new S3Client({ ...baseClientConfig, endpoint: config.endpoint });
  // Presigned URLs are opened by browsers, which may need a different host than
  // the server uses (for example inside Docker). Signing is local; no requests are made.
  const presignClient = config.publicEndpoint
    ? new S3Client({ ...baseClientConfig, endpoint: config.publicEndpoint })
    : client;
  const Bucket = config.bucket;

  return {
    async put(key, body, { contentType, cacheControl }) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          CacheControl: cacheControl,
        }),
      );
    },

    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!response.Body) throw new Error(`Object ${key} has no body`);
      return Buffer.from(await response.Body.transformToByteArray());
    },

    async delete(keys) {
      if (keys.length === 0) return;
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (response.Errors?.length) {
        const failed = response.Errors.map((e) => `${e.Key}: ${e.Code}`).join(', ');
        throw new Error(`Failed to delete objects: ${failed}`);
      }
    },

    async presignGet(key, { expiresInSeconds, contentDisposition }) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition,
      });
      return getSignedUrl(presignClient, command, { expiresIn: expiresInSeconds });
    },

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) {
          throw error;
        }
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },

    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
  };
}

import type { Knex } from 'knex';

// Enum values are frozen here on purpose: a migration must not change when
// application constants change later.
const IMAGE_FORMATS = ['jpeg', 'png', 'heic'];
const IMAGE_STATUSES = ['processing', 'accepted', 'rejected', 'failed'];
const REJECTION_CODES = [
  'FILE_TOO_SMALL',
  'RESOLUTION_TOO_LOW',
  'UNREADABLE_IMAGE',
  'BLURRY',
  'DUPLICATE',
  'TOO_SIMILAR',
  'NO_FACE',
  'MULTIPLE_FACES',
  'FACE_TOO_SMALL',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('images', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('original_filename', 255).notNullable();
    t.enu('format', IMAGE_FORMATS, { useNative: true, enumName: 'image_format' }).notNullable();
    t.string('mime_type', 64).notNullable();
    t.integer('size_bytes').notNullable().checkPositive();
    t.integer('width');
    t.integer('height');
    t.specificType('sha256', 'char(64)').notNullable();
    t.bigInteger('phash').comment('64-bit difference hash, compared by Hamming distance');
    t.enu('status', IMAGE_STATUSES, { useNative: true, enumName: 'image_status' })
      .notNullable()
      .defaultTo('processing');
    t.specificType('blur_score', 'real');
    t.smallint('face_count');
    t.specificType('face_area_ratio', 'real');
    t.uuid('similar_to_id').references('id').inTable('images').onDelete('SET NULL');
    t.text('original_key').notNullable();
    t.text('converted_key');
    t.text('thumbnail_key');
    t.text('error_message');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('processed_at', { useTz: true });
  });

  await knex.raw(`
    -- Keyset pagination of each gallery section, and of the unfiltered list.
    CREATE INDEX images_status_created_idx ON images (status, created_at DESC, id DESC);
    CREATE INDEX images_created_idx ON images (created_at DESC, id DESC);

    -- Duplicate and near-duplicate lookups only ever consider accepted images.
    -- INCLUDE (id) lets the Hamming-distance scan run as an index-only scan.
    CREATE INDEX images_accepted_phash_idx ON images (phash) INCLUDE (id) WHERE status = 'accepted';
    CREATE INDEX images_accepted_sha256_idx ON images (sha256) WHERE status = 'accepted';

    -- Supports ON DELETE SET NULL without a sequential scan.
    CREATE INDEX images_similar_to_idx ON images (similar_to_id) WHERE similar_to_id IS NOT NULL;

    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER images_set_updated_at
      BEFORE UPDATE ON images
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  await knex.schema.createTable('image_rejection_reasons', (t) => {
    t.bigIncrements('id');
    t.uuid('image_id').notNullable().references('id').inTable('images').onDelete('CASCADE');
    t.enu('code', REJECTION_CODES, { useNative: true, enumName: 'rejection_code' }).notNullable();
    t.text('message').notNullable();
    t.jsonb('details');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Also serves as the lookup index for image_id (leading column).
    t.unique(['image_id', 'code']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('image_rejection_reasons');
  await knex.schema.dropTableIfExists('images');
  await knex.raw(`
    DROP FUNCTION IF EXISTS set_updated_at();
    DROP TYPE IF EXISTS rejection_code;
    DROP TYPE IF EXISTS image_status;
    DROP TYPE IF EXISTS image_format;
  `);
}

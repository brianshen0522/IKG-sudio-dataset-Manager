/**
 * Phase 2 Migration: instances → datasets + jobs
 *
 * Run once inside the container after Phase 1 is deployed:
 *   docker exec <container> node scripts/migrate-to-datasets.js
 *
 * What it does:
 *   1. Reads all rows from the legacy `instances` table
 *   2. Looks up the system admin user (is_system_admin = true)
 *   3. Reads job_size from system_settings
 *   4. For each instance: creates a dataset record + auto-splits into jobs
 *   5. Reports any instances whose dataset_path no longer exists on disk
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff']);

function scanImageFilenames(datasetPath) {
  const imagesDir = path.join(datasetPath, 'images');
  if (!fs.existsSync(imagesDir)) return [];
  return fs
    .readdirSync(imagesDir)
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
}

function computeJobRanges(totalImages, jobSize) {
  const jobs = [];
  let idx = 1;
  for (let start = 1; start <= totalImages; start += jobSize) {
    jobs.push({ jobIndex: idx++, imageStart: start, imageEnd: Math.min(start + jobSize - 1, totalImages) });
  }
  return jobs;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // 1. Find system admin
    const adminRes = await client.query('SELECT id FROM users WHERE is_system_admin = true LIMIT 1');
    if (!adminRes.rows[0]) {
      console.error('ERROR: No system admin found. Run the app once to seed the admin user first.');
      process.exit(1);
    }
    const adminId = adminRes.rows[0].id;

    // 2. Read job_size
    const settingRes = await client.query("SELECT value FROM system_settings WHERE key = 'job_size'");
    const jobSize = parseInt(settingRes.rows[0]?.value || '500', 10);
    console.log(`Using job_size = ${jobSize}`);

    // 3. Read all legacy instances
    const instancesRes = await client.query('SELECT * FROM instances ORDER BY created_at ASC');
    const instances = instancesRes.rows;
    console.log(`Found ${instances.length} instance(s) to migrate.`);

    let migrated = 0;
    let skipped = 0;

    for (const inst of instances) {
      const normalizedPath = path.resolve(inst.dataset_path);
      console.log(`\n→ Migrating: ${inst.name} (${normalizedPath})`);

      // Check if path exists
      if (!fs.existsSync(normalizedPath)) {
        console.warn(`  SKIP: Path does not exist on disk — ${normalizedPath}`);
        skipped++;
        continue;
      }

      // Check if dataset already migrated
      const existsRes = await client.query('SELECT id FROM datasets WHERE dataset_path = $1', [normalizedPath]);
      if (existsRes.rows[0]) {
        console.log(`  SKIP: Already migrated (dataset id=${existsRes.rows[0].id})`);
        skipped++;
        continue;
      }

      const filenames = scanImageFilenames(normalizedPath);
      const totalImages = filenames.length;
      const jobRanges = computeJobRanges(totalImages, jobSize);
      console.log(`  Images: ${totalImages}, Jobs: ${jobRanges.length}`);

      await client.query('BEGIN');
      try {
        const dsRes = await client.query(
          `INSERT INTO datasets (
            dataset_path, display_name, created_by, total_images, job_size,
            threshold, debug, pentagon_format, obb_mode, class_file, duplicate_mode, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          RETURNING id`,
          [
            normalizedPath,
            inst.name,                          // use old instance name as display_name
            adminId,
            totalImages,
            jobSize,
            inst.threshold ?? 0.8,
            inst.debug ?? false,
            inst.pentagon_format ?? false,
            inst.obb_mode || 'rectangle',
            inst.class_file || null,
            inst.duplicate_mode || 'move',
            inst.created_at
          ]
        );
        const datasetId = dsRes.rows[0].id;

        for (const { jobIndex, imageStart, imageEnd } of jobRanges) {
          await client.query(
            `INSERT INTO jobs (dataset_id, job_index, image_start, image_end) VALUES ($1,$2,$3,$4)`,
            [datasetId, jobIndex, imageStart, imageEnd]
          );
        }

        await client.query('COMMIT');
        console.log(`  OK: dataset id=${datasetId}, ${jobRanges.length} jobs created`);
        migrated++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ERROR: ${err.message}`);
      }
    }

    console.log(`\n✓ Migration complete: ${migrated} migrated, ${skipped} skipped.`);
    console.log('  The legacy `instances` table has been left intact for reference.');
    console.log('  You may drop it manually once you are confident in the new schema.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

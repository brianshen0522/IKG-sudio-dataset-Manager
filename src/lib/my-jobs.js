import { getPool } from './db.js';

export async function getMyJobs(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       j.id,
       j.dataset_id    AS "datasetId",
       j.job_index     AS "jobIndex",
       j.image_start        AS "imageStart",
       j.image_end          AS "imageEnd",
       j.first_image_name   AS "firstImageName",
       j.last_image_name    AS "lastImageName",
       j.status,
       j.assigned_to        AS "assignedTo",
       d.dataset_path       AS "datasetPath",
       d.display_name       AS "datasetName",
       COALESCE(es.edited_count,  0) AS "editedFiles",
       COALESCE(di.deleted_count, 0) AS "deletedImages"
     FROM jobs j
     JOIN datasets d ON d.id = j.dataset_id
     LEFT JOIN (
       SELECT job_id,
              COUNT(*) FILTER (WHERE initial_hash IS NULL OR initial_hash != current_hash) AS edited_count
       FROM label_file_hashes
       GROUP BY job_id
     ) es ON es.job_id = j.id
     LEFT JOIN (
       SELECT job_id, COUNT(*) AS deleted_count
       FROM deleted_images
       GROUP BY job_id
     ) di ON di.job_id = j.id
     WHERE j.assigned_to = $1
     ORDER BY j.dataset_id, j.job_index`,
    [Number(userId)]
  );

  return rows;
}

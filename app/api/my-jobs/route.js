import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/my-jobs — returns all jobs assigned to the current user
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       j.id,
       j.dataset_id    AS "datasetId",
       j.job_index     AS "jobIndex",
       j.image_start   AS "imageStart",
       j.image_end     AS "imageEnd",
       j.status,
       j.assigned_to   AS "assignedTo",
       d.dataset_path  AS "datasetPath",
       d.display_name  AS "datasetName"
     FROM jobs j
     JOIN datasets d ON d.id = j.dataset_id
     WHERE j.assigned_to = $1
     ORDER BY j.dataset_id, j.job_index`,
    [Number(actor.sub)]
  );

  return NextResponse.json({ jobs: rows });
});

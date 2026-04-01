import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromRequest } from '@/lib/auth';
import { getMyJobs } from '@/lib/my-jobs';
import { annotateJobsWithImageCount } from '@/lib/dataset-utils';

export const dynamic = 'force-dynamic';

// GET /api/my-jobs — returns all jobs assigned to the current user
export const GET = withApiLogging(async function handler(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobs = await getMyJobs(actor.sub);

  // Annotate each job with the live image count by scanning the filesystem.
  // Group by datasetPath so each dataset directory is only read once.
  const byPath = new Map();
  for (const job of jobs) {
    if (!byPath.has(job.datasetPath)) byPath.set(job.datasetPath, []);
    byPath.get(job.datasetPath).push(job);
  }

  const annotated = [];
  for (const [datasetPath, group] of byPath) {
    try {
      const withCount = annotateJobsWithImageCount(datasetPath, group);
      annotated.push(...withCount);
    } catch {
      // If the dataset directory is unreadable, fall back to static range math.
      annotated.push(...group.map((j) => ({
        ...j,
        currentImageCount: j.imageEnd - j.imageStart + 1,
      })));
    }
  }

  // Restore original order (annotateJobsWithImageCount preserves per-group order).
  const orderMap = new Map(jobs.map((j, i) => [j.id, i]));
  annotated.sort((a, b) => orderMap.get(a.id) - orderMap.get(b.id));

  return NextResponse.json({ jobs: annotated });
});

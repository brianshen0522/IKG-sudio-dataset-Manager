import { getUserFromRequest } from '@/lib/auth';
import { getMyJobs } from '@/lib/my-jobs';
import { annotateJobsWithImageCount } from '@/lib/dataset-utils';
import { subscribeUserJobsUpdates } from '@/lib/live-update-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15000;

function formatSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req) {
  const actor = await getUserFromRequest(req);
  if (!actor) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const userId = Number(actor.sub);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastPayload = '';
      let pollTimer = null;
      let heartbeatTimer = null;
      let unsubscribe = null;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Ignore double-close races.
        }
      };

      const pushJobs = async () => {
        if (closed) return;
        try {
          const raw = await getMyJobs(userId);

          // Annotate with live image counts, grouping by dataset to minimise FS reads.
          const byPath = new Map();
          for (const job of raw) {
            if (!byPath.has(job.datasetPath)) byPath.set(job.datasetPath, []);
            byPath.get(job.datasetPath).push(job);
          }
          const annotated = [];
          for (const [datasetPath, group] of byPath) {
            try {
              annotated.push(...annotateJobsWithImageCount(datasetPath, group));
            } catch {
              annotated.push(...group.map((j) => ({ ...j, currentImageCount: j.imageEnd - j.imageStart + 1 })));
            }
          }
          const orderMap = new Map(raw.map((j, i) => [j.id, i]));
          annotated.sort((a, b) => orderMap.get(a.id) - orderMap.get(b.id));

          const jobs = annotated;
          const payload = JSON.stringify(jobs);
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(formatSse('jobs', { jobs })));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(formatSse('error', { message: err.message })));
        }
      };

      req.signal.addEventListener('abort', close);

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      await pushJobs();

      unsubscribe = subscribeUserJobsUpdates(userId, () => {
        pushJobs();
      });

      pollTimer = setInterval(pushJobs, POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }
      }, HEARTBEAT_INTERVAL_MS);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}

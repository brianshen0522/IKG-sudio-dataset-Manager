import { getUserFromRequest } from '@/lib/auth';
import { getAllDatasets, getJobsByDataset } from '@/lib/db-datasets';
import { subscribeDatasetsUpdates } from '@/lib/live-update-events';
import { isAdminOrDM } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15000;

function formatSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function getDatasetsPagePayload(actor) {
  const datasets = await getAllDatasets({ role: actor.role, userId: Number(actor.sub) });
  const jobsByDataset = {};

  await Promise.all(
    datasets.map(async (dataset) => {
      jobsByDataset[dataset.id] = await getJobsByDataset(dataset.id, {
        role: actor.role,
        userId: Number(actor.sub)
      });
    })
  );

  return { datasets, jobsByDataset };
}

export async function GET(req) {
  const actor = await getUserFromRequest(req);
  if (!isAdminOrDM(actor)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

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
        } catch {}
      };

      const pushPayload = async () => {
        if (closed) return;
        try {
          const payloadData = await getDatasetsPagePayload(actor);
          const payload = JSON.stringify(payloadData);
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(formatSse('datasets', payloadData)));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(formatSse('error', { message: err.message })));
        }
      };

      req.signal.addEventListener('abort', close);

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      await pushPayload();

      unsubscribe = subscribeDatasetsUpdates(() => {
        pushPayload();
      });

      pollTimer = setInterval(pushPayload, POLL_INTERVAL_MS);
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

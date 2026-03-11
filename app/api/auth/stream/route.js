import { getUserFromRequest } from '@/lib/auth';
import { onUserInvalidated } from '@/lib/auth-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const payload = await getUserFromRequest(req);
  if (!payload) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const userId = String(payload.sub);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Initial confirmation
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Listen for invalidation events for this user
      const unsubscribe = onUserInvalidated(userId, () => {
        try {
          controller.enqueue(encoder.encode('event: invalidate\ndata: {}\n\n'));
        } catch { /* client already disconnected */ }
        unsubscribe();
      });

      // Heartbeat every 30s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }
  });
}

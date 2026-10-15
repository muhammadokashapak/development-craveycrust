import { flags } from '../config/flags.js';

/**
 * Connected SSE clients set
 */
const sseClients = new Set();

/**
 * Register an incoming SSE client connection
 */
export function registerSseClient(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/Traefik proxies

    // Initial connection comment to establish stream
    res.write(': connected\n\n');

    const client = { req, res, id: Date.now() + Math.random().toString(36).substring(2, 7) };
    sseClients.add(client);

    // Heartbeat every 25 seconds to keep connection alive through reverse proxies
    const heartbeatTimer = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch (e) {
            clearInterval(heartbeatTimer);
        }
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeatTimer);
        sseClients.delete(client);
    });

    req.on('error', () => {
        clearInterval(heartbeatTimer);
        sseClients.delete(client);
    });
}

/**
 * Broadcast an order event to all connected dashboard SSE clients
 *
 * @param {string} event - 'order.created' | 'order.status_changed' | 'order.cancelled'
 * @param {Object} data - Clean payload without secrets
 */
export function broadcastOrderEvent(event, data) {
    // If REALTIME_DASHBOARD_ENABLED is disabled, do not broadcast
    const isEnabled = flags.REALTIME_DASHBOARD_ENABLED || process.env.REALTIME_DASHBOARD_ENABLED === 'true';
    if (!isEnabled && sseClients.size === 0) {
        return;
    }

    const payload = JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString(),
    });

    const message = `event: ${event}\ndata: ${payload}\n\n`;

    for (const client of sseClients) {
        try {
            client.res.write(message);
        } catch (err) {
            sseClients.delete(client);
        }
    }
}

/**
 * Count active connected SSE clients
 */
export function getConnectedClientCount() {
    return sseClients.size;
}

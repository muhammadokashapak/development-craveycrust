import { getDbClient } from '../db/client.js';

/**
 * Generate a concurrency-safe unique order number
 * Uses PostgreSQL SEQUENCE order_number_seq
 * Format: CC-000001, CC-000002
 *
 * @param {Object} [options]
 * @param {Object} [options.tx] Optional active Prisma transaction
 * @param {string} [options.prefix='CC']
 * @returns {Promise<string>}
 */
export async function generateOrderNumber(options = {}) {
    const client = options.tx || getDbClient();
    if (!client) {
        throw new Error('Database client not available');
    }

    const prefix = options.prefix || 'CC';

    try {
        // Concurrency-safe atomic counter from PostgreSQL SEQUENCE
        const result = await client.$queryRawUnsafe("SELECT nextval('order_number_seq') AS seq;");
        const seq = Number(result[0]?.seq);
        return `${prefix}-${String(seq).padStart(6, '0')}`;
    } catch (err) {
        // If sequence didn't exist, create it and retry
        try {
            await client.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;');
            const result = await client.$queryRawUnsafe("SELECT nextval('order_number_seq') AS seq;");
            const seq = Number(result[0]?.seq);
            return `${prefix}-${String(seq).padStart(6, '0')}`;
        } catch (innerErr) {
            throw new Error(`Failed to generate safe order number: ${innerErr.message}`);
        }
    }
}

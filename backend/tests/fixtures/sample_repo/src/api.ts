/**
 * api.ts — TypeScript API route handler.
 *
 * Tests: router role detection, TypeScript import extraction.
 */

import { formatResponse } from './utils';

interface Request {
    path: string;
    method: string;
    body?: Record<string, unknown>;
}

interface Response {
    status: number;
    data: unknown;
}

export function apiHandler() {
    return {
        get(path: string, handler: (req: Request) => Response) {
            console.log(`Registered GET ${path}`);
        },
        post(path: string, handler: (req: Request) => Response) {
            console.log(`Registered POST ${path}`);
        },
        listen(port: number, callback: () => void) {
            callback();
        },
    };
}

export function handleHealth(req: Request): Response {
    return { status: 200, data: formatResponse({ status: 'ok' }) };
}

/**
 * Webhook-to-stream bridge.
 *
 * When a gRPC streaming sync is active for a session, webhook calls for that
 * session are transparently routed to the gRPC stream instead of HTTP.
 *
 * This is the KEY innovation: zero changes to the queue worker or plugin code.
 * The existing WebhookService adapter in engine-services.ts checks this bridge
 * before falling through to HTTP delivery.
 */

import type { GrpcStreamNotifier } from './stream-notifier';

/** Active gRPC streams keyed by session ID. */
const activeStreams: Map<string, GrpcStreamNotifier> = new Map();

/** Register a gRPC stream notifier for a session. */
export function registerStreamForSession(sessionId: string, notifier: GrpcStreamNotifier): void {
  activeStreams.set(sessionId, notifier);
}

/** Unregister the gRPC stream for a session. */
export function unregisterStream(sessionId: string): void {
  activeStreams.delete(sessionId);
}

/** Get the active stream notifier for a session, if any. */
export function getStreamForSession(sessionId: string): GrpcStreamNotifier | undefined {
  return activeStreams.get(sessionId);
}

/** Check whether there is an active gRPC stream for a session. */
export function hasActiveStream(sessionId: string): boolean {
  return activeStreams.has(sessionId);
}

/** Get the count of currently active streams (useful for diagnostics). */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}

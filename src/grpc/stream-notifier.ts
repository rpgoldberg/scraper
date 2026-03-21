/**
 * GrpcStreamNotifier — adapts gRPC server-writable streams to emit SyncEvent messages.
 *
 * When a sync is initiated via the ExecuteFullSync or SyncFromCsv streaming RPCs,
 * a GrpcStreamNotifier is created for the session. The webhook bridge routes
 * webhook calls for that session through this notifier instead of HTTP,
 * transparently converting them into gRPC stream writes.
 */

import type * as grpc from '@grpc/grpc-js';
import type { SyncEvent } from './generated/figure_collector/v1/messages';

export class GrpcStreamNotifier {
  private ended = false;

  constructor(
    private call: grpc.ServerWritableStream<unknown, SyncEvent>,
    private sessionId: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Event writers
  // ---------------------------------------------------------------------------

  /** Write a phase change event to the stream. */
  notifyPhaseChange(
    phase: string,
    message?: string,
    items?: Array<{
      mfcId: string;
      name?: string;
      collectionStatus: string;
      isNsfw?: boolean;
      mfcActivityOrder?: number;
      isOrphan?: boolean;
    }>,
  ): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'phaseChange' as const,
        phaseChange: {
          phase,
          message: message ?? '',
          items: (items ?? []).map((item) => ({
            mfcId: item.mfcId,
            name: item.name ?? '',
            collectionStatus: item.collectionStatus,
            isNsfw: item.isNsfw ?? false,
            mfcActivityOrder: item.mfcActivityOrder ?? 0,
            isOrphan: item.isOrphan ?? false,
          })),
        },
      },
    });
  }

  /** Write an item-complete event to the stream. */
  notifyItemComplete(mfcId: string, data?: Record<string, unknown>): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'itemComplete' as const,
        itemComplete: {
          mfcId,
          data: data ?? undefined,
        },
      },
    });
  }

  /** Write an item-failed event to the stream. */
  notifyItemFailed(mfcId: string, error: string, retryable = false): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'itemFailed' as const,
        itemFailed: {
          mfcId,
          error,
          retryable,
        },
      },
    });
  }

  /** Write an item-skipped event to the stream. */
  notifyItemSkipped(mfcId: string, reason = ''): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'itemSkipped' as const,
        itemSkipped: {
          mfcId,
          reason,
        },
      },
    });
  }

  /** Write a lists-sync event to the stream. */
  notifyListsSync(
    lists: Array<{
      mfcId: number;
      name: string;
      teaser?: string;
      description?: string;
      privacy: string;
      iconUrl?: string;
      itemCount: number;
      itemMfcIds?: number[];
      itemDetails?: Array<{ mfcId: number; name?: string; imageUrl?: string }>;
      mfcCreatedAt?: string;
    }>,
  ): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'listsSync' as const,
        listsSync: {
          lists: lists.map((l) => ({
            mfcId: l.mfcId,
            name: l.name,
            teaser: l.teaser ?? '',
            description: l.description ?? '',
            privacy: l.privacy,
            iconUrl: l.iconUrl ?? '',
            itemCount: l.itemCount,
            itemMfcIds: l.itemMfcIds ?? [],
            itemDetails: (l.itemDetails ?? []).map((d) => ({
              mfcId: d.mfcId,
              name: d.name ?? '',
              imageUrl: d.imageUrl ?? '',
            })),
            mfcCreatedAt: l.mfcCreatedAt ?? '',
          })),
        },
      },
    });
  }

  /** Write a summary event to the stream. */
  notifySummary(summary: {
    totalItems: number;
    completed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  }): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'summary' as const,
        summary: {
          totalItems: summary.totalItems,
          completed: summary.completed,
          failed: summary.failed,
          skipped: summary.skipped,
          durationMs: summary.durationMs,
        },
      },
    });
  }

  /** Write an error event to the stream. */
  notifyError(code: string, message: string, retryable: boolean): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'error' as const,
        error: {
          code,
          message,
          retryable,
        },
      },
    });
  }

  /** Write a session-paused event to the stream. */
  notifySessionPaused(payload: {
    userId: string;
    reason: string;
    failureCount: number;
    failedMfcIds: string[];
    pendingCount: number;
    availableActions: string[];
  }): void {
    if (this.ended || this.call.cancelled) return;
    this.call.write({
      timestamp: new Date(),
      sessionId: this.sessionId,
      event: {
        $case: 'sessionPaused' as const,
        sessionPaused: {
          sessionId: this.sessionId,
          userId: payload.userId,
          reason: payload.reason,
          failureCount: payload.failureCount,
          failedMfcIds: payload.failedMfcIds,
          pendingCount: payload.pendingCount,
          availableActions: payload.availableActions,
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Mark stream as ended — no further writes will be made. */
  end(): void {
    this.ended = true;
  }

  /** Whether the stream has been ended by the server. */
  get isEnded(): boolean {
    return this.ended;
  }

  /** Whether the client has cancelled the stream. */
  get cancelled(): boolean {
    return this.call.cancelled;
  }
}

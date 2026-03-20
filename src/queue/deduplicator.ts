/**
 * Job Deduplicator
 *
 * Manages request deduplication with promise coalescing.  When multiple
 * callers request the same item, only one job is created — all callers
 * share the same result via their own Promise.
 *
 * Extracted from the pendingItems Map / resolvers array pattern in
 * scrapeQueue.ts.  Pure in-memory — dedup state is lost on restart
 * (Phase 1 limitation).
 */

export interface DeduplicationEntry {
  jobId: string;
  itemId: string;
  callbacks: Array<{
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>;
  userIds: Set<string>;
  priority: number;
  createdAt: number;
}

export class JobDeduplicator {
  private pending: Map<string, DeduplicationEntry> = new Map();

  // --------------------------------------------------------------------------
  // Public — dedup lifecycle
  // --------------------------------------------------------------------------

  /**
   * Try to deduplicate a request.
   *
   * If the item is already pending, the caller is added to the waiting list
   * and a coalesced promise is returned.
   *
   * If the item is new, returns `null` — the caller should create a new job
   * and then call {@link registerPending}.
   *
   * Mirrors the "existing item" branch of enqueue() in scrapeQueue.ts
   * (lines 375-411).
   */
  tryDeduplicate(
    itemId: string,
    userId?: string,
  ): { deduplicated: true; promise: Promise<unknown> } | null {
    const entry = this.pending.get(itemId);
    if (!entry) {
      return null;
    }

    // Add userId to waiting set (if not already present)
    if (userId) {
      entry.userIds.add(userId);
    }

    // Create a new promise for this caller
    const promise = new Promise<unknown>((resolve, reject) => {
      entry.callbacks.push({ resolve, reject });
    });
    // Prevent unhandled rejection crash when items are cancelled
    promise.catch(() => {});

    return { deduplicated: true, promise };
  }

  /**
   * Register a new pending item after its job has been created.
   *
   * Returns a promise that resolves/rejects when the item completes.
   *
   * Mirrors the "new item" branch of enqueue() in scrapeQueue.ts
   * (lines 414-467).
   */
  registerPending(
    itemId: string,
    jobId: string,
    userId?: string,
    priority: number = 5,
  ): Promise<unknown> {
    const entry: DeduplicationEntry = {
      jobId,
      itemId,
      callbacks: [],
      userIds: new Set(userId ? [userId] : []),
      priority,
      createdAt: Date.now(),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      entry.callbacks.push({ resolve, reject });
    });
    // Prevent unhandled rejection crash when items are cancelled
    promise.catch(() => {});

    this.pending.set(itemId, entry);
    return promise;
  }

  // --------------------------------------------------------------------------
  // Public — resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve all waiting callers for an item.
   *
   * Mirrors the resolve loop in handleSuccess() (line 928).
   */
  resolveItem(itemId: string, result: unknown): void {
    const entry = this.pending.get(itemId);
    if (!entry) return;

    this.pending.delete(itemId);
    entry.callbacks.forEach(({ resolve }) => resolve(result));
  }

  /**
   * Reject all waiting callers for an item.
   *
   * Mirrors the reject loop in handleFailure() (line 1020).
   */
  rejectItem(itemId: string, error: Error): void {
    const entry = this.pending.get(itemId);
    if (!entry) return;

    this.pending.delete(itemId);
    entry.callbacks.forEach(({ reject }) => reject(error));
  }

  // --------------------------------------------------------------------------
  // Public — query
  // --------------------------------------------------------------------------

  /** Check if an item is currently pending. */
  isPending(itemId: string): boolean {
    return this.pending.has(itemId);
  }

  /** Get the entry for an item (undefined if not pending). */
  getEntry(itemId: string): DeduplicationEntry | undefined {
    return this.pending.get(itemId);
  }

  /** Number of distinct pending items. */
  get size(): number {
    return this.pending.size;
  }

  /** Get all user IDs waiting for an item. */
  getWaitingUsers(itemId: string): string[] {
    const entry = this.pending.get(itemId);
    return entry ? [...entry.userIds] : [];
  }

  // --------------------------------------------------------------------------
  // Public — cancellation
  // --------------------------------------------------------------------------

  /**
   * Cancel a pending item — reject all waiting callers and remove it.
   *
   * Mirrors cancel() in scrapeQueue.ts (lines 533-548).
   */
  cancel(itemId: string): boolean {
    const entry = this.pending.get(itemId);
    if (!entry) return false;

    this.pending.delete(itemId);
    const cancelError = new Error('Request cancelled');
    entry.callbacks.forEach(({ reject }) => reject(cancelError));
    return true;
  }

  /**
   * Cancel all pending items that a given user is waiting for.
   *
   * Returns the number of items cancelled.
   *
   * Mirrors cancelAllForSession() in scrapeQueue.ts (lines 313-330).
   */
  cancelByUser(userId: string): number {
    let cancelled = 0;
    const cancelError = new Error('Request cancelled');

    // Collect IDs first to avoid mutating during iteration
    const toCancel: string[] = [];
    this.pending.forEach((entry, itemId) => {
      if (entry.userIds.has(userId)) {
        toCancel.push(itemId);
      }
    });

    for (const itemId of toCancel) {
      const entry = this.pending.get(itemId);
      if (entry) {
        this.pending.delete(itemId);
        entry.callbacks.forEach(({ reject }) => reject(cancelError));
        cancelled++;
      }
    }

    return cancelled;
  }

  // --------------------------------------------------------------------------
  // Public — priority management
  // --------------------------------------------------------------------------

  /**
   * Upgrade priority if new request has higher priority (lower number =
   * higher priority in BullMQ convention).
   *
   * Mirrors the priority upgrade path in enqueue() (lines 382-385).
   *
   * Returns true if the priority was upgraded.
   */
  upgradePriority(itemId: string, newPriority: number): boolean {
    const entry = this.pending.get(itemId);
    if (!entry) return false;

    // Lower number = higher priority (BullMQ convention)
    if (newPriority < entry.priority) {
      entry.priority = newPriority;
      return true;
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Public — bulk operations
  // --------------------------------------------------------------------------

  /**
   * Reject all pending items and clear the map.
   *
   * Mirrors clear() in scrapeQueue.ts (lines 553-574).
   */
  clear(): void {
    const cancelError = new Error('Queue cleared');
    this.pending.forEach((entry) => {
      entry.callbacks.forEach(({ reject }) => reject(cancelError));
    });
    this.pending.clear();
  }
}

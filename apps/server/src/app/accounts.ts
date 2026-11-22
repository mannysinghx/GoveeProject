import type { AccountContext } from './context.js';

/**
 * The loaded accounts, by user id. This is the one place a signed-in person is turned into
 * their account, so the risk of serving someone the wrong data is in one place to review.
 */
export class AccountRegistry {
  private readonly byUser = new Map<number, AccountContext>();

  add(account: AccountContext): void {
    if (this.byUser.has(account.userId)) throw new Error(`Account for user ${account.userId} is already loaded.`);
    this.byUser.set(account.userId, account);
  }

  forUser(userId: number): AccountContext | null {
    return this.byUser.get(userId) ?? null;
  }

  all(): AccountContext[] {
    return [...this.byUser.values()];
  }

  /**
   * The only account, for the few public routes that cannot yet tell which account a
   * request is for. It throws once there is more than one, so a second account cannot
   * silently be answered from the first one's data. Phase 4 of docs/public-signup-plan.md
   * replaces each caller with a lookup by token.
   */
  sole(): AccountContext {
    const accounts = this.all();
    if (accounts.length !== 1) throw new Error(`Expected exactly one account, found ${accounts.length}.`);
    return accounts[0]!;
  }

  /** Marks commands left in flight by a crash, before anything new is sent. */
  recoverInterrupted(): void {
    for (const account of this.all()) account.queue.recoverInterrupted();
  }

  /** Starts each account's background work, in the order the app always has. */
  startAll(): void {
    for (const account of this.all()) {
      account.scheduler.start();
      account.maintenance.start();
      account.connection.start();
      account.builtins.start();
      account.notifications.start();
    }
  }

  /**
   * First half of shutdown: background work that could start new requests. Accounts stop in
   * parallel, each in the original order, so many accounts still fit in the time limit.
   */
  async stopBackground(): Promise<void> {
    await Promise.all(
      this.all().map(async (account) => {
        account.maintenance.stop();
        await account.connection.stop();
        await account.builtins.stop();
        await account.notifications.stop();
        account.devices.stop();
      }),
    );
  }

  /** Second half, after the HTTP server has closed: queues, schedulers, then databases. */
  async stopCore(): Promise<void> {
    await Promise.all(
      this.all().map(async (account) => {
        await account.queue.stop();
        await account.scheduler.stop();
        account.db.close();
      }),
    );
  }
}

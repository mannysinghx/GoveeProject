import type { Logger } from 'pino';
import type { AccountContext } from './context.js';

/**
 * The loaded accounts, by user id. This is the one place a signed-in person is turned into
 * their account, so the risk of serving someone the wrong data is in one place to review.
 */
export class AccountRegistry {
  private readonly byUser = new Map<number, AccountContext>();
  private started = false;
  private stopping = false;

  constructor(
    /** Builds a member's account from the control database, or null if there is none to load. */
    private readonly loader: ((userId: number) => AccountContext | null) | null = null,
    private readonly logger: Logger | null = null,
  ) {}

  add(account: AccountContext): void {
    if (this.byUser.has(account.userId)) throw new Error(`Account for user ${account.userId} is already loaded.`);
    this.byUser.set(account.userId, account);
    if (this.started) {
      // Loaded after startup, such as a new sign-up: same steps as at startup, for this one.
      account.queue.recoverInterrupted();
      startAccount(account);
    }
  }

  forUser(userId: number): AccountContext | null {
    return this.byUser.get(userId) ?? null;
  }

  /**
   * The account, loading it first if it is not loaded yet: at startup, after a sign-up, or
   * when an earlier load failed. Null if it cannot be loaded; the failure is logged.
   */
  ensure(userId: number): AccountContext | null {
    const loaded = this.byUser.get(userId);
    if (loaded || !this.loader || this.stopping) return loaded ?? null;
    try {
      const account = this.loader(userId);
      if (!account) return null;
      this.add(account);
      return account;
    } catch (error) {
      this.logger?.error({ err: error, userId }, 'Could not load an account');
      return null;
    }
  }

  all(): AccountContext[] {
    return [...this.byUser.values()];
  }

  /**
   * Stops one account and closes its database, as shutdown does, and forgets it. Used when an
   * account is suspended or deleted. Its sign-in must already be stopped, or the next request
   * would load it again.
   */
  async unload(userId: number): Promise<void> {
    const account = this.byUser.get(userId);
    if (!account) return;
    this.byUser.delete(userId);
    account.maintenance.stop();
    await account.connection.stop();
    await account.builtins.stop();
    await account.notifications.stop();
    account.devices.stop();
    await account.queue.stop();
    await account.scheduler.stop();
    account.db.close();
    this.logger?.info({ userId }, 'Account unloaded');
  }

  /** Marks commands left in flight by a crash, before anything new is sent. */
  recoverInterrupted(): void {
    for (const account of this.all()) account.queue.recoverInterrupted();
  }

  /** Starts each account's background work, in the order the app always has. */
  startAll(): void {
    this.started = true;
    for (const account of this.all()) startAccount(account);
  }

  /**
   * First half of shutdown: background work that could start new requests. Accounts stop in
   * parallel, each in the original order, so many accounts still fit in the time limit.
   */
  async stopBackground(): Promise<void> {
    this.stopping = true;
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
    this.stopping = true;
    await Promise.all(
      this.all().map(async (account) => {
        await account.queue.stop();
        await account.scheduler.stop();
        account.db.close();
      }),
    );
  }
}

function startAccount(account: AccountContext): void {
  account.scheduler.start();
  account.maintenance.start();
  account.connection.start();
  account.builtins.start();
  account.notifications.start();
}

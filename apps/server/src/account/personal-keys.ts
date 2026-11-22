import { aiProviderIds, type AiProviderId } from '@glm/shared';
import type { Logger } from 'pino';
import type { AiProviderConfig } from '../config/env.js';
import type { CredentialStore } from '../security/credentials.js';
import type { SecretRegistry } from '../shared/logger.js';

interface Loaded {
  govee: string | null;
  ai: AiProviderConfig[];
}

/** How an AI key is stored: the key and the model chosen with it, encrypted together. */
export interface StoredAiKey {
  apiKey: string;
  model: string;
}

/**
 * Members' own keys, decrypted on first use and kept in memory until they change. Every key
 * read here is added to the scrubber, so it cannot reach a log line or an activity record.
 * The owner's Govee key and AI keys do not come from here.
 */
export class PersonalKeys {
  private readonly cache = new Map<number, Loaded>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly secrets: SecretRegistry,
    private readonly logger: Logger,
  ) {}

  govee(userId: number): string | null {
    return this.load(userId).govee;
  }

  ai(userId: number): AiProviderConfig[] {
    return this.load(userId).ai;
  }

  /** Call after a key is added, replaced or removed. */
  forget(userId: number): void {
    this.cache.delete(userId);
  }

  private load(userId: number): Loaded {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    const loaded: Loaded = { govee: null, ai: [] };
    for (const info of this.credentials.list(userId)) {
      const stored = this.credentials.get(userId, info.kind);
      if (!stored) continue;
      if ('error' in stored) {
        this.logger.error({ userId, kind: info.kind, problem: stored.error }, 'A stored key cannot be read');
        continue;
      }
      if (info.kind === 'govee') {
        this.secrets.add(stored.secret);
        loaded.govee = stored.secret;
        continue;
      }
      const provider = info.kind.slice('ai:'.length) as AiProviderId;
      if (!(aiProviderIds as readonly string[]).includes(provider)) continue;
      try {
        const parsed = JSON.parse(stored.secret) as StoredAiKey;
        if (typeof parsed.apiKey !== 'string' || typeof parsed.model !== 'string') throw new Error('bad shape');
        this.secrets.add(parsed.apiKey);
        loaded.ai.push({ id: provider, apiKey: parsed.apiKey, model: parsed.model });
      } catch {
        this.logger.error({ userId, kind: info.kind }, 'A stored AI key is not in the expected form');
      }
    }
    // The same order as the server's own providers.
    loaded.ai.sort((a, b) => aiProviderIds.indexOf(a.id) - aiProviderIds.indexOf(b.id));
    this.cache.set(userId, loaded);
    return loaded;
  }
}

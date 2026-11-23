import { describe, expect, it } from 'vitest';
import { AI_KEY_GUIDES, aiProviderIds } from '@glm/shared';
import { estimateCostUsd, knownPrice, modelsFor } from '../src/ai/providers.js';

/*
 * The sign-up page and Settings recommend a model and show its price from AI_KEY_GUIDES.
 * This keeps that in step with what the server lets a person pick and counts against
 * their monthly limit.
 */
describe('the AI key guide', () => {
  it('covers each provider once', () => {
    expect(AI_KEY_GUIDES.map((g) => g.provider).sort()).toEqual([...aiProviderIds].sort());
  });

  it('recommends only models a person can pick, at the price the server counts', () => {
    for (const guide of AI_KEY_GUIDES) {
      expect(modelsFor(guide.provider)).toContain(guide.recommendedModel);
      expect(knownPrice(guide.recommendedModel)).toBe(true);
      expect(estimateCostUsd(guide.recommendedModel, 1_000_000, 0)).toBeCloseTo(guide.price.input, 10);
      expect(estimateCostUsd(guide.recommendedModel, 0, 1_000_000)).toBeCloseTo(guide.price.output, 10);
    }
  });

  it('recommends the first model each provider offers, its cheapest reliable one, and lists the guides cheapest first', () => {
    const cost = (model: string) => estimateCostUsd(model, 1_000_000, 1_000_000);
    for (const guide of AI_KEY_GUIDES) {
      expect(modelsFor(guide.provider)[0]).toBe(guide.recommendedModel);
    }
    const order = AI_KEY_GUIDES.map((g) => cost(g.recommendedModel));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('never offers a model that is shutting down soon, or one new keys cannot use', () => {
    for (const retired of ['gpt-5-nano', 'gpt-5-mini', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'deepseek-v4-flash']) {
      for (const id of aiProviderIds) expect(modelsFor(id)).not.toContain(retired);
    }
    // A model saved with an older key is still priced, so its spend is counted at its real rate.
    expect(knownPrice('gemini-2.5-flash-lite')).toBe(true);
    expect(knownPrice('deepseek-v4-flash')).toBe(true);
  });

  it('sends people only to the provider\'s own site, over HTTPS', () => {
    const hosts: Record<string, string> = {
      glm: 'z.ai',
      gemini: 'aistudio.google.com',
      deepseek: 'platform.deepseek.com',
      openai: 'platform.openai.com',
      anthropic: 'platform.claude.com',
      meta: 'dev.meta.ai',
    };
    for (const guide of AI_KEY_GUIDES) {
      const url = new URL(guide.keyUrl);
      expect(url.protocol).toBe('https:');
      expect(url.host).toBe(hosts[guide.provider]);
    }
  });
});

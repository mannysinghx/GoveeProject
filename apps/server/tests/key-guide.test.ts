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

  it('recommends the lowest-cost model for each provider, and lists them cheapest first', () => {
    const cost = (model: string) => estimateCostUsd(model, 1_000_000, 1_000_000);
    for (const guide of AI_KEY_GUIDES) {
      const cheapest = Math.min(...modelsFor(guide.provider).map(cost));
      expect(cost(guide.recommendedModel)).toBe(cheapest);
    }
    const order = AI_KEY_GUIDES.map((g) => cost(g.recommendedModel));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('sends people only to the provider\'s own site, over HTTPS', () => {
    const hosts: Record<string, string> = { glm: 'z.ai', gemini: 'aistudio.google.com', deepseek: 'platform.deepseek.com' };
    for (const guide of AI_KEY_GUIDES) {
      const url = new URL(guide.keyUrl);
      expect(url.protocol).toBe('https:');
      expect(url.host).toBe(hosts[guide.provider]);
    }
  });
});

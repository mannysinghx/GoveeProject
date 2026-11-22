import { z } from 'zod';
import { aiProviderIds, type AiProviderId } from './ai.js';

/*
 * A person's own account: their Govee key, their AI keys, their data, and deleting it.
 * No response here ever carries a key, not even part of one.
 */

/* --------------------------------- Govee key --------------------------------- */

export interface GoveeKeyStatusDto {
  connected: boolean;
  /**
   * Where the key comes from. "server" is the owner's GOVEE_API_KEY, which the browser cannot
   * change. "account" is a key connected from the browser and stored encrypted.
   */
  source: 'server' | 'account' | null;
  /** When the key was connected from the browser. */
  connectedAt: string | null;
  /** False when the server cannot store keys (no CREDENTIAL_KEYS), or the key is set on the server. */
  canChange: boolean;
  /** Why it cannot be changed, in words for the page. */
  note: string | null;
}

/** Govee keys are UUID-like, but the format is not documented, so only the length and characters are checked. */
export const connectGoveeKeyRequestSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, 'That does not look like a Govee API key')
    .max(200)
    .regex(/^[A-Za-z0-9-]+$/, 'A Govee API key has only letters, numbers and dashes'),
});
export type ConnectGoveeKeyRequest = z.infer<typeof connectGoveeKeyRequestSchema>;

/* ---------------------------------- AI keys ---------------------------------- */

export interface PersonalAiKeyDto {
  provider: AiProviderId;
  label: string;
  model: string;
  connectedAt: string;
}

export interface PersonalAiDto {
  /** False for the owner, whose AI keys are set on the server. */
  canAddKeys: boolean;
  keys: PersonalAiKeyDto[];
  /** Models each provider may use, so prices are always known and counted against the cap. */
  models: Record<AiProviderId, string[]>;
  monthlyLimitUsd: number;
  monthlyLimitMaxUsd: number;
}

export const AI_PERSONAL_LIMIT_MAX_USD = 100;
export const AI_PERSONAL_LIMIT_DEFAULT_USD = 5;

export const aiProviderIdSchema = z.enum(aiProviderIds);

export const connectAiKeyRequestSchema = z.object({
  model: z.string().trim().min(1).max(80),
  apiKey: z
    .string()
    .trim()
    .min(8, 'That does not look like an API key')
    .max(300)
    // Printable ASCII with no spaces: what providers issue, and nothing that can break a header.
    .regex(/^[\x21-\x7e]+$/, 'An API key has no spaces or unusual characters'),
});
export type ConnectAiKeyRequest = z.infer<typeof connectAiKeyRequestSchema>;

export const aiLimitUpdateSchema = z.object({
  monthlyLimitUsd: z.number().min(0).max(AI_PERSONAL_LIMIT_MAX_USD),
});
export type AiLimitUpdate = z.infer<typeof aiLimitUpdateSchema>;

/* ---------------------------- export and delete ------------------------------ */

export const exportAccountRequestSchema = z.object({
  currentPassword: z.string().max(256),
});
export type ExportAccountRequest = z.infer<typeof exportAccountRequestSchema>;

/** The word typed to confirm deleting an account. */
export const DELETE_CONFIRMATION = 'DELETE';

export const deleteAccountRequestSchema = z.object({
  currentPassword: z.string().max(256),
  confirm: z.literal(DELETE_CONFIRMATION, { message: `Type ${DELETE_CONFIRMATION} to confirm` }),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/* ----------------------------------- admin ----------------------------------- */

export interface AdminAccountDto {
  id: number;
  email: string | null;
  role: 'owner' | 'member';
  status: 'active' | 'suspended';
  createdAt: string;
  lastSignInAt: string | null;
  goveeConnected: boolean;
  aiKeys: number;
  /** Lights in the account, or null if the account is not loaded. */
  devices: number | null;
}

export interface AdminAccountListDto {
  accounts: AdminAccountDto[];
}

export const adminAccountUpdateSchema = z.object({
  status: z.enum(['active', 'suspended']),
});
export type AdminAccountUpdate = z.infer<typeof adminAccountUpdateSchema>;

/* ------------------------------ where to get keys ------------------------------ */

export const GOVEE_KEY_HELP_URL = 'https://developer.govee.com/reference/apply-you-govee-api-key';

export interface AiKeyGuide {
  provider: AiProviderId;
  label: string;
  /** Where the person creates a key, on the provider's own site. */
  keyUrl: string;
  /** The lowest-cost model this app offers for that provider. */
  recommendedModel: string;
  /** Listed paid price in USD per million tokens; 0 when the provider lists it as free. */
  price: { input: number; output: number };
  /** One line on cost and data, shown under the steps. */
  note: string;
}

/**
 * Cheapest first. Prices are the providers' own listings, checked on 22 November 2026, and
 * match what the server counts against the monthly limit (apps/server/src/ai/providers.ts;
 * a server test fails if they drift apart). DeepSeek is shown at its peak rate, as counted.
 */
export const AI_KEY_GUIDES: readonly AiKeyGuide[] = [
  {
    provider: 'glm',
    label: 'Z.ai GLM',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    recommendedModel: 'glm-4.7-flash',
    price: { input: 0, output: 0 },
    note: 'Free on Z.ai. Data is processed in Singapore.',
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    recommendedModel: 'gemini-2.5-flash-lite',
    price: { input: 0.1, output: 0.4 },
    note: 'Has a free tier. On the free tier, Google may use what you send to improve its products.',
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    recommendedModel: 'deepseek-flash',
    price: { input: 0.3, output: 1.2 },
    note: 'Paid from a balance you top up, at half this price outside peak hours. Data is processed in China.',
  },
];

/* ---------------------------------- limits ----------------------------------- */

/** What one member's account may hold. The owner has no caps. */
export const MEMBER_LIMITS = {
  groups: 50,
  /** Presets the person made. Built-in presets do not count. */
  presets: 200,
  /** Schedules the person made. Built-in holiday shows do not count. */
  schedules: 200,
  /** Signed-in requests a minute. An open dashboard makes about 40. */
  requestsPerMinute: 300,
  /** Key checks an hour, Govee and AI together, so the form cannot be used to test stolen keys. */
  keyChecksPerHour: 5,
} as const;

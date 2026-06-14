/**
 * aiConfigController.ts
 *
 * Handles AI provider and model configuration for the platform.
 *
 * Routes:
 *   GET    /api/admin/ai/config              → get current config
 *   PATCH  /api/admin/ai/config              → update features / provider / overrides
 *   POST   /api/admin/ai/config/reset-usage  → reset usage stats
 *   GET    /api/admin/ai/providers           → list available providers + health
 *   GET    /api/admin/ai/providers/test      → test connection for a provider
 *   GET    /api/admin/ai/config/api-key/:provider → return decrypted key (one-time view)
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import AiConfig, { type IAiConfig, type AIProviderType } from '../models/AiConfig.js';
import { logAction } from './adminController.js';
import { invalidateProviderCache } from '../utils/ai/aiProvider.js';

// ─── GET /api/admin/ai/config ───────────────────────────────────────────────

// v1.69 — Phase 4: per-program AI config. The route reads
// `?batchId=...` (or the body's batchId on writes). When
// supplied, getAiConfig / updateAiConfig / resetAiUsage target
// the per-program override doc; when absent, they target the
// global default (the prior behaviour). The resolver chain in
// aiProvider.ts is the runtime source of truth.
function batchIdFromQueryOrBody(req: Request): string | null {
  const q = req.query.batchId;
  if (typeof q === 'string' && q.length > 0) return q;
  const b = (req.body as { batchId?: string } | undefined)?.batchId;
  if (typeof b === 'string' && b.length > 0) return b;
  return null;
}

function asObjectIdOrNull(id: string | null): Types.ObjectId | null {
  if (!id) return null;
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

export const getAiConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchIdRaw = batchIdFromQueryOrBody(req);
    const batchIdObjectId = asObjectIdOrNull(batchIdRaw);

    // v1.69 — Phase 4: when batchId is supplied, look for the
    // per-program override doc. If none exists, return a
    // placeholder 'no override for this program' response so the
    // admin UI can show the "no per-program override, falling
    // back to global" hint.
    let config = batchIdObjectId
      ? await AiConfig.findOne({ batchId: batchIdObjectId, isActive: true })
      : await AiConfig.findOne({ batchId: null, isActive: true });

    if (!config && !batchIdObjectId) {
      // Bootstrap the global default on first read (backwards
      // compat with the singleton setup).
      config = await AiConfig.create({
        activeProvider: 'anthropic',
        providers: {
          anthropic: { apiKeyCipher: '', baseURL: '', model: '' },
          openai:    { apiKeyCipher: '', baseURL: '', model: '' },
          xai:       { apiKeyCipher: '', baseURL: '', model: '' },
          minimax:   { apiKeyCipher: '', baseURL: '', model: '' },
          gemini:    { apiKeyCipher: '', baseURL: '', model: '' },
          custom:    { apiKeyCipher: '', baseURL: '', model: '' },
        },
        features: {
          duplicateDetection:  { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.1, maxTokens: 1024 },
          knowledgeExtraction: { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.2, maxTokens: 2048 },
          searchSummarization: { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.3, maxTokens: 512 },
          faqGeneration:       { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.4, maxTokens: 1024 },
        },
        usage: { totalRequests: 0, totalEstimatedCost: 0, lastResetAt: new Date() },
        isActive: true,
        batchId: null,
      });
    }

    const activeProvider = await detectActiveProvider();
    res.json({
      ...(config ? config.publicView() : { providers: {}, features: {} }),
      activeProvider,
      // The shape the admin UI needs to render the 'no per-program
      // override' state.
      ...(batchIdObjectId && !config ? { hasOverride: false, batchId: batchIdObjectId } : { hasOverride: !!config }),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── PATCH /api/admin/ai/config ─────────────────────────────────────────────

interface ProviderOverrideUpdate {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export const updateAiConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { activeProvider, features, providers } = req.body as {
      activeProvider?: AIProviderType;
      features?: IAiConfig['features'];
      providers?: Partial<Record<AIProviderType, ProviderOverrideUpdate>>;
    };

    // v1.69 — Phase 4: per-program override on writes. When
    // batchId is in the body, find or create the per-program
    // override doc (the partial unique index lets us create
    // without deactivating the global default). When absent,
    // target the global default as before.
    const batchIdRaw = batchIdFromQueryOrBody(req);
    const batchIdObjectId = asObjectIdOrNull(batchIdRaw);

    const filter = batchIdObjectId
      ? { batchId: batchIdObjectId, isActive: true }
      : { batchId: null, isActive: true };

    let config = await AiConfig.findOne(filter);
    if (!config) {
      // v1.69 — Phase 4: bootstrap a fresh per-program override
      // when one doesn't exist yet. The pre-save hook deactivates
      // any other active doc in the same (batchId) bucket, so
      // the global default stays untouched.
      config = await AiConfig.create({
        activeProvider: 'anthropic',
        providers: {
          anthropic: { apiKeyCipher: '', baseURL: '', model: '' },
          openai:    { apiKeyCipher: '', baseURL: '', model: '' },
          xai:       { apiKeyCipher: '', baseURL: '', model: '' },
          minimax:   { apiKeyCipher: '', baseURL: '', model: '' },
          gemini:    { apiKeyCipher: '', baseURL: '', model: '' },
          custom:    { apiKeyCipher: '', baseURL: '', model: '' },
        },
        features: {
          duplicateDetection:  { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.1, maxTokens: 1024 },
          knowledgeExtraction: { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.2, maxTokens: 2048 },
          searchSummarization: { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.3, maxTokens: 512 },
          faqGeneration:       { enabled: true, model: 'claude-sonnet-4-20250514', temperature: 0.4, maxTokens: 1024 },
        },
        usage: { totalRequests: 0, totalEstimatedCost: 0, lastResetAt: new Date() },
        isActive: true,
        batchId: batchIdObjectId,
      });
    }

    if (activeProvider !== undefined) config.activeProvider = activeProvider;
    if (features !== undefined) config.features = { ...config.features, ...features } as IAiConfig['features'];

    // v1.68 — H3 fix: build a flat $set with dot-notation
    // paths so the whole update is a single atomic write
    // instead of in-memory mutate + save().
    const setOps: Record<string, unknown> = {};
    if (providers && typeof providers === 'object') {
      for (const prov of ['anthropic', 'openai', 'xai', 'minimax', 'gemini', 'custom'] as AIProviderType[]) {
        const update = providers[prov];
        if (!update) continue;
        // apiKey uses the model's encrypt path (config.setApiKey)
        if (update.apiKey !== undefined) {
          // Use the model's setter so the cipher is applied
          // server-side, then read back the cipher to write.
          config.setApiKey(prov, update.apiKey);
          setOps[`providers.${prov}.apiKeyCipher`] = (config.providers as any)[prov]?.apiKeyCipher;
        }
        if (update.baseURL !== undefined) setOps[`providers.${prov}.baseURL`] = update.baseURL;
        if (update.model !== undefined)    setOps[`providers.${prov}.model`]    = update.model;
      }
    }
    for (const [k, v] of Object.entries(features ?? {})) {
      setOps[`features.${k}`] = v;
    }
    if (Object.keys(setOps).length > 0) {
      await AiConfig.findOneAndUpdate(
        { _id: config._id },
        { $set: setOps },
        { new: true },
      );
    }
    invalidateProviderCache();
    await logAction(
      (req as any).user?.id ?? 'system',
      'update_ai_config',
      config._id.toString(),
      'ai_config',
      JSON.stringify({ activeProvider, providersChanged: providers ? Object.keys(providers) : [], featuresChanged: features ? Object.keys(features) : [] })
    );

    res.json({ message: 'AI config updated.', config: config.publicView() });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/admin/ai/config/reset-usage ───────────────────────────────────

export const resetAiUsage = async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await AiConfig.findOne({ isActive: true });
    if (config) {
      // v1.68 — H3 fix: atomic reset via $set.
      await AiConfig.findOneAndUpdate(
        { _id: config._id },
        { $set: { usage: { totalRequests: 0, totalEstimatedCost: 0, lastResetAt: new Date() } } },
      );
    }
    await logAction((req as any).user?.id ?? 'system', 'reset_ai_usage', 'ai_config', 'ai_config', 'Usage statistics reset');
    res.json({ message: 'Usage statistics reset.' });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/admin/ai/providers ─────────────────────────────────────────────

export const getAiProviders = async (_req: Request, res: Response): Promise<void> => {
  type ProviderKey = AIProviderType;

  const config = await AiConfig.findOne({ isActive: true });
  const providerMeta: Record<ProviderKey, { label: string; defaultModel: string; hasKey: boolean; configuredModel: string }> = {
    anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-20250514', hasKey: false, configuredModel: 'claude-sonnet-4-20250514' },
    openai:    { label: 'OpenAI GPT',       defaultModel: 'gpt-4o-mini',              hasKey: false, configuredModel: 'gpt-4o-mini' },
    xai:       { label: 'xAI Grok',         defaultModel: 'grok-3',                    hasKey: false, configuredModel: 'grok-3' },
    minimax:   { label: 'MiniMax',          defaultModel: 'MiniMax-Text-01',           hasKey: false, configuredModel: 'MiniMax-Text-01' },
    gemini:    { label: 'Google Gemini',    defaultModel: 'gemini-1.5-flash',          hasKey: false, configuredModel: 'gemini-1.5-flash' },
    custom:    { label: 'Custom Provider',  defaultModel: 'custom-model',              hasKey: false, configuredModel: 'custom-model' },
  };

  for (const key of Object.keys(providerMeta) as ProviderKey[]) {
    const dbKey = config ? config.getApiKey(key) : null;
    const envKey = process.env[envKeyName(key)] ?? '';
    providerMeta[key].hasKey = !!(dbKey || envKey);
    if (config?.providers?.[key]?.model) {
      providerMeta[key].configuredModel = config.providers[key].model;
    } else {
      providerMeta[key].configuredModel = process.env[envModelName(key)] ?? providerMeta[key].defaultModel;
    }
  }

  const activeProvider = await detectActiveProvider();
  const providers = (Object.keys(providerMeta) as ProviderKey[]).map((key) => ({
    id: key,
    ...providerMeta[key],
    isActive: key === activeProvider,
  }));

  res.json({ providers, activeProvider });
};

// ─── GET /api/admin/ai/providers/test?provider=X ─────────────────────────────

export const testProvider = async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.query as { provider?: string };
  const validProviders: AIProviderType[] = ['anthropic', 'openai', 'xai', 'minimax', 'gemini', 'custom'];

  if (!provider || !validProviders.includes(provider as AIProviderType)) {
    res.status(400).json({ ok: false, message: 'Invalid provider' });
    return;
  }

  try {
    const { chatWithProvider } = await import('../utils/ai/aiProvider.js');
    await chatWithProvider(provider as AIProviderType, [{ role: 'user', content: 'ping' }]);
    res.json({ ok: true, message: 'Connection successful' });
  } catch (err: any) {
    res.json({ ok: false, message: err.message || 'Connection failed' });
  }
};

// ─── GET /api/admin/ai/config/api-key/:provider ──────────────────────────────

export const revealApiKey = async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  const validProviders: AIProviderType[] = ['anthropic', 'openai', 'xai', 'minimax', 'gemini', 'custom'];

  if (!validProviders.includes(provider as AIProviderType)) {
    res.status(400).json({ message: 'Invalid provider' });
    return;
  }

  const config = await AiConfig.findOne({ isActive: true });
  const key = config?.getApiKey(provider as AIProviderType) ?? null;

  await logAction(
    (req as any).user?.id ?? 'system',
    'reveal_ai_api_key',
    String(provider),
    'ai_config',
    `Reveal API key for ${provider} (hasKey=${!!key})`
  );

  res.json({ apiKey: key });
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function envKeyName(p: AIProviderType): string {
  return { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', xai: 'XAI_API_KEY', minimax: 'MINIMAX_API_KEY', gemini: 'GEMINI_API_KEY', custom: 'CUSTOM_API_KEY' }[p];
}
function envModelName(p: AIProviderType): string {
  return { anthropic: 'ANTHROPIC_MODEL', openai: 'OPENAI_MODEL', xai: 'XAI_MODEL', minimax: 'MINIMAX_MODEL', gemini: 'GEMINI_MODEL', custom: 'CUSTOM_MODEL' }[p];
}

/**
 * Determine the active provider: prefer DB-configured keys; fall back to env vars.
 * Priority: anthropic > openai > xai > minimax.
 */
export async function detectActiveProvider(): Promise<AIProviderType> {
  const config = await AiConfig.findOne({ isActive: true });
  const hasKey = (p: AIProviderType) => {
    const keyEnv = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', xai: 'XAI_API_KEY', minimax: 'MINIMAX_API_KEY', gemini: 'GEMINI_API_KEY', custom: 'CUSTOM_API_KEY' }[p];
    return !!((config && config.getApiKey(p)) || process.env[keyEnv]);
  };

  if (config) {
    const active = config.activeProvider;
    if (active && hasKey(active)) return active;

    if (hasKey('anthropic')) return 'anthropic';
    if (hasKey('openai'))    return 'openai';
    if (hasKey('xai'))       return 'xai';
    if (hasKey('minimax'))   return 'minimax';
    if (hasKey('gemini'))    return 'gemini';
    if (hasKey('custom'))    return 'custom';
  }
  if (hasKey('anthropic')) return 'anthropic';
  if (hasKey('openai'))    return 'openai';
  if (hasKey('xai'))       return 'xai';
  if (hasKey('minimax'))   return 'minimax';
  if (hasKey('gemini'))    return 'gemini';
  return 'custom';
}
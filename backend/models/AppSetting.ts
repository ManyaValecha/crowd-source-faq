/**
 * AppSetting — global app-level configuration values, admin-editable.
 *
 * v1.65 — Golden Ticket feature introduced the first such setting
 * (goldenCooldownHours). The model is intentionally generic so future
 * cross-cutting settings can register their own keys without needing
 * a new schema each time.
 *
 * Storage shape: a single document with id 'singleton'. The
 * `settings` field is a free-form map of { key: value } where value
 * is one of the types below. Validators on each key ensure admins
 * can't poison a number field with a string.
 *
 * Endpoints (see routes/appSettings.ts):
 *   GET /api/admin/settings  (admin only)
 *   PUT /api/admin/settings  (admin only, body: { key, value })
 *   GET /api/public/settings  (any authed user; returns only the
 *                             public-safe subset — used by the
 *                             frontend to display countdown copy)
 */

import mongoose, { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type SettingKey =
  | 'goldenCooldownHours'
  | 'goldenBanHours'
  | 'goldenPenaltyMultiplier';

export interface IAppSetting extends Document<string> {
  /** Always 'singleton' — there is only one settings document. */
  _id: 'singleton';
  /** Map of admin-configurable settings. Validated per-key below. */
  settings: {
    /** Hours a user must wait after a rejected Golden ticket before
     *  they can submit another. Default 48. Range 0-720. */
    goldenCooldownHours?: number;
    /** v1.65.1 — Hours a user is fully banned from Golden submissions
     *  after a rejected Golden ticket. Default 72. Range 0-720. The
     *  ban surfaces as a sticky 'you are banned' banner on the
     *  GoldenTicket page; the cooldown above is a separate, lighter
     *  mechanism (think: cooldown = 'wait a bit', ban = 'you broke
     *  the rules'). 0 disables the ban entirely (rejection still
     *  applies the SP penalty, just no time block). */
    goldenBanHours?: number;
    /** Multiplier applied to the SP cost when admin rejects a Golden
     *  ticket. 1.0 = full refund, 1.25 = user loses 25% more than they
     *  paid, 0 = no refund. Default 1.25. Range 0-5. */
    goldenPenaltyMultiplier?: number;
  };
  /** Last admin to edit. */
  updatedBy: Types.ObjectId | null;
  updatedAt: Date;
  createdAt: Date;
}

const appSettingSchema = new MongooseSchema<IAppSetting>(
  {
    _id: { type: String, default: 'singleton' },
    settings: {
      goldenCooldownHours: {
        type: Number,
        default: 48,
        min: 0,
        max: 720,
      },
      goldenBanHours: {
        type: Number,
        default: 72,
        min: 0,
        max: 720,
      },
      goldenPenaltyMultiplier: {
        type: Number,
        default: 1.25,
        min: 0,
        max: 5,
      },
    },
    updatedBy: { type: MongooseSchema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, _id: false }
);

/**
 * Read a single setting. Returns `defaultValue` if the document
 * doesn't exist yet (first boot, no admin has saved a value) or if
 * the key is unset on the document.
 *
 * Always seeds the singleton on read so the admin UI sees a value
 * even before anyone has explicitly saved.
 */
export async function readSetting<K extends SettingKey>(
  key: K,
  defaultValue: NonNullable<IAppSetting['settings'][K]>,
): Promise<NonNullable<IAppSetting['settings'][K]>> {
  const doc = await AppSetting.findById('singleton').lean();
  if (!doc) return defaultValue;
  const v = doc.settings?.[key];
  return (v ?? defaultValue) as NonNullable<IAppSetting['settings'][K]>;
}

const AppSetting = mongoose.model<IAppSetting>('AppSetting', appSettingSchema);
export default AppSetting;

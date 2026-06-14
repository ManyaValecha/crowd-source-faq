import { Request, Response } from 'express';
import { Types } from 'mongoose';
import User, { calculateTier } from '../models/User.js';
import ReputationLog from '../models/ReputationLog.js';
import Badge from '../models/Badge.js';
// v1.69 — Phase 7 prep: when the leaderboard is scoped to a
// program, the source of truth is the per-user-per-program
// ProgramReputation doc, not the global User.points field.
import ProgramReputation, { awardToUser } from '../models/ProgramReputation.js';
import { adminLog } from '../utils/http/logger.js';

// ─── Auto Badge Awarder ─────────────────────────────────────────────────────

export const autoAwardBadges = async (userId: string): Promise<void> => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    const allBadges = await Badge.find({ active: true, actionTrigger: 'auto' });

    // v1.68 — C2 fix: the previous code did
    //   const already = some(...); if (!already) push(...); user.save();
    // which is a check-then-act race. Two concurrent calls for
    // the same user could both pass the `some` check, both push,
    // and both save() — leaving the user with duplicate badges.
    // Fix: use atomic findOneAndUpdate with a `$ne` filter that
    // excludes users already having the badge. The operation
    // either succeeds (badge added) or no-ops (already had it).
    for (const badge of allBadges) {
      if (badge.pointsRequired === undefined || badge.pointsRequired === null) continue;
      if (user.points < badge.pointsRequired) continue;

      const list = badge.type === 'positive' ? 'positiveBadges' : 'negativeBadges';
      await User.findOneAndUpdate(
        { _id: userId, [`${list}.badgeId`]: { $ne: badge._id } },
        {
          $push: {
            [list]: {
              badgeId: badge._id,
              reason: `Auto-awarded: reached ${user.points} points`,
              awardedAt: new Date(),
            },
          },
        },
      );
    }
  } catch (err) {
    // Silently fail — badge award should never break main flows, but log warning
    adminLog.warn(`[reputation] autoAwardBadges failed for user ${userId}: ${(err as Error).message}`);
  }
};

// ─── Award / Deduct Points ───────────────────────────────────────────────

export const awardPoints = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || (req.user as any).role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  try {
    // v1.69 — Phase 7: admin award points is now batchId-scoped.
    // The body's batchId drives where the per-program write lands.
    // When null, only the User global aggregate is updated (admin
    // is awarding cross-program 'reputation' that doesn't belong
    // to any one program).
    const { userId, delta, reason, action, targetId, targetType, batchId: rawBatchId } = req.body as {
      userId?: string;
      delta?: number;
      reason?: string;
      action?: string;
      targetId?: string;
      targetType?: string;
      batchId?: string;
    };
    if (!userId || delta === undefined || !reason) {
      res.status(400).json({ message: 'userId, delta, and reason are required' });
      return;
    }
    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ message: 'Invalid userId.' });
      return;
    }

    const user = await User.findById(userId);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const prevPoints = user.points;
    const prevTier = user.tier;
    user.points = Math.max(0, user.points + delta);
    user.reputation = user.points; // reputation = points for now
    user.tier = calculateTier(user.points);

    await user.save();

    // v1.69 — Phase 7: per-program write when a program is
    // specified. Dual-write with the global User aggregate.
    const batchIdValid = rawBatchId && Types.ObjectId.isValid(rawBatchId)
      ? new Types.ObjectId(rawBatchId)
      : null;
    if (batchIdValid && delta !== 0) {
      await awardToUser(userId, batchIdValid, { points: delta })
        .catch((err) => adminLog.warn(`[reputation] awardToUser failed for ${userId}: ${(err as Error).message}`));
    }

    await ReputationLog.create({
      userId, delta, reason,
      action: action || (delta > 0 ? 'admin_point_award' : 'admin_point_deduct'),
      targetId, targetType,
      batchId: batchIdValid,
      awardedBy: (req as any).user?.id,
    });

    res.json({
      userId, points: user.points, reputation: user.reputation, tier: user.tier,
      prevPoints, prevTier, delta, batchId: batchIdValid,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', /* error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined */ });
  }
};

// ─── Get Reputation ───────────────────────────────────────────────────────

export const getUserReputation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('name email points reputation tier positiveBadges negativeBadges');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const logs = await ReputationLog.find({ userId }).sort({ createdAt: -1 }).limit(20);
    res.json({ user, logs });
  } catch (error) {
    res.status(500).json({ message: 'Server error', /* error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined */ });
  }
};

// ─── Issue Badge ────────────────────────────────────────────────────────

export const issueBadge = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || (req.user as any).role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  try {
    const { userId, badgeId, reason } = req.body;
    if (!userId || !badgeId) { res.status(400).json({ message: 'userId and badgeId required' }); return; }

    // Verify user + badge exist before doing the atomic write.
    // The atomic findOneAndUpdate below would no-op (return null)
    // both for "user not found" AND "user already has the badge",
    // so we disambiguate up front.
    const badge = await Badge.findById(badgeId);
    if (!badge) { res.status(404).json({ message: 'Badge not found' }); return; }
    const user = await User.findById(userId).select('_id');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const badgeList = badge.type === 'positive' ? 'positiveBadges' : 'negativeBadges';

    // v1.68 — C2 fix: the previous code did
    //   const already = some(...); if (!already) push(...); user.save();
    // Two concurrent admin actions could both pass the check
    // and both save() — leaving the user with duplicate badges.
    // Fix: atomic findOneAndUpdate with a `$ne` filter that
    // excludes users already having the badge.
    const updated = await User.findOneAndUpdate(
      { _id: userId, [`${badgeList}.badgeId`]: { $ne: badge._id } },
      {
        $push: {
          [badgeList]: {
            badgeId: badge._id,
            reason,
            awardedBy: (req as any).user?.id,
            awardedAt: new Date(),
          },
        },
      },
      { new: true, projection: { [badgeList]: 1 } },
    );
    if (!updated) {
      res.status(409).json({ message: 'Badge already awarded' });
      return;
    }

    if (badge.type === 'negative') {
      await ReputationLog.create({
        userId, delta: 0, reason: `Negative badge: ${badge.name}${reason ? ` — ${reason}` : ''}`,
        action: 'badge_awarded', // using awarded as proxy since action is negative badge
        targetId: badgeId, targetType: 'badge',
        awardedBy: (req as any).user?.id,
      });
    }

    res.json({ userId, badge: { name: badge.name, slug: badge.slug, type: badge.type }, badges: updated[badgeList] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', /* error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined */ });
  }
};

// ─── Revoke Badge ────────────────────────────────────────────────────────

export const revokeBadge = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || (req.user as any).role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  try {
    const { userId, badgeId } = req.body;
    if (!userId || !badgeId) { res.status(400).json({ message: 'userId and badgeId required' }); return; }

    const badge = await Badge.findById(badgeId);
    if (!badge) { res.status(404).json({ message: 'Badge not found' }); return; }

    const badgeList = badge.type === 'positive' ? 'positiveBadges' : 'negativeBadges';
    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { [badgeList]: { badgeId } } },
      { new: true }
    );
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    await ReputationLog.create({
      userId, delta: 0,
      reason: `Badge revoked: ${badge.name}`,
      action: 'badge_revoked',
      targetId: badgeId, targetType: 'badge',
      awardedBy: (req as any).user?.id,
    });

    res.json({ userId, badgeId, positiveBadges: user.positiveBadges, negativeBadges: user.negativeBadges });
  } catch (error) {
    res.status(500).json({ message: 'Server error', /* error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined */ });
  }
};

// ─── Leaderboard ───────────────────────────────────────────────────────

export const getLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '10')), 50);
    const period = String(req.query.period ?? 'all'); // 'weekly' | 'monthly' | 'all'
    // v1.69 — Phase 3i: per-program leaderboard. When ?batchId=
    // is supplied, switch from the global User.points/ReputationLog
    // to the per-user-per-program ProgramReputation doc. Time
    // windows collapse to 'all' inside the per-program branch
    // (we don't aggregate per-period from ProgramReputation yet —
    // Phase 7 will).
    const rawBatchId = req.query.batchId;
    const batchId = typeof rawBatchId === 'string' && Types.ObjectId.isValid(rawBatchId)
      ? new Types.ObjectId(rawBatchId)
      : null;
    if (batchId) {
      const perProgramRows = await ProgramReputation.find({ batchId })
        .sort({ points: -1 })
        .limit(limit)
        .populate('userId', 'name tier createdAt positiveBadges acceptedAnswers faqContributions')
        .lean();
      const rank = perProgramRows
        // v1.69 — Phase 3i: cast the populated userId to
        // { isDeleted, isBanned, name, ... } so tsc can read
        // the User fields after the .populate(). Without the
        // cast, tsc only sees the bare ObjectId.
        .filter((r) => {
          const u = r.userId as unknown as { isDeleted?: boolean; isBanned?: boolean } | null;
          return u && !u.isDeleted && !u.isBanned;
        })
        .map((r, i) => {
          const u = r.userId as { name?: string; tier?: string; createdAt?: Date; positiveBadges?: unknown[]; acceptedAnswers?: number; faqContributions?: number };
          return {
            rank: i + 1,
            userId: r.userId._id,
            name: u.name,
            points: r.points,
            sp: r.sp,
            tier: r.tier,
            badges: Array.isArray(u.positiveBadges) ? u.positiveBadges.length : 0,
            acceptedAnswers: u.acceptedAnswers ?? 0,
            faqContributions: u.faqContributions ?? 0,
            joinedAt: u.createdAt,
            scope: 'program' as const,
            batchId: r.batchId,
          };
        });
      res.json({ leaderboard: rank, total: rank.length, period: 'all', sort: 'points', scope: 'program' });
      return;
    }
    // v1.65 — Spurti Points leaderboard. `?sort=sp` re-ranks the same
    // eligible users by `sp` desc instead of by `points` desc. The
    // response shape stays the same so the frontend can render either
    // ranking from the same component. 'all' is the only period that
    // makes sense for SP (it's a lifetime wallet balance, not a
    // time-windowed action total) — passing a different `period`
    // alongside `sort=sp` is silently coerced to 'all' below.
    const sort = String(req.query.sort ?? '');

    // SP leaderboard (v1.65) — only meaningful for period='all' since SP
    // is a wallet balance, not a time-windowed action sum.
    if (sort === 'sp') {
      // v1.68 — L2: bound the result set (see above).
    // v1.68 — L2: bound the result set (see above).
    const users = await User.find({ isDeleted: false, isBanned: false })
      .sort({ points: -1, reputation: -1 })
      .limit(200)
      .sort({ sp: -1, reputation: -1 })
      .limit(200)
        .sort({ sp: -1, reputation: -1 })
        .limit(limit)
        .select('name sp reputation tier positiveBadges createdAt acceptedAnswers faqContributions');

      const rank = users.map((u, i) => ({
        rank: i + 1,
        userId: u._id,
        name: u.name,
        sp: u.sp ?? 0,
        reputation: u.reputation,
        tier: u.tier,
        badges: u.positiveBadges.length,
        acceptedAnswers: u.acceptedAnswers ?? 0,
        faqContributions: u.faqContributions ?? 0,
        joinedAt: u.createdAt,
      }));
      res.json({ leaderboard: rank, total: rank.length, period: 'all', sort: 'sp' });
      return;
    }

    // For weekly/monthly, aggregate from ReputationLog; for 'all', use User.points
    if (period === 'all') {
      // v1.68 — L2: bound the result set (see above).
    // v1.68 — L2: bound the result set (see above).
    const users = await User.find({ isDeleted: false, isBanned: false })
      .sort({ points: -1, reputation: -1 })
      .limit(200)
      .sort({ sp: -1, reputation: -1 })
      .limit(200)
        .sort({ points: -1, reputation: -1 })
        .limit(limit)
        .select('name points reputation tier positiveBadges createdAt acceptedAnswers faqContributions');

      const rank = users.map((u, i) => {
        const accountAgeDays = Math.max(0, (Date.now() - new Date(u.createdAt ?? Date.now()).getTime()) / 86400000);
        const trustScore = Math.min(100, Math.round(
          (accountAgeDays / 365) * 20 +
          (u.acceptedAnswers ?? 0) * 2 +
          (u.faqContributions ?? 0) * 3
        ));
        return {
          rank: i + 1,
          userId: u._id, name: u.name,
          points: u.points, reputation: u.reputation,
          tier: u.tier,
          badges: u.positiveBadges.length,
          acceptedAnswers: u.acceptedAnswers ?? 0,
          faqContributions: u.faqContributions ?? 0,
          trustScore,
          joinedAt: u.createdAt,
        };
      });
      res.json({ leaderboard: rank, total: rank.length, period });
      return;
    }

    // Time-filtered: aggregate from ReputationLog
    const now = new Date();
    const since = new Date(
      period === 'weekly'
        ? now.getTime() - 7 * 24 * 60 * 60 * 1000
        : now.getTime() - 30 * 24 * 60 * 60 * 1000
    );

    const ReputationLogModel = (await import('../models/ReputationLog.js')).default;
    const aggregation = await ReputationLogModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: '$userId',
        periodPoints: { $sum: '$delta' },
      }},
      { $sort: { periodPoints: -1 } },
      { $limit: limit },
    ]);

    const userIds = aggregation.map(a => a._id);
    // v1.68 — L2: bound the result set (see above).
    const users = await User.find({ _id: { $in: userIds }, isDeleted: false, isBanned: false })
      .sort({ points: -1, reputation: -1 })
      .limit(200)
      .select('name points reputation tier positiveBadges createdAt acceptedAnswers faqContributions');

    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    const leaderboard = aggregation
      .map((a, i) => {
        const user = userMap.get(a._id.toString());
        if (!user) return null;
        const accountAgeDays = Math.max(0, (Date.now() - new Date(user.createdAt ?? Date.now()).getTime()) / 86400000);
        const trustScore = Math.min(100, Math.round(
          (accountAgeDays / 365) * 20 +
          (user.acceptedAnswers ?? 0) * 2 +
          (user.faqContributions ?? 0) * 3
        ));
        return {
          rank: i + 1,
          userId: user._id,
          name: user.name,
          points: user.points,
          reputation: user.reputation,
          periodPoints: a.periodPoints,
          tier: user.tier,
          badges: user.positiveBadges.length,
          acceptedAnswers: user.acceptedAnswers ?? 0,
          faqContributions: user.faqContributions ?? 0,
          trustScore,
          joinedAt: user.createdAt,
        };
      })
      .filter(Boolean);

    res.json({ leaderboard, total: leaderboard.length, period });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── Auto-check Badges (called after point changes) ─────────────────────

export const autoCheckBadges = async (userId: string): Promise<void> => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    const allBadges = await Badge.find({ actionTrigger: 'auto', active: true });

    // v1.68 — C2 fix (same pattern as autoAwardBadges above).
    // Use atomic findOneAndUpdate with a `$ne` filter to avoid
    // duplicate badges under concurrent calls.
    for (const badge of allBadges) {
      if (!badge.pointsRequired) continue;
      if (user.points < badge.pointsRequired) continue;

      await User.findOneAndUpdate(
        { _id: userId, 'positiveBadges.badgeId': { $ne: badge._id } },
        {
          $push: {
            positiveBadges: {
              badgeId: badge._id,
              awardedAt: new Date(),
            },
          },
        },
      );
    }
  } catch (err) {
    adminLog.warn(`[reputation] autoCheckBadges failed for user ${userId}: ${(err as Error).message}`);
  }
};

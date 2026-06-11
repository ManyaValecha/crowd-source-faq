/**
 * supportFollowUpController.ts — Follow-up messages and status changes
 * for Session Support tickets.
 *
 * Routes (from routes/support.ts):
 *   POST  /api/support/requests/:id/follow-ups    (user/admin, rate-limited, gated by flag)
 *   PATCH /api/support/requests/:id/status        (admin, gated by flag)
 *
 * Each follow-up notification also goes to AdminLog via supportCore.
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import SupportRequest, {
  type ISupportFollowUp,
  type SupportStatus,
} from '../models/SupportRequest.js';
import { logger } from '../utils/http/logger.js';
import {
  VALID_STATUSES,
  getAuthedUserId,
  getAuthedUserRole,
  stripAdminOnlyFields,
  fanOutToAdmins,
  notifyUser,
  logAdminAction,
  requireFeatureOn,
} from './supportCore.js';

function asStringParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * POST /api/support/requests/:id/follow-ups
 * Add a follow-up message. Students can reply on their own tickets;
 * admins can reply on any. Gated by flag.
 */
export async function addSupportFollowUp(req: Request, res: Response): Promise<void> {
  if (!(await requireFeatureOn(req, res))) return;
  const userId = getAuthedUserId(req);
  if (!userId) { res.status(401).json({ message: 'Authentication required.' }); return; }

  const role = getAuthedUserRole(req);
  const isAdmin = role === 'admin' || role === 'moderator';

  const id = asStringParam(req.params.id);
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: 'Invalid request id.' });
    return;
  }

  const body = (req.body ?? {}) as {
    message?: string;
    documents?: { name?: string; url?: string; type?: string }[];
    requestProof?: boolean;
  };
  const message = String(body.message || '').trim();
  if (!message) {
    res.status(400).json({ message: 'Follow-up message cannot be empty.' });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ message: 'Follow-up message is too long.' });
    return;
  }

  const documents = Array.isArray(body.documents)
    ? body.documents
        .filter((d) => d && typeof d.url === 'string' && d.url)
        .map((d) => ({
          name: String(d.name || '').slice(0, 200),
          url:  String(d.url || '').slice(0, 1000),
          type: String(d.type || '').slice(0, 60),
        }))
        .slice(0, 4)
    : [];

  try {
    const request = await SupportRequest.findById(id);
    if (!request) {
      res.status(404).json({ message: 'Support request not found.' });
      return;
    }
    if (!isAdmin && request.userId.toString() !== userId.toString()) {
      res.status(404).json({ message: 'Support request not found.' });
      return;
    }

    const { default: User } = await import('../models/User.js');
    const sender = await User.findById(userId).select('name').lean();
    if (!sender) {
      res.status(401).json({ message: 'User not found.' });
      return;
    }

    const senderRole = isAdmin ? 'admin' : 'student';
    const requestProof = isAdmin && Boolean(body.requestProof);

    request.followUps.push({
      senderRole,
      senderId: userId,
      senderName: sender.name,
      message,
      requestProof,
      documents: documents as ISupportFollowUp['documents'],
      createdAt: new Date(),
    } as ISupportFollowUp);
    await request.save();

    // Notify the *other* side
    if (isAdmin) {
      await notifyUser(request.userId, {
        title: 'New reply on your support request',
        message: message.slice(0, 200),
        link: '/support/' + request._id.toString(),
        metadata: {
          supportRequestId: request._id.toString(),
          issueType: request.issueType,
          status: request.status,
          requestProof,
        },
      });
      await logAdminAction(userId, sender.name, 'support_follow_up', request._id, message.slice(0, 200));
    } else {
      await fanOutToAdmins({
        title: 'Student reply on support request',
        message: message.slice(0, 200),
        link: '/admin/support/' + request._id.toString(),
        metadata: {
          supportRequestId: request._id.toString(),
          issueType: request.issueType,
          status: request.status,
        },
      });
    }

    res.json({ request: stripAdminOnlyFields(request.toObject(), isAdmin) });
  } catch (err) {
    logger.error(`[support] addSupportFollowUp failed: ${(err as Error).message}`);
    res.status(500).json({ message: 'Failed to add follow-up.' });
  }
}

/**
 * PATCH /api/support/requests/:id/status
 * Admin-only. Change status, add notes, attach session access URL.
 * Gated by flag.
 */
export async function updateSupportStatus(req: Request, res: Response): Promise<void> {
  if (!(await requireFeatureOn(req, res))) return;
  const userId = getAuthedUserId(req);
  if (!userId) { res.status(401).json({ message: 'Authentication required.' }); return; }

  const id = asStringParam(req.params.id);
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: 'Invalid request id.' });
    return;
  }

  const body = (req.body ?? {}) as {
    status?: string;
    adminNote?: string;
    internalNote?: string;
    resolutionSummary?: string;
    sessionAccessUrl?: string;
    followUpMessage?: string;
    requestProof?: boolean;
  };
  const nextStatus = String(body.status || '').trim() as SupportStatus;
  if (!VALID_STATUSES.includes(nextStatus)) {
    res.status(400).json({ message: 'Invalid status value.' });
    return;
  }

  if (nextStatus === 'Rejected' && !String(body.adminNote || '').trim()) {
    res.status(400).json({ message: 'An admin note is required when rejecting a request.' });
    return;
  }

  const adminNote = String(body.adminNote || '').trim().slice(0, 2000);
  const internalNote = String(body.internalNote || '').trim().slice(0, 2000);
  const resolutionSummary = String(body.resolutionSummary || '').trim().slice(0, 2000);
  const sessionAccessUrl = String(body.sessionAccessUrl || '').trim().slice(0, 500);
  const followUpMessage = String(body.followUpMessage || '').trim().slice(0, 2000);
  const requestProof = Boolean(body.requestProof);

  try {
    const request = await SupportRequest.findById(id);
    if (!request) {
      res.status(404).json({ message: 'Support request not found.' });
      return;
    }
    if (request.status === nextStatus) {
      res.status(409).json({ message: `Request is already in status '${nextStatus}'.` });
      return;
    }

    const { default: User } = await import('../models/User.js');
    const admin = await User.findById(userId).select('name').lean();
    if (!admin) {
      res.status(401).json({ message: 'User not found.' });
      return;
    }

    // v1.65 — Golden Ticket rejection penalty. When an admin rejects a
    // Golden ticket, instead of refunding the SP the user spent, we
    // apply a configurable penalty (default 1.25x the SP they
    // invested — i.e. user loses 25% MORE than they paid). The
    // penalty is gated by the `goldenPenaltyMultiplier` setting.
    // Setting to 0 = no penalty (full refund). Setting to 1.0 = break-
    // even. Default 1.25. Cooldown duration is also configurable via
    // `goldenCooldownHours` (default 48). The penalty + cooldown
    // together replace the old "refund + 24h" behaviour.
    //
    // v1.65.1 — also stamp a 72h ban (configurable via
    // `goldenBanHours`) on the user. The ban is the loud, user-facing
    // punishment: it shows a sticky "you are banned" banner on the
    // GoldenTicket page and blocks all Golden submissions for the
    // ban duration. The cooldown is the quiet, server-side guard.
    // Both timers start on the same event (rejection) so they
    // decay together in practice; the ban simply lives longer.
    let goldenRejectionEndsAt: Date | null = null;
    let goldenBannedUntil: Date | null = null;
    let goldenPenaltySp = 0;
    if (nextStatus === 'Rejected' && request.isGolden) {
      const { readSetting } = await import('../models/AppSetting.js');
      const cooldownHours = await readSetting('goldenCooldownHours', 48);
      const banHours = await readSetting('goldenBanHours', 72);
      const penaltyMultiplier = await readSetting('goldenPenaltyMultiplier', 1.25);
      if (cooldownHours > 0) {
        goldenRejectionEndsAt = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);
      }
      if (banHours > 0) {
        goldenBannedUntil = new Date(Date.now() + banHours * 60 * 60 * 1000);
      }
      // Penalty is the spent SP times the multiplier. Ceiling the
      // result so a fractional SP penalty never becomes a positive
      // credit (e.g. 1.25 * 1 = 1.25 → 2 SP deducted). A multiplier
      // of 0 means "no penalty / full refund" (the user keeps their
      // investment if admin sets the policy to refund).
      if (penaltyMultiplier > 0) {
        goldenPenaltySp = Math.ceil((request.spCost ?? 0) * penaltyMultiplier);
      }
    }

    request.status = nextStatus;
    request.adminNote = adminNote || request.adminNote;
    if (goldenRejectionEndsAt) {
      request.goldenRejectionReason = adminNote || '';
      request.goldenRejectionEndsAt = goldenRejectionEndsAt;
    }
    if (internalNote) {
      request.internalNotes.push({
        note: internalNote,
        addedBy: userId,
        addedByName: admin.name,
        createdAt: new Date(),
      });
    }
    if (resolutionSummary) request.resolutionSummary = resolutionSummary;
    if (sessionAccessUrl) request.sessionAccessUrl = sessionAccessUrl;
    if (followUpMessage) {
      request.followUps.push({
        senderRole: 'admin',
        senderId: userId,
        senderName: admin.name,
        message: followUpMessage,
        requestProof,
        documents: [],
        createdAt: new Date(),
      } as ISupportFollowUp);
    }
    request.statusHistory.push({
      status: nextStatus,
      note: adminNote || resolutionSummary || `Status changed to ${nextStatus}.`,
      updatedBy: userId,
      updatedByName: admin.name,
      timestamp: new Date(),
    });
    request.updatedAt = new Date();
    await request.save();

    // v1.65 — Mirror the per-ticket Golden rejection cooldown onto
    // the user record, and apply the SP penalty (default 1.25x of the
    // SP the user spent). Both are gated by the configurable App
    // Settings — if the admin sets the penalty multiplier to 0 the
    // user gets a full refund; if the cooldown is 0 the user can
    // submit another ticket immediately. Non-Golden rejections leave
    // the user field untouched. Reuses the `User` import already in
    // scope.
    if (goldenRejectionEndsAt || goldenBannedUntil || goldenPenaltySp > 0) {
      const setOps: Record<string, unknown> = {};
      if (goldenRejectionEndsAt) setOps.lastGoldenRejectionAt = goldenRejectionEndsAt;
      if (goldenBannedUntil) setOps.goldenBannedUntil = goldenBannedUntil;
      if (goldenPenaltySp > 0) {
        // Deduct the penalty from the user's wallet. The helper
        // throws on insufficient balance (which is fine — the user
        // goes to 0, the audit log records the deduction up to their
        // available balance). We log + continue on failure so the
        // rejection status update is never blocked by wallet math.
        try {
          const { awardSpurtiPoints } = await import('../services/promotionService.js');
          // awardSpurtiPoints with negative amount = deduction.
          await awardSpurtiPoints(
            request.userId.toString(),
            -goldenPenaltySp,
            'sp_deducted',
            `Golden Ticket rejection penalty: ${goldenPenaltySp} SP (${request.spCost ?? 0} spent × penalty multiplier)`,
            userId,
          );
        } catch (penaltyErr) {
          logger.warn(
            `[support] Golden rejection penalty deduction failed: ${(penaltyErr as Error).message}`,
          );
        }
      }
      if (Object.keys(setOps).length > 0) {
        await User.updateOne({ _id: request.userId }, { $set: setOps });
      }
    }

    // Notify the student
    // v1.65: status enum extended with 'open' and 'closed'. The two new
    // states are reachable via admin transitions (Golden Ticket flow);
    // user-facing copy is added so the Record<SupportStatus, string>
    // typecheck still passes and notifications are never undefined.
    const titleByStatus: Record<SupportStatus, string> = {
      'Pending':   'Your support request was reopened',
      'In Review': 'Your support request is under review',
      'Resolved':  'Your support request was resolved',
      'Rejected':  'Your support request was rejected',
      'open':      'Your support request was opened by the support team',
      'closed':    'Your support request was closed',
    };
    const baseMsg = nextStatus === 'Resolved' && request.sessionAccessUrl
      ? 'Your request was approved and the recorded session is available now.'
      : nextStatus === 'Resolved'
      ? 'Your request was approved. The recorded session link will appear once shared by the admin team.'
      : nextStatus === 'Rejected'
      ? 'Your request was reviewed and marked rejected. Please check the admin note for details.'
      : 'Your request is being reviewed by the support team.';
    await notifyUser(request.userId, {
      title: titleByStatus[nextStatus],
      message: baseMsg,
      link: '/support/' + request._id.toString(),
      metadata: {
        supportRequestId: request._id.toString(),
        issueType: request.issueType,
        status: nextStatus,
        sessionAccessUrl: request.sessionAccessUrl || '',
      },
    });
    await logAdminAction(
      userId,
      admin.name,
      'support_status_change',
      request._id,
      `Status: ${nextStatus}${adminNote ? ` | Note: ${adminNote.slice(0, 100)}` : ''}`,
    );
    if (sessionAccessUrl) {
      await logAdminAction(
        userId,
        admin.name,
        'recorded_session_attached',
        request._id,
        `Recorded session URL attached on ${nextStatus}`,
      );
    }

    res.json({ request: stripAdminOnlyFields(request.toObject(), true) });
  } catch (err) {
    logger.error(`[support] updateSupportStatus failed: ${(err as Error).message}`);
    res.status(500).json({ message: 'Failed to update support request.' });
  }
}

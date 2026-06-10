import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getTroubleshootSteps,
  createSupportRequest,
  listSupportRequests,
  getSupportRequest,
  addSupportFollowUp,
  updateSupportStatus,
  listGuidance,
  updateGuidance,
  getSupportAnalytics,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  addField,
  updateField,
  archiveField,
} from '../controllers/supportController.js';
import { createIdentityLimiter } from '../utils/rateLimit.js';

const router = Router();

// Submission is the only path that needs throttling — it's the
// most-likely abuse vector. Read endpoints are cheap.
const submitLimiter = createIdentityLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyPrefix: 'rl_support_submit',
  message: 'You are submitting support requests too frequently. Please wait an hour.',
});

const replyLimiter = createIdentityLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  keyPrefix: 'rl_support_reply',
  message: 'You are replying too quickly. Please slow down.',
});

// ─── Public (gated by feature flag inside the controller) ──────────────────

// Auth: every endpoint requires a logged-in user. The feature flag
// check happens inside each handler so the 404 response shape is
// consistent.
router.use(protect);

// Issue-type guidance (no flag gate — admins need to see it even
// when the feature is off, for inspection).
router.get('/guidance',           authorize('admin', 'moderator'), listGuidance);
router.put('/guidance/:issueType', authorize('admin', 'moderator'), updateGuidance);

// Admin analytics (also un-gated, admin only).
router.get('/analytics', authorize('admin', 'moderator'), getSupportAnalytics);

// Troubleshoot checklist (gated by flag).
router.get('/troubleshoot/:issueType', getTroubleshootSteps);

// Requests (gated by flag).
router.post('/requests',                    submitLimiter, createSupportRequest);
router.get('/requests',                     listSupportRequests);
router.get('/requests/:id',                 getSupportRequest);
router.post('/requests/:id/follow-ups',     replyLimiter,   addSupportFollowUp);

// Status update (gated by flag, admin only).
router.patch('/requests/:id/status', authorize('admin', 'moderator'), updateSupportStatus);

// Category CRUD (admin only — not gated by the feature flag, admins
// should be able to inspect / edit categories even when the feature
// is off for users).
router.get('/categories',                          authorize('admin', 'moderator'), listCategories);
router.get('/categories/:issueType',              authorize('admin', 'moderator'), getCategory);
router.post('/categories',                         authorize('admin', 'moderator'), createCategory);
router.patch('/categories/:issueType',             authorize('admin', 'moderator'), updateCategory);
router.delete('/categories/:issueType',          authorize('admin', 'moderator'), deleteCategory);
router.post('/categories/:issueType/fields',      authorize('admin', 'moderator'), addField);
router.patch('/categories/:issueType/fields/:fieldKey', authorize('admin', 'moderator'), updateField);
router.delete('/categories/:issueType/fields/:fieldKey', authorize('admin', 'moderator'), archiveField);

export default router;

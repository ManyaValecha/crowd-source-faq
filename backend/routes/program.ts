import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect, authorize } from '../middleware/auth.js';
import { getProgramBySlug } from '../controllers/programController.js';

const router = Router();

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests.' },
});

// v1.69 — public program page. Returns the program data + the
// ProgramSettings (or defaults) so the page renders fully on one
// round-trip.
router.get('/:slug', publicLimiter, getProgramBySlug);

export default router;

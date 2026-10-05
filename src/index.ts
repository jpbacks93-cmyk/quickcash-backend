import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import loanRoutes from './routes/loans';
import guarantorRoutes from './routes/guarantors';
import kycRoutes from './routes/kyc';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import referralRoutes from './routes/referral';
import savingsRoutes from './routes/savings';
import { runPenaltyCheck } from './lib/penalty';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'jobacks-backend', time: new Date() });
});

// ─────────────────────────────────────────────
// Admin HTML
// ─────────────────────────────────────────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// ─────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/guarantors', guarantorRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/savings', savingsRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─────────────────────────────────────────────
// Auto penalty run — every hour
// Runs at :00 every hour. Idempotent, cheap.
// ─────────────────────────────────────────────
const ONE_HOUR_MS = 60 * 60 * 1000;

async function scheduledPenaltyRun() {
  try {
    console.log('[CRON] Starting scheduled penalty check...');
    const result = await runPenaltyCheck();
    console.log(
      `[CRON] Complete: ${result.processed} checked, ${result.updated} updated, ${result.defaulted} defaulted`
    );
  } catch (err) {
    console.error('[CRON] Penalty run failed:', err);
  }
}

// Run once 30 seconds after startup (give DB time to connect)
setTimeout(() => {
  console.log('[CRON] Initial penalty run starting...');
  scheduledPenaltyRun();
}, 30 * 1000);

// Then run every hour
setInterval(scheduledPenaltyRun, ONE_HOUR_MS);

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Jobacks server running at http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Admin:  http://localhost:${PORT}/admin`);
  console.log(`   Cron:   Penalty check every hour (starts in 30s)`);
});
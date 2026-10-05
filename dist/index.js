"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const user_1 = __importDefault(require("./routes/user"));
const loans_1 = __importDefault(require("./routes/loans"));
const guarantors_1 = __importDefault(require("./routes/guarantors"));
const kyc_1 = __importDefault(require("./routes/kyc"));
const admin_1 = __importDefault(require("./routes/admin"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const referral_1 = __importDefault(require("./routes/referral"));
const savings_1 = __importDefault(require("./routes/savings"));
const penalty_1 = require("./lib/penalty");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
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
    res.sendFile(path_1.default.join(__dirname, '..', 'public', 'admin.html'));
});
// ─────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────
app.use('/api/auth', auth_1.default);
app.use('/api/user', user_1.default);
app.use('/api/loans', loans_1.default);
app.use('/api/guarantors', guarantors_1.default);
app.use('/api/kyc', kyc_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/referral', referral_1.default);
app.use('/api/savings', savings_1.default);
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
        const result = await (0, penalty_1.runPenaltyCheck)();
        console.log(`[CRON] Complete: ${result.processed} checked, ${result.updated} updated, ${result.defaulted} defaulted`);
    }
    catch (err) {
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
//# sourceMappingURL=index.js.map
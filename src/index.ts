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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files (admin panel)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'quickcash-backend', time: new Date() });
});

// Admin HTML page
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/guarantors', guarantorRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin', adminRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Admin:  http://localhost:${PORT}/admin`);
});
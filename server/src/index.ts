
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import batchRoutes from './routes/batchRoutes';
import buyerRoutes from './routes/buyerRoutes';
import supplierRoutes from './routes/supplierRoutes';
import contractRoutes from './routes/contractRoutes';
import policyRoutes from './routes/policyRoutes';
import chatRoutes from './routes/chatRoutes';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without an origin (Postman, server-to-server, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', batchRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/policy', policyRoutes);
app.use('/api/chat', chatRoutes);

// Start server
async function start(): Promise<void> {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

const isMainScript =
  process.argv[1]?.replace(/\\/g, '/').endsWith('src/index.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('dist/index.js') ||
  process.env.AUTO_START === 'true';

if (isMainScript && process.env.NODE_ENV !== 'test') {
  start();
}

export { app, start };
export default app;

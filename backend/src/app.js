import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import lineRoutes from './routes/lines.js';
import machineRoutes from './routes/machines.js';
import reasonRoutes from './routes/reasons.js';
import downtimeRoutes from './routes/downtime.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import platformRoutes from './routes/platform.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export const app = express();
app.set('trust proxy', config.trustProxy);

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/lines', lineRoutes);
app.use('/api/machines', machineRoutes);
app.use('/api/reasons', reasonRoutes);
app.use('/api/downtime', downtimeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/platform', platformRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

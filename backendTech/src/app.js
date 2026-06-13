import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import authApi from './api/authApi.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://127.0.0.1:5173';

app.use(helmet());

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Recruiter AI backend is running',
  });
});

app.use('/api/auth', authApi);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.url}`,
  });
});


app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

export default app;

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');


const authRoutes = require('./routes/auth');
const storageRoutes = require('./routes/storage');

const app = express();

// Middleware
app.use(express.json());
app.use(helmet());
app.use(cors());

// Rate Limiter (example: 100 requests per 15 min per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/storage', storageRoutes);

app.get('/', (req, res) => res.send('Cloud Storage API is running!'));

module.exports = app;
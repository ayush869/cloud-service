import express from 'express';

const authApi = express.Router();

authApi.get('/testing', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Auth API is working',
  });
});

authApi.post('/register', (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Register API is not connected yet',
  });
});

authApi.post('/login', (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Login API is not connected yet',
  });
});

export default authApi;

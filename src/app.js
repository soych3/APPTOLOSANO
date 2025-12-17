const express = require('express');
const app = express();

app.use(express.json());

const { authMiddleware } = require('./middleware/auth.middleware');
const authRouter = require('./routes/auth.routes');
const usersRouter = require('./routes/users.routes');
const paymentsRouter = require('./routes/payments.routes');
const categoriesRouter = require('./routes/categories.routes');
const productsRouter = require('./routes/products.routes');
const ordersRouter = require('./routes/orders.routes');

// Rutas públicas (no requieren token)
app.use('/api/auth', authRouter);

// Rutas protegidas (requieren token)
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/payments', authMiddleware, paymentsRouter);
app.use('/api/categories', authMiddleware, categoriesRouter);
app.use('/api/products', authMiddleware, productsRouter);
app.use('/api/orders', authMiddleware, ordersRouter);

module.exports = app;
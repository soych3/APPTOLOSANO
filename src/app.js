const express = require('express');
const app = express();

app.use(express.json());

const usersRouter = require('./routes/users.routes');
app.use('/api/users', usersRouter);

module.exports = app;
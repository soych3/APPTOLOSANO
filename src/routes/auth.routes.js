const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth.middleware');

// ==================== REGISTRO ====================

// POST /api/auth/register -> Registrar nuevo admin
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Validación básica
    if (!username || !email || !password) {
      return res.status(400).json({ 
        message: 'username, email y password son obligatorios' 
      });
    }

    // Validar longitud de contraseña
    if (password.length < 6) {
      return res.status(400).json({ 
        message: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    // Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insertar en la base de datos
    const [result] = await pool.query(
      `INSERT INTO admins (username, email, password, role)
       VALUES (?, ?, ?, ?)`,
      [username, email, hashedPassword, role || 'user']
    );

    // Generar token
    const token = jwt.sign(
      { 
        id: result.insertId, 
        username, 
        email,
        role: role || 'user'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Usuario registrado correctamente',
      user: {
        id: result.insertId,
        username,
        email,
        role: role || 'user'
      },
      token
    });
  } catch (error) {
    console.error('Error en POST /api/auth/register:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('username')) {
        return res.status(400).json({ message: 'El nombre de usuario ya existe' });
      }
      if (error.sqlMessage.includes('email')) {
        return res.status(400).json({ message: 'El email ya está registrado' });
      }
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== LOGIN ====================

// POST /api/auth/login -> Iniciar sesión
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validación básica
    if (!email || !password) {
      return res.status(400).json({ 
        message: 'email y password son obligatorios' 
      });
    }

    // Buscar usuario por email
    const [users] = await pool.query(
      `SELECT * FROM admins WHERE email = ?`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const user = users[0];

    // Verificar si el usuario está activo
    if (user.status !== 'activo') {
      return res.status(401).json({ message: 'Usuario inactivo' });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Generar token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Actualizar último login
    await pool.query(
      `UPDATE admins SET last_login = NOW() WHERE id = ?`,
      [user.id]
    );

    res.json({
      message: 'Login exitoso',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      token
    });
  } catch (error) {
    console.error('Error en POST /api/auth/login:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== PERFIL ====================

// GET /api/auth/me -> Obtener perfil del usuario autenticado
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, username, email, role, status, created_at, last_login
       FROM admins WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(users[0]);
  } catch (error) {
    console.error('Error en GET /api/auth/me:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== CAMBIAR CONTRASEÑA ====================

// PATCH /api/auth/change-password -> Cambiar contraseña
router.patch('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ 
        message: 'current_password y new_password son obligatorios' 
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ 
        message: 'La nueva contraseña debe tener al menos 6 caracteres' 
      });
    }

    // Obtener usuario actual
    const [users] = await pool.query(
      `SELECT * FROM admins WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Verificar contraseña actual
    const validPassword = await bcrypt.compare(current_password, users[0].password);
    
    if (!validPassword) {
      return res.status(401).json({ message: 'Contraseña actual incorrecta' });
    }

    // Encriptar nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // Actualizar contraseña
    await pool.query(
      `UPDATE admins SET password = ? WHERE id = ?`,
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error en PATCH /api/auth/change-password:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


module.exports = router;

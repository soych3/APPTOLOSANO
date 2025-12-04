const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/users -> Lista de usuarios activos con detalles de categoría
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         u.id,
         u.first_name,
         u.last_name,
         u.dni,
         u.is_member,
         u.status,
         c.id   AS category_id,
         c.name AS category_name,
         c.division
       FROM users u
       JOIN categories c ON u.category_id = c.id
       WHERE u.status = 'activo'`
    );

    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// POST /api/users -> crear usuario nuevo
router.post('/', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      age,
      dni,
      address,
      phone,
      category_id,
      is_member
    } = req.body;

    // Validación básica
    if (!first_name || !last_name || !dni || !category_id) {
      return res.status(400).json({ message: 'first_name, last_name, dni y category_id son obligatorios' });
    }

    const [result] = await pool.query(
      `INSERT INTO users
       (first_name, last_name, email, age, dni,
        address, phone, category_id, status, is_member)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)`,
      [
        first_name,
        last_name,
        email || null,
        age || null,
        dni,
        address || null,
        phone || null,
        category_id,
        is_member ? 1 : 0
      ]
    );

    // Devolver el usuario creado (al menos su id)
    res.status(201).json({
      id: result.insertId,
      first_name,
      last_name,
      dni,
      category_id,
      is_member: !!is_member,
      status: 'activo'
    });
  } catch (error) {
    console.error('Error en POST /api/users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});



module.exports = router;

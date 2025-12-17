const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ==================== RUTAS GET ====================

// GET /api/categories -> Obtener todas las categorías
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         c.*,
         COUNT(u.id) AS total_users
       FROM categories c
       LEFT JOIN users u ON c.id = u.category_id
       GROUP BY c.id
       ORDER BY c.name`
    );

    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/categories:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/categories/:id -> Obtener una categoría por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT * FROM categories WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error en GET /api/categories/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/categories/:id/users -> Obtener usuarios de una categoría
router.get('/:id/users', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la categoría existe
    const [category] = await pool.query(
      `SELECT * FROM categories WHERE id = ?`,
      [id]
    );

    if (category.length === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }

    const [users] = await pool.query(
      `SELECT id, first_name, last_name, dni, email, is_member, status
       FROM users 
       WHERE category_id = ?
       ORDER BY last_name, first_name`,
      [id]
    );

    res.json({
      category: category[0],
      users
    });
  } catch (error) {
    console.error('Error en GET /api/categories/:id/users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS POST ====================

// POST /api/categories -> Crear una nueva categoría
router.post('/', async (req, res) => {
  try {
    const { name, amount_member, amount_non_member } = req.body;

    // Validación básica
    if (!name || amount_member === undefined || amount_non_member === undefined) {
      return res.status(400).json({ 
        message: 'name, amount_member y amount_non_member son obligatorios' 
      });
    }

    const [result] = await pool.query(
      `INSERT INTO categories (name, amount_member, amount_non_member)
       VALUES (?, ?, ?)`,
      [name, amount_member, amount_non_member]
    );

    res.status(201).json({
      id: result.insertId,
      name,
      amount_member,
      amount_non_member
    });
  } catch (error) {
    console.error('Error en POST /api/categories:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Ya existe una categoría con ese nombre' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PUT ====================

// PUT /api/categories/:id -> Actualizar una categoría
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, amount_member, amount_non_member } = req.body;

    // Validación básica
    if (!name || amount_member === undefined || amount_non_member === undefined) {
      return res.status(400).json({ 
        message: 'name, amount_member y amount_non_member son obligatorios' 
      });
    }

    const [result] = await pool.query(
      `UPDATE categories 
       SET name = ?, amount_member = ?, amount_non_member = ?
       WHERE id = ?`,
      [name, amount_member, amount_non_member, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }

    res.json({
      id: parseInt(id),
      name,
      amount_member,
      amount_non_member
    });
  } catch (error) {
    console.error('Error en PUT /api/categories/:id:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Ya existe una categoría con ese nombre' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PATCH ====================

// PATCH /api/categories/:id/prices -> Actualizar solo los precios
router.patch('/:id/prices', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_member, amount_non_member } = req.body;

    if (amount_member === undefined && amount_non_member === undefined) {
      return res.status(400).json({ 
        message: 'Debes proporcionar amount_member y/o amount_non_member' 
      });
    }

    // Construir query dinámicamente
    const updates = [];
    const values = [];

    if (amount_member !== undefined) {
      updates.push('amount_member = ?');
      values.push(amount_member);
    }
    if (amount_non_member !== undefined) {
      updates.push('amount_non_member = ?');
      values.push(amount_non_member);
    }

    values.push(id);

    const [result] = await pool.query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }

    // Obtener categoría actualizada
    const [updated] = await pool.query(
      `SELECT * FROM categories WHERE id = ?`,
      [id]
    );

    res.json(updated[0]);
  } catch (error) {
    console.error('Error en PATCH /api/categories/:id/prices:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS DELETE ====================

// DELETE /api/categories/:id -> Eliminar una categoría
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si hay usuarios en esta categoría
    const [users] = await pool.query(
      `SELECT COUNT(*) AS count FROM users WHERE category_id = ?`,
      [id]
    );

    if (users[0].count > 0) {
      return res.status(400).json({ 
        message: `No se puede eliminar. Hay ${users[0].count} usuario(s) en esta categoría.`,
        users_count: users[0].count
      });
    }

    const [result] = await pool.query(
      `DELETE FROM categories WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada' });
    }

    res.json({ 
      message: 'Categoría eliminada correctamente',
      id: parseInt(id)
    });
  } catch (error) {
    console.error('Error en DELETE /api/categories/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


module.exports = router;

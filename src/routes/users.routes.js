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


// GET /api/users/:id/is-enabled -> Verificar si un socio está habilitado (al día)
router.get('/:id/is-enabled', async (req, res) => {
  try {
    const { id } = req.params;
    const { max_debt_months } = req.query; // Máximo de meses de deuda permitidos (default: 2)
    
    const maxMonths = parseInt(max_debt_months) || 2;

    // Obtener info del usuario
    const [users] = await pool.query(
      `SELECT 
         u.id, u.first_name, u.last_name, u.dni, u.is_member, u.status,
         c.name AS category_name
       FROM users u
       JOIN categories c ON u.category_id = c.id
       WHERE u.id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const user = users[0];

    // Verificar si el usuario está activo
    if (user.status !== 'activo') {
      return res.json({
        user_id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        is_enabled: false,
        reason: 'Usuario inactivo',
        status: user.status
      });
    }

    // Contar meses con deuda
    const [debtInfo] = await pool.query(
      `SELECT 
         COUNT(*) AS pending_months,
         COALESCE(SUM(balance), 0) AS total_debt
       FROM payments
       WHERE user_id = ? AND status IN ('pendiente', 'parcial', 'vencido')`,
      [id]
    );

    const pendingMonths = debtInfo[0].pending_months || 0;
    const totalDebt = Number(debtInfo[0].total_debt) || 0;
    const isEnabled = pendingMonths <= maxMonths;

    // Obtener detalle de cuotas pendientes
    const [pendingPayments] = await pool.query(
      `SELECT period_month, period_year, balance, status
       FROM payments
       WHERE user_id = ? AND status IN ('pendiente', 'parcial', 'vencido')
       ORDER BY period_year ASC, period_month ASC`,
      [id]
    );

    res.json({
      user_id: user.id,
      name: `${user.first_name} ${user.last_name}`,
      dni: user.dni,
      is_member: !!user.is_member,
      category: user.category_name,
      is_enabled: isEnabled,
      reason: isEnabled 
        ? (pendingMonths === 0 ? 'Sin deuda' : `Deuda dentro del límite (${pendingMonths}/${maxMonths} meses)`)
        : `Deuda excede el límite permitido (${pendingMonths} meses, máximo ${maxMonths})`,
      debt_summary: {
        pending_months: pendingMonths,
        total_debt: totalDebt,
        max_allowed_months: maxMonths
      },
      pending_payments: pendingPayments
    });
  } catch (error) {
    console.error('Error en GET /api/users/:id/is-enabled:', error);
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

    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('users.email')) {
        return res.status(400).json({ message: 'El email ya está registrado' });
      }
      if (error.sqlMessage.includes('users.dni')) {
        return res.status(400).json({ message: 'El DNI ya está registrado' });
      }
      return res.status(400).json({ message: 'Dato duplicado' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});



// PUT /api/users/:id -> actualizar datos del usuario (incluye status)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      age,
      dni,
      address,
      phone,
      category_id,
      is_member,
      status
    } = req.body;

    if (!first_name || !last_name || !dni || !category_id || !status) {
      return res.status(400).json({
        message: 'first_name, last_name, dni, category_id y status son obligatorios'
      });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET first_name = ?, last_name = ?, email = ?, age = ?, dni = ?,
           address = ?, phone = ?, category_id = ?, is_member = ?, status = ?
       WHERE id = ?`,
      [
        first_name,
        last_name,
        email || null,
        age || null,
        dni,
        address || null,
        phone || null,
        category_id,
        is_member ? 1 : 0,
        status,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({
      id: Number(id),
      first_name,
      last_name,
      dni,
      category_id,
      is_member: !!is_member,
      status
    });
  } catch (error) {
    console.error('Error en PUT /api/users/:id:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('users.email')) {
        return res.status(400).json({ message: 'El email ya está registrado' });
      }
      if (error.sqlMessage.includes('users.dni')) {
        return res.status(400).json({ message: 'El DNI ya está registrado' });
      }
      return res.status(400).json({ message: 'Dato duplicado' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});


// PATCH /api/users/:id/status -> cambiar solo el estado
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'activo' o 'inactivo'

    if (!['activo', 'inactivo'].includes(status)) {
      return res.status(400).json({ message: "status debe ser 'activo' o 'inactivo'" });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET status = ?
       WHERE id = ?`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ id: Number(id), status });
  } catch (error) {
    console.error('Error en PATCH /api/users/:id/status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/users/:id/membership -> cambiar solo la membresía
router.patch('/:id/membership', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_member } = req.body; // true o false

    if (typeof is_member !== 'boolean') {
      return res.status(400).json({ message: 'is_member debe ser true o false' });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET is_member = ?
       WHERE id = ?`,
      [is_member ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ id: Number(id), is_member });
  } catch (error) {
    console.error('Error en PATCH /api/users/:id/membership:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// DELETE /api/users/:id -> eliminar usuario
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `DELETE FROM users WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ message: 'Usuario eliminado correctamente', id: Number(id) });
  } catch (error) {
    console.error('Error en DELETE /api/users/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


module.exports = router;

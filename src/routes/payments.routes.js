const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ==================== FUNCIONES AUXILIARES ====================

// Calcular el monto según categoría y membresía del usuario
async function calculateAmountDue(userId) {
  const [rows] = await pool.query(
    `SELECT 
       u.is_member,
       c.amount_member,
       c.amount_non_member
     FROM users u
     JOIN categories c ON u.category_id = c.id
     WHERE u.id = ?`,
    [userId]
  );

  if (rows.length === 0) {
    return null;
  }

  const user = rows[0];
  return user.is_member ? user.amount_member : user.amount_non_member;
}

// Determinar el tipo de pago (50% = pago mínimo)
function getPaymentType(amountPaid, amountDue, minimumPercent = 0.5) {
  if (amountPaid === 0) return 'sin_pago';
  if (amountPaid >= amountDue) return 'completo';
  if (amountPaid >= amountDue * minimumPercent) return 'minimo';
  return 'parcial';
}

// Determinar el estado del pago
function getPaymentStatus(amountPaid, amountDue, dueDate) {
  const today = new Date();
  const due = new Date(dueDate);
  
  if (amountPaid >= amountDue) return 'pagado';
  if (amountPaid > 0 && amountPaid < amountDue) return 'parcial';
  if (today > due) return 'vencido';
  return 'pendiente';
}


// ==================== RUTAS GET ====================

// GET /api/payments -> Lista de todos los pagos con filtros opcionales
router.get('/', async (req, res) => {
  try {
    const { status, month, year, user_id } = req.query;
    
    let query = `
      SELECT 
        p.id,
        p.user_id,
        u.first_name,
        u.last_name,
        u.dni,
        u.is_member,
        c.name AS category_name,
        p.period_month,
        p.period_year,
        p.amount_due,
        p.amount_paid,
        p.balance,
        p.payment_type,
        p.payment_method,
        p.payment_date,
        p.due_date,
        p.status,
        p.notes,
        p.created_at
      FROM payments p
      JOIN users u ON p.user_id = u.id
      JOIN categories c ON u.category_id = c.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (status) {
      query += ` AND p.status = ?`;
      params.push(status);
    }
    if (month) {
      query += ` AND p.period_month = ?`;
      params.push(month);
    }
    if (year) {
      query += ` AND p.period_year = ?`;
      params.push(year);
    }
    if (user_id) {
      query += ` AND p.user_id = ?`;
      params.push(user_id);
    }
    
    query += ` ORDER BY p.period_year DESC, p.period_month DESC, u.last_name ASC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/payments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/payments/debtors -> Listar socios con cuotas vencidas o pendientes
router.get('/debtors', async (req, res) => {
  try {
    const { min_debt, max_months, status } = req.query;

    let query = `
      SELECT 
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.dni,
        u.email,
        u.phone,
        u.is_member,
        c.name AS category_name,
        COUNT(p.id) AS pending_months,
        SUM(p.balance) AS total_debt,
        MIN(CONCAT(p.period_year, '-', LPAD(p.period_month, 2, '0'))) AS oldest_debt_period,
        MAX(CONCAT(p.period_year, '-', LPAD(p.period_month, 2, '0'))) AS newest_debt_period
      FROM users u
      JOIN categories c ON u.category_id = c.id
      JOIN payments p ON u.id = p.user_id
      WHERE p.status IN ('pendiente', 'parcial', 'vencido')
        AND u.status = 'activo'
    `;

    const params = [];

    // Filtrar por estado específico
    if (status && ['pendiente', 'parcial', 'vencido'].includes(status)) {
      query = query.replace(
        "p.status IN ('pendiente', 'parcial', 'vencido')",
        "p.status = ?"
      );
      params.push(status);
    }

    query += ` GROUP BY u.id, u.first_name, u.last_name, u.dni, u.email, u.phone, u.is_member, c.name`;

    // Filtrar por deuda mínima
    if (min_debt) {
      query += ` HAVING total_debt >= ?`;
      params.push(min_debt);
    }

    // Filtrar por máximo de meses adeudados
    if (max_months) {
      query += min_debt ? ` AND pending_months >= ?` : ` HAVING pending_months >= ?`;
      params.push(max_months);
    }

    query += ` ORDER BY total_debt DESC, pending_months DESC`;

    const [rows] = await pool.query(query, params);

    // Resumen general
    const totalDebtors = rows.length;
    const totalDebt = rows.reduce((sum, r) => sum + Number(r.total_debt), 0);

    res.json({
      summary: {
        total_debtors: totalDebtors,
        total_debt: totalDebt
      },
      debtors: rows
    });
  } catch (error) {
    console.error('Error en GET /api/payments/debtors:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/payments/summary/monthly -> Resumen de pagos del mes
router.get('/summary/monthly', async (req, res) => {
  try {
    const { month, year } = req.query;
    
    const currentDate = new Date();
    const targetMonth = month || currentDate.getMonth() + 1;
    const targetYear = year || currentDate.getFullYear();

    const [summary] = await pool.query(
      `SELECT 
         COUNT(*) AS total_payments,
         SUM(CASE WHEN status = 'pagado' THEN 1 ELSE 0 END) AS paid_count,
         SUM(CASE WHEN status = 'parcial' THEN 1 ELSE 0 END) AS partial_count,
         SUM(CASE WHEN status = 'pendiente' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN status = 'vencido' THEN 1 ELSE 0 END) AS overdue_count,
         SUM(amount_due) AS total_expected,
         SUM(amount_paid) AS total_collected,
         SUM(balance) AS total_pending
       FROM payments
       WHERE period_month = ? AND period_year = ?`,
      [targetMonth, targetYear]
    );

    res.json({
      period: `${targetMonth}/${targetYear}`,
      ...summary[0]
    });
  } catch (error) {
    console.error('Error en GET /api/payments/summary/monthly:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/payments/user/:userId -> Historial de pagos de un usuario
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [rows] = await pool.query(
      `SELECT 
         p.*,
         c.name AS category_name
       FROM payments p
       JOIN users u ON p.user_id = u.id
       JOIN categories c ON u.category_id = c.id
       WHERE p.user_id = ?
       ORDER BY p.period_year DESC, p.period_month DESC`,
      [userId]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/payments/user/:userId:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/payments/user/:userId/debt -> Deuda total de un usuario
router.get('/user/:userId/debt', async (req, res) => {
  try {
    const { userId } = req.params;

    const [rows] = await pool.query(
      `SELECT 
         SUM(balance) AS total_debt,
         COUNT(*) AS pending_months
       FROM payments
       WHERE user_id = ? AND status IN ('pendiente', 'parcial', 'vencido')`,
      [userId]
    );

    const [userInfo] = await pool.query(
      `SELECT first_name, last_name, dni FROM users WHERE id = ?`,
      [userId]
    );

    res.json({
      user: userInfo[0] || null,
      total_debt: rows[0].total_debt || 0,
      pending_months: rows[0].pending_months || 0
    });
  } catch (error) {
    console.error('Error en GET /api/payments/user/:userId/debt:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/payments/:id -> Obtener un pago específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT 
         p.*,
         u.first_name,
         u.last_name,
         u.dni,
         u.is_member,
         c.name AS category_name,
         c.amount_member,
         c.amount_non_member
       FROM payments p
       JOIN users u ON p.user_id = u.id
       JOIN categories c ON u.category_id = c.id
       WHERE p.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error en GET /api/payments/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS POST ====================

// POST /api/payments -> Generar cuota mensual para un usuario
router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      period_month,
      period_year,
      due_date,
      notes
    } = req.body;

    // Validación básica
    if (!user_id || !period_month || !period_year) {
      return res.status(400).json({ 
        message: 'user_id, period_month y period_year son obligatorios' 
      });
    }

    // Si no se proporciona due_date, se genera automáticamente (día 10 del mes)
    const finalDueDate = due_date || `${period_year}-${String(period_month).padStart(2, '0')}-10`;

    // Calcular monto según categoría y membresía
    const amountDue = await calculateAmountDue(user_id);
    
    if (amountDue === null) {
      return res.status(400).json({ message: 'Usuario no encontrado' });
    }

    const [result] = await pool.query(
      `INSERT INTO payments
       (user_id, period_month, period_year, amount_due, balance, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user_id, period_month, period_year, amountDue, amountDue, finalDueDate, notes || null]
    );

    res.status(201).json({
      id: result.insertId,
      user_id,
      period_month,
      period_year,
      amount_due: amountDue,
      amount_paid: 0,
      balance: amountDue,
      payment_type: 'sin_pago',
      status: 'pendiente',
      due_date: finalDueDate
    });
  } catch (error) {
    console.error('Error en POST /api/payments:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        message: 'Ya existe una cuota para este usuario en este período' 
      });
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ message: 'El usuario no existe' });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});


// POST /api/payments/generate-monthly -> Generar cuotas para TODOS los usuarios activos
router.post('/generate-monthly', async (req, res) => {
  try {
    const { month, year, due_date } = req.body;

    if (!month || !year) {
      return res.status(400).json({ 
        message: 'month y year son obligatorios' 
      });
    }

    // Si no se proporciona due_date, se genera automáticamente (día 10 del mes)
    const finalDueDate = due_date || `${year}-${String(month).padStart(2, '0')}-10`;

    // Obtener todos los usuarios activos con su categoría
    const [users] = await pool.query(
      `SELECT 
         u.id,
         u.is_member,
         c.amount_member,
         c.amount_non_member
       FROM users u
       JOIN categories c ON u.category_id = c.id
       WHERE u.status = 'activo'`
    );

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      const amountDue = user.is_member ? user.amount_member : user.amount_non_member;
      
      try {
        await pool.query(
          `INSERT INTO payments
           (user_id, period_month, period_year, amount_due, balance, due_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [user.id, month, year, amountDue, amountDue, finalDueDate]
        );
        created++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          skipped++; // Ya existe cuota para este usuario/período
        } else {
          throw err;
        }
      }
    }

    res.status(201).json({
      message: `Cuotas generadas para ${month}/${year}`,
      created,
      skipped,
      total_users: users.length
    });
  } catch (error) {
    console.error('Error en POST /api/payments/generate-monthly:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PATCH ====================

// PATCH /api/payments/:id/pay -> Registrar un pago (suma al monto pagado)
router.patch('/:id/pay', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_method, payment_date, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'amount debe ser mayor a 0' });
    }

    // Obtener el pago actual
    const [payments] = await pool.query(
      `SELECT * FROM payments WHERE id = ?`,
      [id]
    );

    if (payments.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    const payment = payments[0];
    const newAmountPaid = Number(payment.amount_paid) + Number(amount);
    const newBalance = Number(payment.amount_due) - newAmountPaid;
    const paymentType = getPaymentType(newAmountPaid, payment.amount_due);
    const status = getPaymentStatus(newAmountPaid, payment.amount_due, payment.due_date);

    await pool.query(
      `UPDATE payments 
       SET amount_paid = ?, 
           balance = ?, 
           payment_type = ?, 
           status = ?,
           payment_method = COALESCE(?, payment_method),
           payment_date = COALESCE(?, payment_date),
           notes = COALESCE(?, notes)
       WHERE id = ?`,
      [
        newAmountPaid, 
        newBalance > 0 ? newBalance : 0, 
        paymentType, 
        status,
        payment_method || null,
        payment_date || new Date().toISOString().split('T')[0],
        notes || null,
        id
      ]
    );

    res.json({
      id: Number(id),
      amount_received: Number(amount),
      total_paid: newAmountPaid,
      balance: newBalance > 0 ? newBalance : 0,
      payment_type: paymentType,
      status,
      message: paymentType === 'completo' ? '¡Pago completo!' : 
               paymentType === 'minimo' ? 'Pago mínimo registrado' : 
               'Pago parcial registrado'
    });
  } catch (error) {
    console.error('Error en PATCH /api/payments/:id/pay:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// PATCH /api/payments/:id/status -> Cambiar estado manualmente
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pendiente', 'pagado', 'parcial', 'vencido'].includes(status)) {
      return res.status(400).json({ 
        message: "status debe ser 'pendiente', 'pagado', 'parcial' o 'vencido'" 
      });
    }

    const [result] = await pool.query(
      `UPDATE payments SET status = ? WHERE id = ?`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.json({ id: Number(id), status });
  } catch (error) {
    console.error('Error en PATCH /api/payments/:id/status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PUT ====================

// PUT /api/payments/:id -> Actualizar pago completo
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount_due,
      amount_paid,
      payment_method,
      payment_date,
      due_date,
      notes
    } = req.body;

    // Obtener pago actual
    const [current] = await pool.query(`SELECT * FROM payments WHERE id = ?`, [id]);
    
    if (current.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    const newAmountDue = amount_due || current[0].amount_due;
    const newAmountPaid = amount_paid !== undefined ? amount_paid : current[0].amount_paid;
    const newBalance = newAmountDue - newAmountPaid;
    const newDueDate = due_date || current[0].due_date;
    const paymentType = getPaymentType(newAmountPaid, newAmountDue);
    const status = getPaymentStatus(newAmountPaid, newAmountDue, newDueDate);

    await pool.query(
      `UPDATE payments
       SET amount_due = ?,
           amount_paid = ?,
           balance = ?,
           payment_type = ?,
           status = ?,
           payment_method = ?,
           payment_date = ?,
           due_date = ?,
           notes = ?
       WHERE id = ?`,
      [
        newAmountDue,
        newAmountPaid,
        newBalance > 0 ? newBalance : 0,
        paymentType,
        status,
        payment_method || current[0].payment_method,
        payment_date || current[0].payment_date,
        newDueDate,
        notes !== undefined ? notes : current[0].notes,
        id
      ]
    );

    res.json({
      id: Number(id),
      amount_due: newAmountDue,
      amount_paid: newAmountPaid,
      balance: newBalance > 0 ? newBalance : 0,
      payment_type: paymentType,
      status
    });
  } catch (error) {
    console.error('Error en PUT /api/payments/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS DELETE ====================

// DELETE /api/payments/:id -> Eliminar pago
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `DELETE FROM payments WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    res.json({ message: 'Pago eliminado correctamente', id: Number(id) });
  } catch (error) {
    console.error('Error en DELETE /api/payments/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


module.exports = router;

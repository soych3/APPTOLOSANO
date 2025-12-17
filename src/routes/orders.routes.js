const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ==================== FUNCIONES AUXILIARES ====================

// Verificar si el usuario está habilitado para comprar
async function checkUserEnabled(userId, maxDebtMonths = 2) {
  const [debtInfo] = await pool.query(
    `SELECT COUNT(*) AS pending_months
     FROM payments
     WHERE user_id = ? AND status IN ('pendiente', 'parcial', 'vencido')`,
    [userId]
  );
  return debtInfo[0].pending_months <= maxDebtMonths;
}

// Verificar stock disponible
async function checkStock(productId, quantity) {
  const [product] = await pool.query(
    `SELECT stock, name FROM products WHERE id = ? AND status = 'disponible'`,
    [productId]
  );
  if (product.length === 0) return { available: false, reason: 'Producto no encontrado o inactivo' };
  if (product[0].stock < quantity) {
    return { available: false, reason: `Stock insuficiente para ${product[0].name}. Disponible: ${product[0].stock}` };
  }
  return { available: true, product: product[0] };
}


// ==================== RUTAS GET ====================

// GET /api/orders -> Listar pedidos con filtros
router.get('/', async (req, res) => {
  try {
    const { user_id, status, from_date, to_date } = req.query;

    let query = `
      SELECT 
        o.*,
        u.first_name,
        u.last_name,
        u.dni,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (user_id) {
      query += ` AND o.user_id = ?`;
      params.push(user_id);
    }
    if (status) {
      query += ` AND o.status = ?`;
      params.push(status);
    }
    if (from_date) {
      query += ` AND DATE(o.created_at) >= ?`;
      params.push(from_date);
    }
    if (to_date) {
      query += ` AND DATE(o.created_at) <= ?`;
      params.push(to_date);
    }

    query += ` ORDER BY o.created_at DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/orders:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/orders/:id -> Obtener un pedido con sus items
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener pedido
    const [orders] = await pool.query(
      `SELECT 
         o.*,
         u.first_name,
         u.last_name,
         u.dni,
         u.email,
         u.phone
       FROM orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.id = ?`,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }

    // Obtener items del pedido
    const [items] = await pool.query(
      `SELECT 
         oi.*,
         p.name AS product_name,
         p.category AS product_category
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [id]
    );

    res.json({
      ...orders[0],
      items
    });
  } catch (error) {
    console.error('Error en GET /api/orders/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/orders/user/:userId -> Pedidos de un usuario
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [rows] = await pool.query(
      `SELECT 
         o.*,
         (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count
       FROM orders o
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
      [userId]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/orders/user/:userId:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/orders/summary -> Resumen de ventas
router.get('/summary/sales', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    let dateFilter = '';
    const params = [];

    if (from_date) {
      dateFilter += ` AND DATE(created_at) >= ?`;
      params.push(from_date);
    }
    if (to_date) {
      dateFilter += ` AND DATE(created_at) <= ?`;
      params.push(to_date);
    }

    const [summary] = await pool.query(
      `SELECT 
         COUNT(*) AS total_orders,
         SUM(CASE WHEN status = 'pendiente' THEN 1 ELSE 0 END) AS pending_orders,
         SUM(CASE WHEN status = 'pagado' THEN 1 ELSE 0 END) AS paid_orders,
         SUM(CASE WHEN status = 'entregado' THEN 1 ELSE 0 END) AS delivered_orders,
         SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS cancelled_orders,
         SUM(CASE WHEN status != 'cancelado' THEN total ELSE 0 END) AS total_sales,
         SUM(CASE WHEN status IN ('pagado', 'entregado') THEN total ELSE 0 END) AS confirmed_sales
       FROM orders
       WHERE 1=1 ${dateFilter}`,
      params
    );

    res.json(summary[0]);
  } catch (error) {
    console.error('Error en GET /api/orders/summary/sales:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS POST ====================

// POST /api/orders -> Crear un pedido
router.post('/', async (req, res) => {
  try {
    const { user_id, items, payment_method, notes, check_debt } = req.body;

    // Validación básica
    if (!user_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'user_id e items son obligatorios' });
    }

    // Verificar que el usuario existe
    const [users] = await pool.query(`SELECT id, is_member, status FROM users WHERE id = ?`, [user_id]);
    if (users.length === 0) {
      return res.status(400).json({ message: 'Usuario no encontrado' });
    }

    const user = users[0];

    // Verificar si el usuario está activo
    if (user.status !== 'activo') {
      return res.status(400).json({ message: 'El usuario no está activo' });
    }

    // Verificar deuda (opcional, habilitado por defecto)
    if (check_debt !== false) {
      const isEnabled = await checkUserEnabled(user_id);
      if (!isEnabled) {
        return res.status(400).json({ 
          message: 'El usuario tiene demasiada deuda pendiente y no puede realizar compras' 
        });
      }
    }

    // Validar items y calcular total
    let total = 0;
    const validatedItems = [];

    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: 'Cada item debe tener product_id y quantity > 0' });
      }

      // Verificar producto y stock
      const stockCheck = await checkStock(item.product_id, item.quantity);
      if (!stockCheck.available) {
        return res.status(400).json({ message: stockCheck.reason });
      }

      // Verificar si es solo para miembros
      const [product] = await pool.query(
        `SELECT * FROM products WHERE id = ?`,
        [item.product_id]
      );

      if (product[0].members_only && !user.is_member) {
        return res.status(400).json({ 
          message: `El producto "${product[0].name}" es solo para socios` 
        });
      }

      const subtotal = product[0].price * item.quantity;
      total += subtotal;

      validatedItems.push({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: product[0].price,
        subtotal
      });
    }

    // Crear el pedido
    const [orderResult] = await pool.query(
      `INSERT INTO orders (user_id, total, payment_method, notes)
       VALUES (?, ?, ?, ?)`,
      [user_id, total, payment_method || null, notes || null]
    );

    const orderId = orderResult.insertId;

    // Insertar items y actualizar stock
    for (const item of validatedItems) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.quantity, item.unit_price, item.subtotal]
      );

      // Descontar stock
      await pool.query(
        `UPDATE products SET stock = stock - ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );
    }

    res.status(201).json({
      id: orderId,
      user_id,
      total,
      status: 'pendiente',
      items: validatedItems,
      message: 'Pedido creado correctamente'
    });
  } catch (error) {
    console.error('Error en POST /api/orders:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PATCH ====================

// PATCH /api/orders/:id/status -> Cambiar estado del pedido
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pendiente', 'pagado', 'entregado', 'cancelado'].includes(status)) {
      return res.status(400).json({ 
        message: "status debe ser 'pendiente', 'pagado', 'entregado' o 'cancelado'" 
      });
    }

    // Obtener pedido actual
    const [orders] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }

    const currentOrder = orders[0];

    // Si se cancela, devolver stock
    if (status === 'cancelado' && currentOrder.status !== 'cancelado') {
      const [items] = await pool.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = ?`,
        [id]
      );

      for (const item of items) {
        await pool.query(
          `UPDATE products SET stock = stock + ? WHERE id = ?`,
          [item.quantity, item.product_id]
        );
      }
    }

    // Si se reactiva un pedido cancelado, descontar stock de nuevo
    if (currentOrder.status === 'cancelado' && status !== 'cancelado') {
      const [items] = await pool.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = ?`,
        [id]
      );

      for (const item of items) {
        // Verificar stock disponible
        const stockCheck = await checkStock(item.product_id, item.quantity);
        if (!stockCheck.available) {
          return res.status(400).json({ 
            message: `No se puede reactivar: ${stockCheck.reason}` 
          });
        }
      }

      for (const item of items) {
        await pool.query(
          `UPDATE products SET stock = stock - ? WHERE id = ?`,
          [item.quantity, item.product_id]
        );
      }
    }

    await pool.query(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, id]
    );

    res.json({ id: parseInt(id), status, message: `Estado actualizado a '${status}'` });
  } catch (error) {
    console.error('Error en PATCH /api/orders/:id/status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS DELETE ====================

// DELETE /api/orders/:id -> Eliminar un pedido
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener pedido
    const [orders] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }

    // Si no está cancelado, devolver stock
    if (orders[0].status !== 'cancelado') {
      const [items] = await pool.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = ?`,
        [id]
      );

      for (const item of items) {
        await pool.query(
          `UPDATE products SET stock = stock + ? WHERE id = ?`,
          [item.quantity, item.product_id]
        );
      }
    }

    // Eliminar pedido (los items se eliminan por CASCADE)
    await pool.query(`DELETE FROM orders WHERE id = ?`, [id]);

    res.json({ message: 'Pedido eliminado correctamente', id: parseInt(id) });
  } catch (error) {
    console.error('Error en DELETE /api/orders/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


module.exports = router;

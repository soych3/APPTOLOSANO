const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ==================== RUTAS GET ====================

// GET /api/products -> Listar todos los productos
router.get('/', async (req, res) => {
  try {
    const { category, status, members_only } = req.query;

    let query = `SELECT * FROM products WHERE 1=1`;
    const params = [];

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (members_only !== undefined) {
      query += ` AND members_only = ?`;
      params.push(members_only === 'true' ? 1 : 0);
    }

    query += ` ORDER BY name ASC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/products:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/products/categories -> Listar categorías de productos
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category`
    );
    res.json(rows.map(r => r.category));
  } catch (error) {
    console.error('Error en GET /api/products/categories:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// GET /api/products/:id -> Obtener un producto por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT * FROM products WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error en GET /api/products/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS POST ====================

// POST /api/products -> Crear un producto
router.post('/', async (req, res) => {
  try {
    const { name, description, price, stock, category, image_url, members_only } = req.body;

    // Validación básica
    if (!name || price === undefined) {
      return res.status(400).json({ message: 'name y price son obligatorios' });
    }

    const [result] = await pool.query(
      `INSERT INTO products (name, description, price, stock, category, image_url, members_only)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || null, price, stock || 0, category || null, image_url || null, members_only ? 1 : 0]
    );

    res.status(201).json({
      id: result.insertId,
      name,
      description,
      price,
      stock: stock || 0,
      category,
      image_url,
      members_only: !!members_only,
      status: 'activo'
    });
  } catch (error) {
    console.error('Error en POST /api/products:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PUT ====================

// PUT /api/products/:id -> Actualizar un producto
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, category, image_url, members_only, status } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ message: 'name y price son obligatorios' });
    }

    const [result] = await pool.query(
      `UPDATE products
       SET name = ?, description = ?, price = ?, stock = ?, category = ?, 
           image_url = ?, members_only = ?, status = ?
       WHERE id = ?`,
      [name, description || null, price, stock || 0, category || null, 
       image_url || null, members_only ? 1 : 0, status || 'activo', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    res.json({
      id: parseInt(id),
      name,
      description,
      price,
      stock,
      category,
      image_url,
      members_only: !!members_only,
      status: status || 'activo'
    });
  } catch (error) {
    console.error('Error en PUT /api/products/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS PATCH ====================

// PATCH /api/products/:id/status -> Cambiar estado del producto
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['activo', 'inactivo'].includes(status)) {
      return res.status(400).json({ message: "status debe ser 'activo' o 'inactivo'" });
    }

    const [result] = await pool.query(
      `UPDATE products SET status = ? WHERE id = ?`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    res.json({ id: parseInt(id), status });
  } catch (error) {
    console.error('Error en PATCH /api/products/:id/status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// PATCH /api/products/:id/stock -> Actualizar stock
router.patch('/:id/stock', async (req, res) => {
  try {
    const { id } = req.params;
    const { stock, operation } = req.body; // operation: 'set', 'add', 'subtract'

    if (stock === undefined || stock < 0) {
      return res.status(400).json({ message: 'stock debe ser un número >= 0' });
    }

    let query;
    if (operation === 'add') {
      query = `UPDATE products SET stock = stock + ? WHERE id = ?`;
    } else if (operation === 'subtract') {
      query = `UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?`;
    } else {
      query = `UPDATE products SET stock = ? WHERE id = ?`;
    }

    const [result] = await pool.query(query, [stock, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    // Obtener stock actualizado
    const [updated] = await pool.query(`SELECT stock FROM products WHERE id = ?`, [id]);

    res.json({ id: parseInt(id), stock: updated[0].stock });
  } catch (error) {
    console.error('Error en PATCH /api/products/:id/stock:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ==================== RUTAS DELETE ====================

// DELETE /api/products/:id -> Eliminar un producto
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si hay pedidos con este producto
    const [orders] = await pool.query(
      `SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?`,
      [id]
    );

    if (orders[0].count > 0) {
      return res.status(400).json({ 
        message: `No se puede eliminar. Hay ${orders[0].count} pedido(s) con este producto. Considerá desactivarlo en su lugar.`
      });
    }

    const [result] = await pool.query(
      `DELETE FROM products WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    res.json({ message: 'Producto eliminado correctamente', id: parseInt(id) });
  } catch (error) {
    console.error('Error en DELETE /api/products/:id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


module.exports = router;

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'portal_tolosano_secret_key_2025';

// Middleware para verificar token JWT
const authMiddleware = (req, res, next) => {
  try {
    // Obtener token del header Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ message: 'Token no proporcionado' });
    }

    // El formato es "Bearer <token>"
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Formato de token inválido' });
    }

    // Verificar token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Agregar datos del usuario al request
    req.user = decoded;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expirado' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Token inválido' });
    }
    
    console.error('Error en authMiddleware:', error);
    return res.status(500).json({ message: 'Error de autenticación' });
  }
};

// Middleware para verificar rol de admin
const adminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
  }
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  JWT_SECRET
};

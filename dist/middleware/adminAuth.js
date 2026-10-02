"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = void 0;
const jwt_1 = require("../lib/jwt");
function requireAdmin(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing admin token' });
    }
    const token = header.slice(7);
    try {
        const payload = (0, jwt_1.verifyToken)(token);
        // User tokens can't access admin routes
        if (!(0, jwt_1.isAdminToken)(payload)) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.admin = { role: 'ADMIN' };
        next();
    }
    catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
exports.requireAdmin = requireAdmin;
//# sourceMappingURL=adminAuth.js.map
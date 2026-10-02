"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdminToken = exports.isUserToken = exports.verifyToken = exports.signToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const EXPIRES_IN = '30d';
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
}
exports.signToken = signToken;
function verifyToken(token) {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET);
}
exports.verifyToken = verifyToken;
// Type guard for user tokens
function isUserToken(p) {
    return p.userId !== undefined;
}
exports.isUserToken = isUserToken;
// Type guard for admin tokens
function isAdminToken(p) {
    return p.role === 'ADMIN';
}
exports.isAdminToken = isAdminToken;
//# sourceMappingURL=jwt.js.map
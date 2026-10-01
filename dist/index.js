"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const user_1 = __importDefault(require("./routes/user"));
const loans_1 = __importDefault(require("./routes/loans"));
const guarantors_1 = __importDefault(require("./routes/guarantors"));
const kyc_1 = __importDefault(require("./routes/kyc"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'quickcash-backend', time: new Date() });
});
app.use('/api/auth', auth_1.default);
app.use('/api/user', user_1.default);
app.use('/api/loans', loans_1.default);
app.use('/api/guarantors', guarantors_1.default);
app.use('/api/kyc', kyc_1.default);
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
});
//# sourceMappingURL=index.js.map
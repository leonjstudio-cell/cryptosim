const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB = new DatabaseSync(path.join(__dirname, 'cryptosim.db'));

// Voir tous les users
const users = DB.prepare('SELECT id, pseudo, account_code FROM users').all();
console.log('Users en base:', JSON.stringify(users, null, 2));

// Réinitialiser le mot de passe de Admin à "admin123"
const newPwd = 'admin123';
const hash = crypto.createHash('sha256').update(newPwd).digest('hex');
DB.prepare('UPDATE users SET pwd_hash=? WHERE pseudo=?').run(hash, 'Admin');
console.log('Mot de passe Admin réinitialisé à: admin123');

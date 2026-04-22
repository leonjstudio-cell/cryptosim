// CryptoSim & ActionSim — Backend Node.js 22+ + SQLite natif
// Lancer : node server.js  |  Ouvrir : http://localhost:3000/cryptosim.html
'use strict';
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app  = express();
const PORT = 3000;
const DB   = new DatabaseSync(path.join(__dirname,'cryptosim.db'));

app.use(cors()); app.use(express.json()); app.use(express.static(__dirname));

// ── Tables ────────────────────────────────────────────────────────────────────
DB.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pwd_hash TEXT NOT NULL,
  account_code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS progress(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scores(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL, score REAL NOT NULL,
  market TEXT NOT NULL DEFAULT 'crypto',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collaborations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_pseudo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_id,to_id)
);
CREATE TABLE IF NOT EXISTS transfers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_pseudo TEXT NOT NULL, to_pseudo TEXT NOT NULL,
  amount REAL NOT NULL, note TEXT DEFAULT '',
  is_request INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);`);
console.log('DB prete');

// ── Helpers ───────────────────────────────────────────────────────────────────
function hashPwd(p){ return crypto.createHash('sha256').update(p).digest('hex'); }
function genCode(){ return Math.random().toString(36).substring(2,8).toUpperCase(); }
function err(res,msg,code=400){ res.status(code).json({error:msg}); }
function ok(res,data){ res.json(data); }

// ── Auth : Register ───────────────────────────────────────────────────────────
app.post('/api/register',(req,res)=>{
  const {pseudo,pwd}=req.body||{};
  if(!pseudo||!pwd) return err(res,'Pseudo et mot de passe requis');
  if(pseudo.length<2||pseudo.length>20) return err(res,'Pseudo 2-20 caractères');
  if(pwd.length<4) return err(res,'Mot de passe trop court (min 4)');
  const exists=DB.prepare('SELECT id FROM users WHERE pseudo=?').get(pseudo);
  if(exists) return err(res,'Ce pseudo est déjà pris');
  let code=genCode();
  while(DB.prepare('SELECT id FROM users WHERE account_code=?').get(code)){ code=genCode(); }
  DB.prepare('INSERT INTO users(pseudo,pwd_hash,account_code) VALUES(?,?,?)')
    .run(pseudo,hashPwd(pwd),code);
  const u=DB.prepare('SELECT id,pseudo,account_code FROM users WHERE pseudo=?').get(pseudo);
  ok(res,{user:u});
});

// ── Auth : Login ──────────────────────────────────────────────────────────────
app.post('/api/login',(req,res)=>{
  const {pseudo,pwd}=req.body||{};
  if(!pseudo||!pwd) return err(res,'Champs requis');
  const u=DB.prepare('SELECT id,pseudo,account_code,pwd_hash FROM users WHERE pseudo=?').get(pseudo);
  if(!u||u.pwd_hash!==hashPwd(pwd)) return err(res,'Pseudo ou mot de passe incorrect');
  ok(res,{user:{id:u.id,pseudo:u.pseudo,account_code:u.account_code}});
});

// ── Progress : GET ────────────────────────────────────────────────────────────
app.get('/api/progress/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const market=req.query.market||'crypto';
  const row=DB.prepare('SELECT data FROM progress WHERE user_id=?').get(uid);
  if(!row) return ok(res,{data:null});
  try{
    const all=JSON.parse(row.data);
    const d=all[market]||null;
    ok(res,{data:d});
  }catch{ ok(res,{data:null}); }
});

// ── Progress : POST ───────────────────────────────────────────────────────────
app.post('/api/progress/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const {data}=req.body||{};
  if(!data) return err(res,'data manquant');
  const market=data.market||'crypto';
  const row=DB.prepare('SELECT data FROM progress WHERE user_id=?').get(uid);
  let all={};
  if(row){ try{ all=JSON.parse(row.data); }catch{} }
  all[market]=data;
  const json=JSON.stringify(all);
  if(row){ DB.prepare('UPDATE progress SET data=?,updated_at=datetime("now") WHERE user_id=?').run(json,uid); }
  else { DB.prepare('INSERT INTO progress(user_id,data) VALUES(?,?)').run(uid,json); }
  ok(res,{ok:true});
});

// ── Scores : POST (upsert) ────────────────────────────────────────────────────
app.post('/api/scores',(req,res)=>{
  const {user_id,pseudo,score,market='crypto'}=req.body||{};
  if(!user_id||score==null) return err(res,'user_id et score requis');
  const ex=DB.prepare('SELECT id FROM scores WHERE user_id=? AND market=?').get(user_id,market);
  if(ex){ DB.prepare('UPDATE scores SET score=?,pseudo=?,updated_at=datetime("now") WHERE id=?').run(score,pseudo||'?',ex.id); }
  else { DB.prepare('INSERT INTO scores(user_id,pseudo,score,market) VALUES(?,?,?,?)').run(user_id,pseudo||'?',score,market); }
  ok(res,{ok:true});
});

// ── Scores : GET (leaderboard) ────────────────────────────────────────────────
app.get('/api/scores',(req,res)=>{
  const market=req.query.market||'crypto';
  const rows=DB.prepare('SELECT pseudo,score FROM scores WHERE market=? ORDER BY score DESC LIMIT 20').all(market);
  ok(res,{scores:rows});
});

// ── Collaboration : envoyer une demande ───────────────────────────────────────
app.post('/api/collab/request',(req,res)=>{
  const {from_id,account_code}=req.body||{};
  if(!from_id||!account_code) return err(res,'from_id et account_code requis');
  const target=DB.prepare('SELECT id,pseudo FROM users WHERE account_code=?').get(account_code.toUpperCase());
  if(!target) return err(res,'Aucun joueur avec ce code');
  if(target.id===from_id) return err(res,'Vous ne pouvez pas vous inviter vous-même');
  const from=DB.prepare('SELECT pseudo FROM users WHERE id=?').get(from_id);
  if(!from) return err(res,'Utilisateur introuvable');
  const ex=DB.prepare('SELECT id,status FROM collaborations WHERE from_id=? AND to_id=?').get(from_id,target.id);
  if(ex){
    if(ex.status==='accepted') return err(res,'Déjà collaborateurs');
    if(ex.status==='pending') return err(res,'Demande déjà envoyée');
  }
  DB.prepare('INSERT OR REPLACE INTO collaborations(from_id,to_id,from_pseudo,status) VALUES(?,?,?,?)')
    .run(from_id,target.id,from.pseudo,'pending');
  ok(res,{ok:true,to_pseudo:target.pseudo});
});

// ── Collaboration : liste des demandes reçues ─────────────────────────────────
app.get('/api/collab/pending/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const rows=DB.prepare(`SELECT c.id,c.from_id,c.from_pseudo,c.created_at
    FROM collaborations c WHERE c.to_id=? AND c.status='pending' ORDER BY c.created_at DESC`).all(uid);
  ok(res,{requests:rows});
});

// ── Collaboration : accepter / refuser ────────────────────────────────────────
app.post('/api/collab/respond',(req,res)=>{
  const {collab_id,accept}=req.body||{};
  if(collab_id==null) return err(res,'collab_id requis');
  const status=accept?'accepted':'rejected';
  DB.prepare('UPDATE collaborations SET status=? WHERE id=?').run(status,collab_id);
  ok(res,{ok:true,status});
});

// ── Collaboration : liste des collaborateurs acceptés ─────────────────────────
app.get('/api/collab/list/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const rows=DB.prepare(`
    SELECT CASE WHEN from_id=? THEN to_id ELSE from_id END as partner_id,
           CASE WHEN from_id=? THEN (SELECT pseudo FROM users WHERE id=collaborations.to_id)
                                ELSE from_pseudo END as partner_pseudo
    FROM collaborations WHERE (from_id=? OR to_id=?) AND status='accepted'`).all(uid,uid,uid,uid);
  ok(res,{partners:rows});
});

// ── Transferts : envoyer ou demander ─────────────────────────────────────────
app.post('/api/transfer',(req,res)=>{
  const {from_id,account_code,amount,note,is_request}=req.body||{};
  if(!from_id||!account_code||!amount) return err(res,'Champs manquants');
  if(amount<=0) return err(res,'Montant invalide');
  const target=DB.prepare('SELECT id,pseudo FROM users WHERE account_code=?').get(account_code.toUpperCase());
  if(!target) return err(res,'Aucun joueur avec ce code');
  if(target.id===from_id) return err(res,'Impossible de se transférer à soi-même');
  const from=DB.prepare('SELECT pseudo FROM users WHERE id=?').get(from_id);
  if(!from) return err(res,'Utilisateur introuvable');
  DB.prepare(`INSERT INTO transfers(from_id,to_id,from_pseudo,to_pseudo,amount,note,is_request)
    VALUES(?,?,?,?,?,?,?)`).run(from_id,target.id,from.pseudo,target.pseudo,amount,note||'',is_request?1:0);
  ok(res,{ok:true,to_pseudo:target.pseudo});
});

// ── Transferts : liste reçus (non-demandes) ───────────────────────────────────
app.get('/api/transfers/received/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const rows=DB.prepare(`SELECT id,from_id,from_pseudo,amount,note,created_at
    FROM transfers WHERE to_id=? AND is_request=0 ORDER BY created_at DESC LIMIT 50`).all(uid);
  ok(res,{transfers:rows});
});

// ── Transferts : demandes reçues ──────────────────────────────────────────────
app.get('/api/transfers/requests/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const rows=DB.prepare(`SELECT id,from_id,from_pseudo,amount,note,created_at
    FROM transfers WHERE to_id=? AND is_request=1 ORDER BY created_at DESC LIMIT 50`).all(uid);
  ok(res,{requests:rows});
});

// ── Utilisateur : chercher par code de compte ─────────────────────────────────
app.get('/api/user/bycode/:code',(req,res)=>{
  const u=DB.prepare('SELECT id,pseudo,account_code FROM users WHERE account_code=?')
    .get(req.params.code.toUpperCase());
  if(!u) return err(res,'Introuvable',404);
  ok(res,{user:u});
});

// ── Utilisateur : infos + code de compte ─────────────────────────────────────
app.get('/api/user/:id',(req,res)=>{
  const u=DB.prepare('SELECT id,pseudo,account_code,created_at FROM users WHERE id=?')
    .get(parseInt(req.params.id));
  if(!u) return err(res,'Introuvable',404);
  ok(res,{user:u});
});

// ── Portfolio partagé d'un collaborateur ──────────────────────────────────────
app.get('/api/progress/shared/:uid',(req,res)=>{
  const uid=parseInt(req.params.uid);
  const market=req.query.market||'crypto';
  const row=DB.prepare('SELECT data FROM progress WHERE user_id=?').get(uid);
  if(!row) return ok(res,{data:null});
  try{
    const all=JSON.parse(row.data);
    ok(res,{data:all[market]||null});
  }catch{ ok(res,{data:null}); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT,()=>{
  console.log(`CryptoSim server listening → http://localhost:${PORT}/cryptosim.html`);
});

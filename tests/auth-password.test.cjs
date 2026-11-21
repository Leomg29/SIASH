const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("server.js","utf8");
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)}
test("politica de senha forte aceita especial e rejeita senha fraca",()=>{
 const code=extract("const STRONG_PASSWORD=","function tokenFor");
 const context={};vm.runInNewContext(code+";globalThis.validate=validNewPassword",context);
 assert.equal(context.validate("MinhaSenha123"),false);
 assert.equal(context.validate("MinhaSenha!123"),true);
 assert.equal(context.validate("123456789_"),true);
 assert.equal(context.validate("Curta!"),false);
});
test("troca de senha: valida atual, persiste hash e audita em transacao",async()=>{
 const route=extract('app.post("/api/change-password"','app.post("/api/login"');
 let handler,stored="hash-antigo",audited=0,commits=0,rollbacks=0;
 const client={query:async(sql,args)=>{
  if(sql==="BEGIN")return {};
  if(sql==="COMMIT"){commits++;return {}}
  if(sql==="ROLLBACK"){rollbacks++;return {}}
  if(sql.startsWith("SELECT password_hash"))return {rows:[{password_hash:stored}]};
  if(sql.startsWith("UPDATE siash_users")){stored=args[0];return {}}
  if(sql.startsWith("INSERT INTO siash_cloud_audit")){audited++;return {}}
  throw Error("SQL inesperado: "+sql);
 },release(){}};
 const pool={connect:async()=>client};
 const bcrypt={compare:async(password,hash)=>password==="SenhaAntiga!1"&&hash==="hash-antigo",hash:async next=>"hash:"+next};
 const app={post:(path,...handlers)=>{assert.equal(path,"/api/change-password");handler=handlers.at(-1)}};
 const context={app,pool,bcrypt,auth:()=>{},validNewPassword:p=>p.length>=10&&/[!@#$%^&*._-]/.test(p),String};
 vm.runInNewContext(route,{...context});
 const respond=()=>{const res={status(n){this.code=n;return this},json(v){this.body=v;return this}};return res};
 let res=respond();
 await handler({user:{u:"enfermeiro"},body:{currentPassword:"incorreta",newPassword:"NovaSenha!123",confirmPassword:"NovaSenha!123"}},res);
 assert.equal(res.code,403);assert.equal(stored,"hash-antigo");assert.equal(rollbacks,1);
 res=respond();
 await handler({user:{u:"enfermeiro"},body:{currentPassword:"SenhaAntiga!1",newPassword:"NovaSenha!123",confirmPassword:"NovaSenha!123"}},res);
 assert.equal(res.body.ok,true);assert.equal(stored,"hash:NovaSenha!123");assert.equal(audited,1);assert.equal(commits,1);
});

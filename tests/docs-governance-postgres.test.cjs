"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {hash}=require("../docs-governance-integrity.cjs");
test("PR100 isolated PostgreSQL: additive schema, immutable artifact identity and hash",{skip:process.env.SIASH_ISOLATED_CI!=="1"},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {Pool}=require("pg");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 try{
  const names=["siash_doc_access","siash_doc_artifacts","siash_doc_publication_audit"];
  for(const name of names){const q=await db.query("SELECT to_regclass($1) AS relation",["public."+name]);assert.ok(q.rows[0].relation,name)}
  const existing=await db.query("SELECT COUNT(*)::int n FROM siash_documents");
  const key="pr100-test-"+Date.now();
  const bytes=Buffer.from("CI-only-artifact");
  await db.query("INSERT INTO siash_documents(doc_key,file_name,mime_type,file_data,updated_by) VALUES($1,$2,$3,$4,$5)",[key,"ci.pdf","application/pdf",bytes,"CI"]);
  try{
   const id=require("node:crypto").randomUUID();
   await db.query("INSERT INTO siash_doc_artifacts(id,doc_key,sha256,created_by) VALUES($1,$2,$3,$4)",[id,key,hash(bytes),"CI"]);
   const read=await db.query("SELECT a.sha256,d.file_data FROM siash_doc_artifacts a JOIN siash_documents d ON d.doc_key=a.doc_key WHERE a.doc_key=$1",[key]);
   assert.equal(read.rows[0].sha256,hash(read.rows[0].file_data));
   await assert.rejects(db.query("INSERT INTO siash_doc_artifacts(id,doc_key,sha256,created_by) VALUES($1,$2,$3,$4)",[require("node:crypto").randomUUID(),key,hash(bytes),"CI"]));
  }finally{await db.query("DELETE FROM siash_doc_artifacts WHERE doc_key=$1",[key]);await db.query("DELETE FROM siash_documents WHERE doc_key=$1",[key])}
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM siash_documents")).rows[0].n,existing.rows[0].n);
 }finally{await db.end()}
});

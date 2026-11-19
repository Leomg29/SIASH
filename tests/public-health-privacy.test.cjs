const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('server.js','utf8');
const start=source.indexOf('app.get("/api/health"');
const end=source.indexOf('app.post("/api/bootstrap"',start);
assert.ok(start>=0&&end>start,'health route missing');
const route=source.slice(start,end);
test('health publico nao consulta metadados do estado nem divulga usuario',async()=>{
 let handler;
 const app={get:(path,fn)=>{assert.equal(path,'/api/health');handler=fn;}};
 const pool={query:async sql=>{assert.match(sql,/COUNT\(\*\)/);assert.match(sql,/siash_users/);return {rows:[{n:1}]};}};
 vm.runInNewContext(route,{app,pool});
 let output;await handler({}, {json:value=>{output=value;}});
 assert.equal(output.ok,true);
 assert.equal(output.configured,true);
 assert.deepEqual(Object.keys(output).sort(),['configured','ok']);
});

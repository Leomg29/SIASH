const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const server=fs.readFileSync(require("node:path").join(__dirname,"../server.js"),"utf8");
const ui=fs.readFileSync(require("node:path").join(__dirname,"../app.js"),"utf8");
const html=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");

test("clinical supervisor role exists without replacing legacy roles",()=>{
 assert.match(server,/CHECK\(role IN \('owner','operational','clinical_supervisor'\)\)/);
 assert.match(server,/ALTER TABLE siash_users ADD CONSTRAINT siash_users_role_check/);
});
test("late decision verifies database role and forbids self approval",()=>{
 assert.match(server,/canDecideClinical\(supervisorRole.rows\[0\]\?\.role\)/);
 assert.match(server,/request\.requester===req\.user\.u/);
 assert.match(server,/SELF_APPROVAL_FORBIDDEN/);
});
test("role updates restricted to owner, audited, owner role immutable",()=>{
 assert.match(server,/app\.patch\("\/api\/users\/:username\/role"/);
 assert.match(server,/if\(req\.user\.r!=="owner"\)return res\.status\(403\)/);
 assert.match(server,/const role=await databaseRole\(identity\.u\)/);
 assert.match(server,/OWNER_ROLE_IMMUTABLE/);
 assert.match(server,/INSERT INTO siash_cloud_audit\(username,action,details\)/);
});
test("frontend keeps clinical supervisor separate from owner and self review",()=>{
 assert.match(ui,/function canReviewLateCensus\(\)/);
 assert.match(ui,/canReviewLateCensus\(\)&&!same/);
 assert.match(html,/id="admin-new-role"/);
 assert.match(ui,/function isOwner\(\).*role==="owner"/);
});

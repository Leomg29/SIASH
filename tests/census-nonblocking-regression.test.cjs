"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateConferenceMutation,censusWindow}=require("../census-window.cjs");
const date="2026-11-25";
const record=(count=7)=>({date,internados:count,censusConference:{referenceDate:date,count,responsible:"Enfermeiro teste"}});
const validate=(after,now,before)=>validateConferenceMutation({before,after,referenceDate:after.date,now:new Date(now)});
for(const time of ["2026-11-26T03:00:00Z","2026-11-26T03:11:00Z","2026-11-26T10:00:00Z","2026-11-27T10:00:00Z"]){
 test("first confirmation "+time,()=>assert.equal(validate(record(),time).ok,true));
}
test("reject before midnight",()=>assert.equal(validate(record(),"2026-11-26T02:59:59Z").ok,false));
test("explicit zero",()=>assert.equal(validate(record(0),"2026-11-26T10:00:00Z").ok,true));
for(const count of [null,"",undefined,-1,11,1.5,"7"]){
 test("invalid count "+String(count),()=>assert.equal(validate(record(count===undefined?null:count),"2026-11-26T10:00:00Z").ok,false));
}
test("confirmed total immutable",()=>assert.equal(validate({...record(),internados:9},"2026-11-26T10:00:00Z",record()).ok,false));
test("unchanged confirmed record",()=>assert.equal(validate(record(),"2026-11-26T10:00:00Z",record()).ok,true));
test("overdue status permits confirmation",()=>assert.equal(censusWindow(new Date("2026-11-26T10:00:00Z")).canConfirm,true));

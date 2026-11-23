"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {privacyFindings}=require("../docs-governance-integrity.cjs");
test("institutional POP phrases do not trigger clinical-name false positives",()=>{
 for(const text of [
  "O paciente deverá permanecer em observação após a coleta.",
  "Paciente deve receber orientações de segurança.",
  "PACIENTE COM SUSPEITA DE INFECÇÃO DEVE SER AVALIADO.",
  "RN de baixo peso necessita cuidados especiais.",
  "Prontuário deve ser preenchido após o procedimento.",
  "Data de nascimento deve ser conferida no atendimento."
 ])assert.deepEqual(privacyFindings(text),[],text);
});
test("synthetic explicit patient identifiers remain blocked in any letter case",()=>{
 for(const text of ["Paciente: Maria Silva","paciente: Maria Silva","PACIENTE: MARIA SILVA","RN de: Maria Silva"])
  assert.ok(privacyFindings(text).includes("NOME_CLINICO"),text);
 assert.ok(privacyFindings("Prontuário: AB1234").includes("PRONTUARIO"));
 assert.ok(privacyFindings("Data de nascimento: 01/02/2020").includes("NASCIMENTO"));
});
test("institutional descriptions with patient labels but no values are allowed",()=>{
 for(const text of ["Paciente: preencher conforme protocolo","Prontuário: registrar em sistema","RN de baixo peso"])
  assert.equal(privacyFindings(text).includes("PRONTUARIO"),false);
});

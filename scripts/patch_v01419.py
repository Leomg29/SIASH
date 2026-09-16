from pathlib import Path
import json

p=Path('app.js')
s=p.read_text(encoding='utf-8')

anchor='function updatePreparedHistoryPageCountXml(xml,institutionalRevision,pages){'
if anchor not in s: raise SystemExit('history page function anchor not found')
helpers=r'''function validateWordprocessingPackageXml(xml,name="XML"){
 const text=String(xml||"");if(!text.trim())return {ok:false,reason:`${name}: vazio`};
 try{const parsed=new DOMParser().parseFromString(text,"application/xml");if(parsed.getElementsByTagName("parsererror").length)return {ok:false,reason:`${name}: XML inválido`};return {ok:true}}catch(e){return {ok:false,reason:`${name}: ${e.message}`}}
}
async function validateDocxBlobIntegrity(blob){
 if(!blob||!blob.size)return {ok:false,reason:"arquivo-vazio"};
 try{
  const zip=await JSZip.loadAsync(blob,{checkCRC32:true});
  const required=["[Content_Types].xml","_rels/.rels","word/document.xml"];
  for(const name of required)if(!zip.file(name))return {ok:false,reason:`parte-obrigatória-ausente:${name}`};
  const xmlNames=Object.keys(zip.files).filter(n=>/\.xml$/i.test(n)&&!zip.files[n].dir);
  for(const name of xmlNames){const text=await zip.file(name).async("string"),chk=validateWordprocessingPackageXml(text,name);if(!chk.ok)return chk}
  const documentXml=await zip.file("word/document.xml").async("string");
  if(!/<w:document(?:\s|>)/.test(documentXml)||!/<w:body(?:\s|>)/.test(documentXml))return {ok:false,reason:"word/document.xml sem document/body"};
  const badCell=[...documentXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].find(m=>!/<w:p(?:\s|>|\/)/.test(m[0]));
  if(badCell)return {ok:false,reason:"célula-de-tabela-sem-parágrafo"};
  return {ok:true,zip};
 }catch(e){return {ok:false,reason:`pacote-docx-inválido:${e.message}`}}
}
function finalizePublishedHistoryStatusXmlSafe(xml,institutionalRevision){
 const hist=historyTableData(xml);if(!hist)return {xml:String(xml||""),changed:false};const wanted=Number(institutionalRevision);let table=hist.table,changed=false;
 for(const info of hist.info||[]){if(info.revision!==wanted)continue;const row=info.row,cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>x[0]);if(cells.length<4)break;const oldText=xmlPlainText(cells[3]);const newText=oldText.replace(/aguardando\s+confer[eê]ncia\s+profissional\.?/gi,"validada e publicada após conferência profissional.");if(newText!==oldText){const newCell=replaceCellText(cells[3],newText),newRow=row.replace(cells[3],newCell);table=table.replace(row,newRow);changed=true}break}
 return {xml:changed?String(xml||"").replace(hist.table,table):String(xml||""),changed};
}
'''
s=s.replace(anchor,helpers+anchor,1)

start=s.find('async function finalizePreparedApprovedWord(d,v,confirmedPages){')
end=s.find('\nfunction completePublication(',start)
if start<0 or end<0: raise SystemExit('finalize function bounds not found')
newfn=r'''async function finalizePreparedApprovedWord(d,v,confirmedPages){
 if(!v?.publicationPrepared||!v?.preparedInstitutionalRevision)return {updated:false,reason:"publication-not-prepared"};if(!v?.wordKey)return {updated:false,reason:"no-word-key"};const blob=await getDocBlob(v.wordKey);if(!blob)return {updated:false,reason:"word-not-found"};
 const pages=String(confirmedPages||"").trim();if(!/^\d{1,3}$/.test(pages)||Number(pages)<1)return {updated:false,reason:"page-count-not-confirmed"};
 const before=await validateDocxBlobIntegrity(blob);if(!before.ok){console.error("Word preparado inválido antes da finalização",before.reason);return {updated:false,reason:"docx-source-invalid",detail:before.reason}}
 try{const zip=await JSZip.loadAsync(blob,{checkCRC32:true}),file=zip.file("word/document.xml");if(!file)return {updated:false,reason:"document-xml-missing"};let xml=await file.async("string");
   xml=trimLegacyTrailingEmptyParagraphs(xml);
   const upd=updatePreparedHistoryPageCountXml(xml,v.preparedInstitutionalRevision,pages);if(!upd.ok)return {updated:false,reason:upd.reason};xml=upd.xml;
   const statusClean=removeProposalStatusParagraphs(xml);xml=statusClean.xml;
   const historyClean=finalizePublishedHistoryStatusXmlSafe(xml,v.preparedInstitutionalRevision);xml=historyClean.xml;
   const structural=ensureWordTableCellParagraphs(xml);xml=structural.xml;
   const xmlCheck=validateWordprocessingPackageXml(xml,"word/document.xml final");if(!xmlCheck.ok)return {updated:false,reason:"docx-final-xml-invalid",detail:xmlCheck.reason};
   zip.file("word/document.xml",xml);
   const approved=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",compression:"DEFLATE"});
   const after=await validateDocxBlobIntegrity(approved);if(!after.ok){console.error("Publicação bloqueada: DOCX final inválido",after.reason);return {updated:false,reason:"docx-final-validation-failed",detail:after.reason}}
   const backupKey=`${v.wordKey}|pre-finalize-${Date.now()}`;await putDocBlob(backupKey,blob);v.preFinalizationBackupKey=backupKey;v.preFinalizationBackupAt=nowBR();
   await putDocBlob(v.wordKey,approved);
   v.approvalEmbedded=true;v.approvalEmbeddedAt=nowBR();v.institutionalRevision=v.preparedInstitutionalRevision;v.institutionalRevisionDate=todayISO();v.confirmedFinalPages=Number(pages);v.docxIntegrityValidated=true;v.docxIntegrityValidatedAt=nowBR();return {updated:true,institutionalRevision:v.preparedInstitutionalRevision,validity:v.institutionalValidity||"",pages:Number(pages)};
 }catch(err){console.error("Falha ao confirmar paginação do Word preparado",err);return {updated:false,reason:"docx-page-confirmation-failed",detail:err.message}}
}
'''
s=s[:start]+newfn+s[end:]
s=s.replace('siash-0.14.18','siash-0.14.19')
p.write_text(s,encoding='utf-8')

pp=Path('package.json'); data=json.loads(pp.read_text(encoding='utf-8')); data['version']='0.14.19'; pp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for fn in ['index.html','server.js']:
 q=Path(fn); t=q.read_text(encoding='utf-8'); t=t.replace('0.14.18','0.14.19'); q.write_text(t,encoding='utf-8')
print('v0.14.19 patch applied')

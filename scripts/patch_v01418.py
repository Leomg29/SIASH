from pathlib import Path
import json
p=Path('app.js'); s=p.read_text(encoding='utf-8')
start=s.find('function removeProposalStatusParagraphs(xml){')
if start<0: raise SystemExit('removeProposalStatusParagraphs not found')
end=s.find('\nfunction ',start+10)
if end<0: raise SystemExit('function boundary not found')
new=r'''function removeProposalStatusParagraphs(xml){
 let changed=false;let out=String(xml||"").replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{const text=xmlPlainText(p);const proposal=/^proposta\s+de\s+revis[aã]o\s+\d{1,3}\b/i.test(text)&&/(vig[eê]ncia|valida[cç][aã]o|publica[cç][aã]o|confer[eê]ncia)/i.test(text);if(proposal){changed=true;return "<w:p/>"}return p});const structural=ensureWordTableCellParagraphs(out);out=structural.xml;return {xml:out,changed:changed||structural.changed};
}
function finalizePublishedHistoryStatusXml(xml,institutionalRevision){
 const hist=historyTableData(xml);if(!hist)return {xml:String(xml||""),changed:false};const wanted=Number(institutionalRevision);let changed=false;const rows=hist.rows||[];let table=hist.table;
 for(const row of rows){const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>x[0]);if(!cells.length)continue;const rev=Number((xmlPlainText(cells[0]).match(/\d{1,3}/)||[])[0]);if(!Number.isFinite(rev)||rev!==wanted)continue;let updated=row;updated=updated.replace(/aguardando\s+confer[eê]ncia\s+profissional\.?/gi,()=>{changed=true;return 'validada e publicada após conferência profissional.'});if(updated!==row)table=table.replace(row,updated);break}
 if(!changed)return {xml:String(xml||""),changed:false};return {xml:String(xml||"").replace(hist.table,table),changed:true};
}'''
s=s[:start]+new+s[end:]
needle='const statusClean=removeProposalStatusParagraphs(xml);xml=statusClean.xml;zip.file("word/document.xml",xml);'
repl='const statusClean=removeProposalStatusParagraphs(xml);xml=statusClean.xml;const historyClean=finalizePublishedHistoryStatusXml(xml,v.preparedInstitutionalRevision);xml=historyClean.xml;zip.file("word/document.xml",xml);'
if needle not in s: raise SystemExit('finalization chain not found')
s=s.replace(needle,repl,1).replace('siash-0.14.17','siash-0.14.18')
p.write_text(s,encoding='utf-8')
pp=Path('package.json'); data=json.loads(pp.read_text()); data['version']='0.14.18'; pp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for fn in ['index.html','server.js']:
 q=Path(fn)
 if q.exists(): q.write_text(q.read_text(encoding='utf-8').replace('v0.14.17','v0.14.18').replace('0.14.17','0.14.18'),encoding='utf-8')

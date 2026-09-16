const fs=require('fs');
const s=fs.readFileSync('app.js','utf8');
const must=[
 'validateDocxBlobIntegrity',
 'checkCRC32:true',
 'finalizePublishedHistoryStatusXmlSafe',
 'docx-final-validation-failed',
 'preFinalizationBackupKey',
 'docxIntegrityValidated=true'
];
for(const x of must){if(!s.includes(x)){console.error('missing safeguard:',x);process.exit(1)}}
if(!s.includes('await validateDocxBlobIntegrity(approved)')){console.error('final blob is not validated');process.exit(1)}
if(!s.includes('await putDocBlob(backupKey,blob)')){console.error('pre-finalization backup missing');process.exit(1)}
console.log('v0.14.19 static regression assertions: OK');

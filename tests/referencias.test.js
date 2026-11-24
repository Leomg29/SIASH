"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const references = require("../lib/referencias");

const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${run(text)}</w:p>`;
const documentXml = body => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${namespace}"><w:body>${body}</w:body></w:document>`;
const table = contents => `<w:tbl><w:tr><w:tc>${contents}</w:tc></w:tr></w:tbl>`;
const textbox = contents => `<w:p><w:r><w:pict><w:txbxContent>${contents}</w:txbxContent></w:pict></w:r></w:p>`;
const documentPart = "word/document.xml";

function makeZip(xml, extra = {}) {
  const zip = new AdmZip();
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    [documentPart]: xml,
    ...extra
  };
  for (const [name, value] of Object.entries(parts)) zip.addFile(name, Buffer.from(value));
  return zip.toBuffer();
}

const readXml = buffer => new AdmZip(buffer).readAsText(documentPart);
const locate = body => references.localizarSecaoReferencias(documentXml(body));
const appendOptions = { allowHygieneOnly: true };
const fixtureReference = { title: "Publicação sintética de teste automatizado", url: "https://example.test/works/fixture", wordEligible: true };
const blocks = [
  ["function docxCrc32", "async function convertLegacyDocBufferToDocx"],
  ["function xmlDecode", "function extractManagedReferenceTexts"],
  ["function extractManagedReferenceTexts", "function comparisonNormalizedText"],
  ["function comparisonNormalizedText", "function verifyDocxRevision"]
];
let providerCalls = 0;
function externalCall() {
  providerCalls++;
  throw new Error("Chamada externa durante teste");
}
const logs = [];
const runtime = vm.createContext({
  ...references, AdmZip, Buffer, TextDecoder, URL, path: require("node:path"), fetch: externalCall,
  console: { warn: line => logs.push(line) },
  classifyReferenceUrls: externalCall,
  docsGuard: require("../docs-governance-integrity.cjs"),
  crypto,
  docPermission: async () => true
});
for (const [from, to] of blocks) {
  const start = source.indexOf(from), end = source.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `Trecho ausente: ${from}`);
  vm.runInContext(source.slice(start, end), runtime);
}
const append = (buffer, refs = []) => runtime.appendReviewedReferences(buffer, refs, appendOptions);

test("01 Referências em Título 1", () => {
  const found = locate(para("Referências", "Título1"));
  assert.equal(found.status, "found");
  assert.equal(found.criterios.estilo, 35);
  assert.equal(found.criterios.total, 105);
});
test("02 REFERÊNCIAS em texto comum", () => assert.equal(locate(para("REFERÊNCIAS")).status, "found"));
test("03 Numeração arábica e hierárquica", () => {
  assert.equal(locate(para("8.2.3 — REFERÊNCIAS NORMATIVAS")).status, "found");
});
test("04 Numeração romana", () => assert.equal(locate(para("VIII) Bibliografia")).status, "found"));
test("05 Referências em tabela", () => assert.equal(locate(table(para("Referências"))).status, "found"));
test("06 Somente caixa de texto", () => {
  const found = locate(textbox(para("Referências")));
  assert.equal(found.status, "not_found");
  assert.equal(found.descartados[0].motivo, "text_box");
});
test("07 Sumário por estilo e título no corpo", () => {
  assert.equal(locate(para("Referências", "TOC1") + para("Referências")).indice, 1);
  const simple = '<w:fldSimple w:instr=" TOC \\o ">' + para("Referências", "Heading1") + "</w:fldSimple>";
  assert.equal(locate(simple + para("Referências")).indice, 1);
});
test("08 Runs fragmentadas, NFC, NBSP, tab e largura zero", () => {
  const p = "<w:p>" + run("Refe\u200Br") + run("e\u0302ncias\u00a0") + '<w:r><w:tab/></w:r>' + run("bibliográficas") + "</w:p>";
  assert.equal(locate(p).status, "found");
});
test("09 Ausência total e cabeçalhos e rodapés fora do corpo", () => {
  assert.equal(locate(para("Texto sintético")).status, "not_found");
  for (const part of ["hdr", "ftr"]) {
    const xml = `<w:${part} xmlns:w="${namespace}">${para("Referências")}</w:${part}>`;
    assert.equal(references.localizarSecaoReferencias(xml).status, "not_found");
  }
});
test("10 Dois candidatos equivalentes", () => {
  const body = para("Introdução") + para("Texto") + para("Referências") + para("Bibliografia");
  assert.equal(locate(body).status, "ambiguous");
  const result = append(makeZip(documentXml(body)), [fixtureReference]);
  assert.match(readXml(result.buffer), /A CONFERIR/);
  assert.equal(JSON.parse(logs.at(-1)).reason, "ambiguous");
});
test("11 Fallback repetido, dentro do corpo antes de sectPr", () => {
  const existing = para("Referência institucional anterior");
  const original = makeZip(documentXml(existing + "<w:sectPr/>"));
  const first = append(original, [fixtureReference]);
  const repeated = append(first.buffer, [fixtureReference]);
  assert.deepEqual(repeated.buffer, first.buffer);
  const xml = readXml(repeated.buffer);
  assert.equal(xml.split(references.MARCADOR).length, 2);
  assert.ok(xml.includes(existing));
  assert.ok(xml.indexOf(references.MARCADOR) < xml.indexOf("<w:sectPr/>"));
  assert.ok(!xml.includes(fixtureReference.url));
  assert.deepEqual(JSON.parse(logs.at(-1)), { event: "docx_bibliography_pending_review", reason: "not_found" });
});
test("12 SHA-256 do original preservado", () => {
  const original = makeZip(documentXml(para("Texto original")));
  const hash = () => crypto.createHash("sha256").update(original).digest("hex");
  const before = hash();
  assert.notDeepEqual(append(original).buffer, original);
  assert.equal(hash(), before);
});

async function publish(buffer, metadata = {}) {
  const versions = [
    { revision: "01", workflow: "Vigente" },
    { revision: "02", workflow: "Aguardando aprovação", wordKey: "synthetic", publicationPrepared: true,
      approvalEmbedded: true, docxIntegrityValidated: true, createdBy: "editor", ...metadata }
  ];
  const queries = [];
  runtime.auth = () => {};
  runtime.pool = { connect: async () => ({
    query: async sql => {
      queries.push(sql);
      if (sql.includes("SELECT payload")) return { rows: [{ payload: { state: { docs: [{ id: "synthetic", versions }] } }, revision: 1 }] };
      if (sql.includes("SELECT file_data")) return { rows: [{ file_data: buffer }] };
      if (sql.includes("SELECT sha256")) return { rows: [{ sha256: crypto.createHash("sha256").update(buffer).digest("hex") }] };
      return { rows: [] };
    },
    release() {}
  }) };
  let responseStatus, responseBody;
  const res = { status(code) { responseStatus = code; return this; }, json(value) { responseBody = value; return this; } };
  runtime.app = { post(path, auth, handler) { this.handler = handler; } };
  const start = source.indexOf('app.post("/api/docs/publish"'), end = source.indexOf('app.get("/api/doc/:key"', start);
  vm.runInContext(source.slice(start, end), runtime);
  await runtime.app.handler({ user: { u: "approver", r: "owner" }, body: {
    doc_id: "synthetic", revision: "02", base_revision: 1, technical_confirmation: true, ...metadata
  } }, res);
  return { responseStatus, responseBody, versions, queries };
}
function assertPublicationBlocked(result, code) {
  assert.equal(result.responseStatus, 422);
  assert.equal(result.responseBody.code, code);
  assert.equal(result.versions[0].workflow, "Vigente");
  assert.equal(result.versions[1].workflow, "Aguardando aprovação");
  assert.ok(result.queries.includes("ROLLBACK"));
  assert.ok(!result.queries.some(sql => /^(?:UPDATE|INSERT|COMMIT)/.test(sql)));
}

test("13 Backend bloqueia marcador fragmentado no DOCX armazenado", async () => {
  const p = "<w:p>" + run("[REFERÊN") + run("CIAS A CONFERIR]") + "</w:p>";
  assertPublicationBlocked(await publish(makeZip(documentXml(p))), "DOC_BIBLIOGRAPHY_PENDING");
});
test("14 XML inválido é rejeitado de maneira controlada", async () => {
  const xml = documentXml("<w:p></w:r>");
  const found = references.localizarSecaoReferencias(xml);
  assert.equal(found.status, "not_found");
  assert.equal(found.descartados[0].motivo, references.XML_ERROR);
  assert.throws(() => append(makeZip(xml)), /DOCX_XML_INVALID/);
  const malformed = documentXml('<w:p x:y="1"/>');
  assertPublicationBlocked(await publish(makeZip(malformed)), "DOC_BIBLIOGRAPHY_UNREADABLE");
  for (const invalid of [
    documentXml(para("&unknown;")), documentXml('<w:p w:id="1" w:id="2"/>'),
    documentXml("<w:p>\u0000</w:p>"), documentXml("<w:p/><!--a--b-->"),
    documentXml("<w:sectPr/><w:p/>"), documentXml("<w:sdt>".repeat(257) + "</w:sdt>".repeat(257)),
    documentXml("<w:p/>").replace("<?xml", "<!DOCTYPE w:document><?xml")
  ]) {
    assert.throws(() => append(makeZip(invalid)), /DOCX_XML_INVALID/);
  }
});
test("Protege títulos bibliográficos e institucionais de alterações da IA", () => {
  const headings = ["VIII) Referências Técnicas", "3.2 — Bibliografia", "IV. RESULTADOS ESPERADOS", "Anexos"];
  for (const heading of headings) {
    assert.equal(runtime.institutionalStructureProtectedText(heading), true);
    const document = makeZip(documentXml(para(heading)));
    assert.throws(() => runtime.patchDocx(document, [{ paragraph_index: 0, new_text: "Alterado" }]), /DOCX_PARAGRAPH_NOT_EDITABLE/);
  }
});
test("Índices compartilhados entre localizador, edição e montagem com tabela, vazio e caixa de texto", () => {
  const headline = "<w:p>" + run("8. Refe") + run("rências") + "</w:p>";
  const editable = para("Obra sintética anterior");
  const box = textbox(para("Referências"));
  const body = "<w:p/>" + box + table(headline + editable) + para("Anexos");
  const xml = documentXml(body);
  const original = makeZip(xml);
  const index = references.localizarSecaoReferencias(xml).indice;
  assert.equal(index, 3);
  assert.equal(runtime.docxParagraphs(original).find(p => p.index === index).text, "8. Referências");
  const paragraphs = references.inspectWordXml(xml).paragraphs;
  assert.deepEqual(paragraphs.map(p => [p.index, p.text]), [[0, ""], [1, ""], [2, "Referências"], [3, "8. Referências"], [4, "Obra sintética anterior"], [5, "Anexos"]]);
  assert.equal(xml.slice(paragraphs[4].start, paragraphs[4].end), editable);
  const patched = runtime.patchDocx(original, [{ paragraph_index: 4, new_text: "Texto alterado" }]);
  assert.equal(readXml(patched), xml.replace(editable, para("Texto alterado")));
  assert.throws(() => runtime.patchDocx(original, [{ paragraph_index: 2, new_text: "Alterado" }]), /DOCX_PARAGRAPH_NOT_EDITABLE/);
  assert.throws(() => runtime.patchDocx(original, [{ paragraph_index: 5, new_text: "Alterado" }]), /DOCX_PARAGRAPH_NOT_EDITABLE/);
  const result = append(original, [fixtureReference]);
  const bibliography = readXml(result.buffer).match(/<w:tc>(.*?)<\/w:tc>/s)[1];
  assert.ok(bibliography.startsWith(headline + editable));
  assert.equal(readXml(result.buffer).replace(bibliography, headline + editable), xml);
  assert.equal(readXml(result.buffer).split(fixtureReference.url).length, 2);
  assert.equal(result.sectionHeadingIndex, index);
  assert.equal(runtime.verifiedReferencePlacement(result, result.buffer), "bibliography_section_verified");
});
test("Exclui campo TOC complexo com instrução fragmentada, incluindo múltiplos parágrafos", () => {
  const field = type => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
  const code = text => `<w:r><w:instrText>${text}</w:instrText></w:r>`;
  const toc = "<w:p>" + field("begin") + code(" TO") + code("C \\o ") + field("separate") + "</w:p>" +
    para("Referências", "Heading1") + "<w:p>" + field("end") + "</w:p>";
  assert.equal(locate(toc + para("Referências")).indice, 3);
});
test("Preserva estrutura do DOCX, partes não editadas e parada antes do anexo", () => {
  const old = para("1. Obra institucional");
  const annex = table(para("Anexos") + para("Texto de anexo"));
  const xml = documentXml(para("Referências") + old + annex + "<w:sectPr/>");
  const header = `<w:hdr xmlns:w="${namespace}">${para("Cabeçalho sintético")}</w:hdr>`;
  const result = append(makeZip(xml, { "word/header1.xml": header }), [fixtureReference]);
  const revised = new AdmZip(result.buffer);
  assert.equal(revised.readAsText("word/header1.xml"), header);
  assert.ok(revised.readAsText(documentPart).includes(old));
  assert.ok(revised.readAsText(documentPart).endsWith(annex + "<w:sectPr/></w:body></w:document>"));
  assert.equal(result.added, 1);
});
test("referencePlacement nunca verificado no fallback ou sem operação", () => {
  const original = makeZip(documentXml(para("Texto")));
  const result = append(original);
  assert.equal(runtime.verifiedReferencePlacement(result, result.buffer), "bibliography_pending_review");
  assert.equal(runtime.verifiedReferencePlacement({}, original), "bibliography_pending_review");
  assert.throws(() => runtime.verifiedReferencePlacement(result, original), /DOCX_BIBLIOGRAPHY_MARKER_LOST/);
});
test("Publicação bloqueada mesmo quando interface alega verificação", async () => {
  const result = await publish(makeZip(documentXml(para(references.MARCADOR))), {
    aiVerification: { referencePlacement: "bibliography_section_verified" }, aiVerified: true, aiReferences: []
  });
  assertPublicationBlocked(result, "DOC_BIBLIOGRAPHY_PENDING");
});
test("Backend aceita DOCX sintético sem pendência, com auditoria transacional", async () => {
  const result = await publish(makeZip(documentXml(para("Conteúdo sintético"))));
  assert.equal(result.responseBody.ok, true);
  assert.equal(result.versions[0].workflow, "Obsoleto");
  assert.equal(result.versions[1].workflow, "Vigente");
  assert.ok(result.queries.some(sql => sql.startsWith("INSERT INTO siash_doc_publication_audit")));
  assert.equal(result.queries.at(-1), "COMMIT");
});
test("Resolução de prefixos, entidades numéricas e comentários preserva offsets", () => {
  const xml = documentXml("<w:p>" + run("Re<!-- ignorar -->fer&#xEA;ncias") + "</w:p>")
    .replaceAll("w:", "word:").replace("xmlns:w=", "xmlns:word=");
  assert.equal(references.localizarSecaoReferencias(xml).texto, "Referências");
  const result = append(makeZip(xml), [fixtureReference]);
  assert.match(readXml(result.buffer), /Re<!-- ignorar -->fer&#xEA;ncias/);
  assert.equal(result.added, 1);
});
test("Cabeçalho bibliográfico excluído por controle de alterações", () => {
  const body = "<w:del>" + para("Referências", "Heading1") + "</w:del>" + para("Bibliografia");
  assert.equal(locate(body).indice, 1);
  const p = "<w:p><w:del><w:r><w:delText>Referências</w:delText></w:r></w:del></w:p>";
  assert.equal(locate(p).status, "not_found");
});
test("AlternateContent gera pendência e preserva ambos os ramos", () => {
  const ac = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w">' +
    para("Bibliografia") + "</mc:Choice><mc:Fallback>" + para("Referências") + "</mc:Fallback></mc:AlternateContent>";
  const xml = documentXml(ac + para("Referências"));
  assert.equal(references.localizarSecaoReferencias(xml).status, "ambiguous");
  const result = append(makeZip(xml), [fixtureReference]);
  assert.equal(result.referencePlacement, "bibliography_pending_review");
  assert.ok(readXml(result.buffer).includes(ac));
});
test("Estilo TOC herdado é excluído e estilo irresolvido gera ambiguidade", () => {
  const inherited = para("Referências", "CustomToc");
  const body = inherited + para("Bibliografia");
  const styles = `<w:styles xmlns:w="${namespace}"><w:style w:type="paragraph" w:styleId="CustomToc"><w:basedOn w:val="TOC1"/></w:style></w:styles>`;
  assert.equal(locate(body).status, "ambiguous");
  const result = append(makeZip(documentXml(body), { "word/styles.xml": styles }), [fixtureReference]);
  assert.equal(result.sectionHeadingIndex, 1);
  assert.equal(result.referencePlacement, "bibliography_section_verified");
});
test("A referência é inserida na célula do título em tabela aninhada", () => {
  const inner = table(para("Referências"));
  const xml = documentXml(table(inner + para("Texto fora da célula interna")));
  const result = append(makeZip(xml), [fixtureReference]);
  assert.ok(readXml(result.buffer).indexOf(fixtureReference.url) < readXml(result.buffer).indexOf("</w:tc>"));
});
test("Marcador em rodapé com nome personalizado é inspecionado pela relação OPC", async () => {
  const rel = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="stories/custom.xml"/></Relationships>';
  const file = `<w:ftr xmlns:w="${namespace}">${para(references.MARCADOR)}</w:ftr>`;
  const result = await publish(makeZip(documentXml(para("Texto")), {
    "word/_rels/document.xml.rels": rel, "word/stories/custom.xml": file
  }));
  assertPublicationBlocked(result, "DOC_BIBLIOGRAPHY_PENDING");
});
test("Remover só o marcador não satisfaz a validação científica do Word", async () => {
  const result = await publish(makeZip(documentXml(para("Referências") + para("Obra incompleta"))), {
    aiReferences: [{ title: "Fonte sintética", url: "https://pubmed.ncbi.nlm.nih.gov/123456/" }]
  });
  assert.equal(result.responseStatus, 422);
  assert.equal(result.responseBody.error, "DOC_SCIENTIFIC_REFERENCES_NOT_IN_DOCX");
  assert.equal(result.versions[0].workflow, "Vigente");
  assert.ok(result.queries.includes("ROLLBACK"));
});
test("Parte principal OPC inesperada e fonte presente apenas como substring são rejeitadas", async () => {
  const root = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/other.xml"/></Relationships>';
  assertPublicationBlocked(await publish(makeZip(documentXml(para("Texto")), {
    "_rels/.rels": root, "word/other.xml": documentXml(para(references.MARCADOR))
  })), "DOC_BIBLIOGRAPHY_UNREADABLE");
  const url = "https://pubmed.ncbi.nlm.nih.gov/123456/";
  const result = await publish(makeZip(documentXml(para("Referências") + para("https://example.test/?ref=" + url))), {
    aiReferences: [{ title: "Fonte sintética", url }]
  });
  assert.equal(result.responseStatus, 422);
  assert.equal(result.responseBody.error, "DOC_SCIENTIFIC_REFERENCES_NOT_IN_DOCX");
});

test("Limpeza não remove quebras de seção incorporadas a parágrafos", () => {
  const protectedParagraph = "<w:p><w:pPr><w:sectPr/></w:pPr>" +
    run("Texto protegido pela quebra de seção") + "</w:p>";
  const xml = documentXml(protectedParagraph);
  const file = makeZip(xml);
  assert.equal(readXml(runtime.removeDocxParagraphs(file, [0])), xml);
  const bibliography = makeZip(documentXml(para("Referências") +
    protectedParagraph.replace("Texto protegido pela quebra de seção", "Disponível em: https://example.test/")));
  assert.throws(() => append(bibliography, [fixtureReference]), /DOCX_BIBLIOGRAPHY_PROTECTED_STRUCTURE/);
});

test("Nenhuma chamada a provedores externos", () => assert.equal(providerCalls, 0));

test("API real e PostgreSQL isolado: rollback para pendência e arquivo não inspecionável", {
  skip: process.env.SIASH_ISOLATED_CI !== "1", timeout: 20000
}, async () => {
  const dbUrl = "postgres://siash_ci:siash_ci@127.0.0.1:5432/siash_ci";
  assert.equal(process.env.DATABASE_URL, dbUrl);
  const { spawn } = require("node:child_process");
  const { once } = require("node:events");
  const { setTimeout: delay } = require("node:timers/promises");
  const { Pool } = require("pg");
  const port = "18961";
  const base = "http://127.0.0.1:" + port;
  const secret = "synthetic-reference-test-secret-at-least-32";
  const child = spawn(process.execPath, ["server.js"], {
    env: { PATH: process.env.PATH, PORT: port, JWT_SECRET: secret, DATABASE_URL: dbUrl, PGSSLMODE: "disable" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stopped = once(child, "exit");
  const db = new Pool({ connectionString: dbUrl, ssl: false });
  const key = "synthetic-reference-" + crypto.randomUUID();
  let previous;
  let logs = "";
  child.stdout.on("data", data => { logs += data; });
  child.stderr.on("data", data => { logs += data; });
  try {
    let ready = false;
    for (let i = 0; i < 100 && child.exitCode === null; i++) {
      try { ready = (await fetch(base + "/api/health")).ok; } catch {}
      if (ready) break;
      await delay(50);
    }
    assert.ok(ready, logs);
    await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'owner')", [key, "synthetic"]);
    previous = (await db.query("SELECT payload,revision,updated_at,updated_by FROM siash_state WHERE id=1")).rows[0];
    const wordKey = key + "|word";
    const validKey = key + "|valid";
    const invalidKey = key + "|invalid";
    const bareKey = key + "|bare";
    const versions = [
      { revision: "01", workflow: "Vigente", wordKey: validKey },
      { revision: "02", workflow: "Aguardando aprovação", wordKey, publicationPrepared: true,
        approvalEmbedded: true, docxIntegrityValidated: true, createdBy: "editor",
        aiVerification: { referencePlacement: "bibliography_section_verified" } }
    ];
    const cases = [
      [wordKey, makeZip(documentXml("<w:p>" + run("[REFERÊN") + run("CIAS A CONFERIR]") + "</w:p>")), "DOC_BIBLIOGRAPHY_PENDING"],
      [invalidKey, makeZip(documentXml('<w:p unknown:attribute="1"/>')), "DOC_BIBLIOGRAPHY_UNREADABLE"],
      [bareKey, makeZip(documentXml(para("Referências") + para("Obra sintética sem fonte"))), "DOC_SCIENTIFIC_REFERENCES_NOT_IN_DOCX"]
    ];
    const valid = makeZip(documentXml(para("Vigente sintético")));
    for (const [docKey, file] of [[validKey, valid], ...cases]) {
      await db.query("INSERT INTO siash_documents(doc_key,file_name,file_data) VALUES($1,'synthetic.docx',$2)", [docKey, file]);
    }
    const token = require("jsonwebtoken").sign({ u: key }, secret);
    for (const [docKey, , expected] of cases) {
      versions[1].wordKey = docKey;
      if (docKey === bareKey) versions[1].aiReferences = [{ title: "Fonte sintética", url: "https://pubmed.ncbi.nlm.nih.gov/123456/" }];
      const payload = { state: { docs: [{ id: key, versions }] } };
      await db.query("INSERT INTO siash_state(id,payload,revision) VALUES(1,$1,27) ON CONFLICT(id) DO UPDATE SET payload=$1,revision=27", [payload]);
      const response = await fetch(base + "/api/docs/publish", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ doc_id: key, revision: "02", base_revision: 27, technical_confirmation: true,
          aiVerification: { referencePlacement: "bibliography_section_verified" } })
      });
      const body = await response.json();
      assert.equal(response.status, 422, JSON.stringify(body));
      assert.equal(body.code || body.error, expected);
      const state = (await db.query("SELECT payload,revision FROM siash_state WHERE id=1")).rows[0];
      assert.equal(Number(state.revision), 27);
      assert.deepEqual(state.payload, payload);
      assert.deepEqual((await db.query("SELECT file_data FROM siash_documents WHERE doc_key=$1", [validKey])).rows[0].file_data, valid);
      assert.equal((await db.query("SELECT 1 FROM siash_doc_publication_audit WHERE doc_id=$1", [key])).rowCount, 0);
    }
  } finally {
    try {
      await db.query("DELETE FROM siash_documents WHERE doc_key LIKE $1", [key + "|%"]);
      await db.query("DELETE FROM siash_users WHERE username=$1", [key]);
      if (previous) await db.query("UPDATE siash_state SET payload=$1,revision=$2,updated_at=$3,updated_by=$4 WHERE id=1",
        [previous.payload, previous.revision, previous.updated_at, previous.updated_by]);
      else await db.query("DELETE FROM siash_state WHERE id=1 AND payload->'state'->'docs'->0->>'id'=$1", [key]);
    } finally {
      await db.end();
      if (child.exitCode === null) child.kill();
      await stopped;
    }
  }
});

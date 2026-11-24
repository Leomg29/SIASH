const assert = require("node:assert/strict");
const fs = require("node:fs");
const { localizarSecaoReferencias } = require("../lib/referencias");
const { version } = require("../package.json");

const locate = (...titles) => localizarSecaoReferencias(
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  titles.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("") + "</w:body></w:document>"
);
for (const title of ["Referências Bibliográficas", "Referências Técnicas", "Referências Normativas"]) {
  assert.equal(locate(title).status, "found");
}
assert.equal(locate("8.2 — REFE\u200BRE\u0302NCIAS\u00a0BIBLIOGRÁFICAS").status, "found");
assert.equal(locate("Uma frase com referências consultadas.").status, "not_found");
assert.equal(locate("Introdução", "Objetivo", "Referências", "Bibliografia").status, "ambiguous");
assert.match(version, /^0\.14\.\d+$/);
const html = fs.readFileSync("index.html", "utf8");
assert.ok(html.split("v" + version).length >= 3, "UI version not updated");
console.log("reference heading safety OK on v" + version);

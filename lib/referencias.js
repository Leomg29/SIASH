"use strict";

const MARCADOR = "[REFERÊNCIAS A CONFERIR]";
const XML_ERROR = "DOCX_XML_INVALID";
const REL_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
const MC_NAMESPACE = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const TOC_STYLE = /^(?:toc|sumario)/;
const HEADING_STYLE = /^(?:heading|titulo)\s*[1-9]$/;
const RETAIN_PARAGRAPH = new Set([
  "sectPr", "drawing", "object", "pict", "fldSimple", "fldChar", "bookmarkStart", "bookmarkEnd",
  "commentRangeStart", "commentRangeEnd", "commentReference", "footnoteReference", "endnoteReference"
]);
const WORD_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main"
]);

function invalidXml() {
  throw new Error(XML_ERROR);
}

function normalizeHeading(text = "") {
  return text.normalize("NFC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function headingLabel(text) {
  return normalizeHeading(text).replace(/^[•●▪◦\-–—\s]+/, "")
    .replace(/^(?:\d+(?:\.\d+)*\s*(?:[-–—.):]\s*)?|[ivxlcdm]+(?:\s*[-–—.):]\s*|\s+))/i, "")
    .replace(/\s*[:.;-]$/, "").trim();
}

function isReferenceHeading(text) {
  return /^(?:referencias?(?: (?:bibliograficas?|tecnicas?|normativas?))?|bibliografia)$/.test(headingLabel(text));
}

function decodeXml(text) {
  return text.replace(/&(?:([^;\s<&]+);)?/g, (_, entity) => {
    const named = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (!/^#(?:\d+|x[\da-fA-F]+)$/.test(entity || "")) invalidXml();
    const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (code > 0x10ffff || !validXmlCharacters(String.fromCodePoint(code))) invalidXml();
    return String.fromCodePoint(code);
  });
}

function validXmlCharacters(text) {
  return !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(text);
}

// Restricted XML 1.0 reader for Word parts. No DTD or entity expansion, schema
// validation or markup compatibility branch selection. The package caller resolves
// Word story relationships and supplies paragraph styles. It retains source offsets so edits preserve untouched XML.
function inspectWordXml(xml, part = "document") {
  if (typeof xml !== "string" || xml.length > 32 * 1024 * 1024 || !validXmlCharacters(xml)) invalidXml();
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[\w:.\-]+(?:[^<>"']|"[^"<]*"|'[^'<]*')*>|[^<]+/gy;
  const name = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/;
  const attribute = /\s+([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
  const baseNamespaces = new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]);
  const stack = [], paragraphs = [], styles = new Map(), relationships = [];
  let fields = [];
  let defaultStyle = "", unsupportedLayout = false, hasExternalContent = false, deletedDepth = 0;
  let elements = 0;
  let cursor = xml.startsWith("\uFEFF") ? 1 : 0;
  const startOfXml = cursor;
  let root = false, body = null, paragraph = null, textboxDepth = 0, simpleToc = 0;
  const isToc = value => /^\s*TOC(?:\s|$)/i.test(value);
  const touchFields = p => {
    if (!p) return;
    if (simpleToc) p.toc = true;
    for (const field of fields) field.paragraphs.add(p);
  };
  const onClose = (element, end, closeStart) => {
    if (element.alternate && (!element.alternate.safe || !element.alternate.choices || !element.alternate.fallback)) {
      unsupportedLayout = true;
    }
    if (element.kind === "p") {
      element.paragraph.end = end;
      element.paragraph.text = element.paragraph.parts.join("").trim();
      element.paragraph.markerText = element.paragraph.markerParts.join("").trim();
      delete element.paragraph.parts;
      delete element.paragraph.markerParts;
      paragraph = element.previousParagraph;
    }
    if (element.kind === "body") body.end = closeStart;
    if (element.kind === "txbxContent") {
      if (fields.length) invalidXml();
      fields = element.outerFields;
      textboxDepth--;
    }
    if (element.deleted) deletedDepth--;
    if (element.simpleToc) simpleToc--;
    if (element.textRange) element.textRange.end = closeStart;
    if (element.kind === "instrText" && fields.length && !deletedDepth) {
      const field = fields.at(-1);
      if (field.instruction.length + element.content.length > 16384) invalidXml();
      field.instruction += element.content;
    }
  };
  while (cursor < xml.length) {
    token.lastIndex = cursor;
    const match = token.exec(xml);
    if (!match) invalidXml();
    const start = cursor, raw = match[0];
    cursor = token.lastIndex;
    const parent = stack.at(-1);
    const enclosingAlternate = stack.findLast(e => e.alternate)?.alternate;
    if (raw.startsWith("<!--")) {
      if (raw.slice(4, -3).includes("--") || raw.endsWith("--->")) invalidXml();
      continue;
    }
    if (raw.startsWith("<?")) {
      if (start !== startOfXml || !/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])UTF-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/i.test(raw)) invalidXml();
      continue;
    }
    if (!raw.startsWith("<") || raw.startsWith("<![CDATA[")) {
      const cdata = raw.startsWith("<!");
      if ((!parent || ["document", "body"].includes(parent.kind)) &&
          (cdata || /[^ \t\r\n]/.test(raw))) invalidXml();
      if (!cdata && raw.includes("]]>")) invalidXml();
      const value = cdata ? raw.slice(9, -3) : decodeXml(raw);
      if (enclosingAlternate && value.trim()) enclosingAlternate.safe = false;
      if (["t", "delText"].includes(parent?.kind) && paragraph) {
        if (!deletedDepth) paragraph.parts.push(value);
        paragraph.markerParts.push(value);
      }
      if (parent?.kind === "instrText") parent.content += value;
      continue;
    }
    if (raw.startsWith("</")) {
      if (!parent || parent.qname !== raw.slice(2, -1).trim() || !/^<\/[\w:.\-]+\s*>$/.test(raw)) invalidXml();
      stack.pop();
      onClose(parent, cursor, start);
      continue;
    }
    const selfClosing = raw.endsWith("/>");
    const tag = raw.slice(1, selfClosing ? -2 : -1);
    const qname = tag.match(/^\S+/)?.[0];
    if (!name.test(qname) || ++elements > 500000 || stack.length >= 256 || ["t", "delText", "instrText"].includes(parent?.kind)) invalidXml();
    const attrs = new Map();
    let namespaces = parent?.namespaces || baseNamespaces;
    attribute.lastIndex = qname.length;
    let attr;
    while ((attr = attribute.exec(tag))) {
      const [, key, double, single] = attr;
      if (!name.test(key) || attrs.has(key)) invalidXml();
      attrs.set(key, decodeXml(double ?? single));
    }
    const rest = tag.slice(qname.length).replace(/\s+([\w:.\-]+)\s*=\s*(?:"[^"]*"|'[^']*')/gy, "");
    if (rest.trim()) invalidXml();
    for (const [key, value] of attrs) {
      if (key !== "xmlns" && !key.startsWith("xmlns:")) continue;
      if (namespaces === (parent?.namespaces || baseNamespaces)) namespaces = new Map(namespaces);
      const prefix = key === "xmlns" ? "" : key.slice(6);
      if (prefix === "xmlns" || (prefix === "xml") !== (value === baseNamespaces.get("xml")) ||
          value === "http://www.w3.org/2000/xmlns/" || (prefix && !value)) invalidXml();
      namespaces.set(prefix, value);
    }
    const resolve = (key, isAttribute = false) => {
      const [first, local] = key.split(":");
      const uri = local ? namespaces.get(first) : isAttribute ? "" : namespaces.get("");
      if (local && !uri) invalidXml();
      return [uri || "", local || first];
    };
    const [uri, local] = resolve(qname);
    const kind = WORD_NAMESPACES.has(uri) || (part === "Relationships" && uri === REL_NAMESPACE) ? local : "";
    const attrNames = new Set(), wordAttrs = new Map();
    for (const [key, value] of attrs) {
      if (key === "xmlns" || key.startsWith("xmlns:")) continue;
      const [attrUri, attrLocal] = resolve(key, true);
      const expanded = `${attrUri} ${attrLocal}`;
      if (attrNames.has(expanded)) invalidXml();
      attrNames.add(expanded);
      if (WORD_NAMESPACES.has(attrUri)) wordAttrs.set(attrLocal, value);
    }
    if (!parent) {
      if (root || kind !== part || (part === "document" && selfClosing)) invalidXml();
      root = true;
    }
    if (kind === "body") {
      if (part !== "document" || body || stack.length !== 1 || selfClosing) invalidXml();
      body = { end: null, finalSection: null, prefix: qname.includes(":") ? qname.split(":")[0] + ":" : "", uri };
    }
    if (parent?.kind === "body") {
      if (body.finalSection !== null) invalidXml();
      if (kind === "sectPr") body.finalSection = start;
    }
    const element = { qname, namespaces, kind, content: "", start };
    const previousSibling = parent?.lastChild;
    if (parent) parent.lastChild = { kind, start };
    if (kind === "tbl" || kind === "tc") {
      element.previous = previousSibling?.kind === kind ? previousSibling.start : null;
    }
    if (kind === "tbl" && parent?.kind === "tc") {
      element.parentCell = parent.start;
      element.previousParagraph = previousSibling?.kind === "p" ? previousSibling.start : null;
    }
    const isAlternate = uri === MC_NAMESPACE && local === "AlternateContent";
    const plainAttrs = [...attrs.keys()].filter(key => key !== "xmlns" && !key.startsWith("xmlns:"));
    if (enclosingAlternate) {
      // Only empty, inert runs can be proven equivalent without resolving the Word consumer.
      const directBranch = parent?.alternate === enclosingAlternate && uri === MC_NAMESPACE;
      if (directBranch && local === "Choice" && !enclosingAlternate.fallback) {
        const requires = (attrs.get("Requires") || "").trim().split(/\s+/);
        if (plainAttrs.length !== 1 || !requires.every(prefix => prefix && namespaces.has(prefix))) {
          enclosingAlternate.safe = false;
        }
        enclosingAlternate.choices++;
        element.alternateBranch = true;
      } else if (directBranch && local === "Fallback" && !enclosingAlternate.fallback && enclosingAlternate.choices) {
        if (plainAttrs.length) enclosingAlternate.safe = false;
        enclosingAlternate.fallback = true;
        element.alternateBranch = true;
      } else if (!(parent?.alternateBranch && kind === "r" && !plainAttrs.length)) {
        enclosingAlternate.safe = false;
      }
    }
    if (isAlternate) {
      element.alternate = { safe: !!paragraph && !enclosingAlternate && !plainAttrs.length &&
        (parent?.kind === "p" || parent?.kind === "r"), choices: 0, fallback: false };
      if (paragraph) {
        paragraph.alternateContent = true;
        paragraph.retainOnCleanup = true;
      }
    }
    if (part === "Relationships" && parent?.kind === "Relationships" && kind === "Relationship") {
      relationships.push({ type: attrs.get("Type") || "", target: attrs.get("Target") || "", mode: attrs.get("TargetMode") });
    }
    if (kind === "txbxContent") {
      textboxDepth++;
      element.outerFields = fields;
      fields = [];
    }
    if (kind === "del" || kind === "moveFrom") {
      deletedDepth++;
      element.deleted = true;
      if (paragraph) paragraph.hasDeletedContent = true;
    }
    if (kind === "altChunk") hasExternalContent = true;
    if (kind === "altChunk") unsupportedLayout = true;
    if (part === "styles" && parent?.kind === "styles" && kind === "style" && wordAttrs.get("type") === "paragraph") {
      const id = wordAttrs.get("styleId");
      if (!id || styles.has(id)) invalidXml();
      element.style = { base: "" };
      styles.set(id, element.style);
      if (["1", "true", "on"].includes(wordAttrs.get("default"))) {
        if (defaultStyle) invalidXml();
        defaultStyle = id;
      }
    }
    if (kind === "basedOn" && parent?.style) parent.style.base = wordAttrs.get("val") || "";
    if (kind === "fldSimple" && isToc(wordAttrs.get("instr") || "")) {
      element.simpleToc = true;
      simpleToc++;
    }
    if (kind === "p") {
      element.previousParagraph = paragraph;
      if (paragraph && !textboxDepth) invalidXml();
      if (paragraphs.length >= 100000) invalidXml();
      const cell = stack.findLast(e => e.kind === "tc");
      const table = stack.findLast(e => e.kind === "tbl");
      paragraph = { index: paragraphs.length, start, end: null, parts: [], markerParts: [], ranges: [], style: "", toc: false,
        body: part === "document" && stack.some(e => e.kind === "body") && !textboxDepth && !deletedDepth &&
          ["body", "tc", "sdtContent", "customXml", "ins", "moveTo"].includes(parent?.kind),
        textbox: textboxDepth > 0, hasDeletedContent: deletedDepth > 0, hasNestedParagraph: false,
        inCell: !!cell, cell: cell?.start, previousCell: cell?.previous,
        table: table?.start, previousTable: table?.previous,
        tableParentCell: table?.parentCell, tablePreviousParagraph: table?.previousParagraph, uri,
        prefix: qname.includes(":") ? qname.split(":")[0] + ":" : "" };
      if (element.previousParagraph) element.previousParagraph.hasNestedParagraph = true;
      paragraphs.push(paragraph);
      element.paragraph = paragraph;
    }
    touchFields(paragraph);
    if (paragraph && RETAIN_PARAGRAPH.has(kind)) paragraph.retainOnCleanup = true;
    if (paragraph && kind === "sectPr") paragraph.sectionBreak = true;
    if (kind === "pStyle" && parent?.kind === "pPr" && stack.at(-2)?.paragraph === paragraph && paragraph) {
      paragraph.style = wordAttrs.get("val") || "";
      if (TOC_STYLE.test(normalizeHeading(paragraph.style))) paragraph.toc = true;
    }
    if (kind === "fldChar" && paragraph && !deletedDepth) {
      const fieldType = wordAttrs.get("fldCharType");
      if (fieldType === "begin") {
        if (fields.length >= 32) invalidXml();
        const field = { instruction: "", paragraphs: new Set() };
        fields.push(field);
        touchFields(paragraph);
      }
      if (fieldType === "end") {
        const field = fields.pop();
        if (!field) invalidXml();
        if (isToc(field.instruction)) for (const p of field.paragraphs) p.toc = true;
      }
    }
    if (paragraph && kind === "t" && !selfClosing && !deletedDepth) {
      element.textRange = { start: cursor, end: null };
      paragraph.ranges.push(element.textRange);
    }
    if (paragraph && ["tab", "br", "cr"].includes(kind)) {
      if (!deletedDepth) paragraph.parts.push(" ");
      paragraph.markerParts.push(" ");
    }
    if (selfClosing) onClose(element, cursor, cursor);
    else stack.push(element);
  }
  if (stack.length || fields.length || !root || (part === "document" && body?.end == null)) invalidXml();
  if (unsupportedLayout) for (const p of paragraphs) p.unsupportedLayout = true;
  return { paragraphs, body, styles, defaultStyle, relationships, unsupportedLayout, hasExternalContent };
}

function applyParagraphStyles(paragraphs, { styles = new Map(), defaultStyle = "" } = {}) {
  for (const paragraph of paragraphs) {
    let id = paragraph.style || defaultStyle;
    const seen = new Set();
    while (id) {
      const label = normalizeHeading(id);
      if (TOC_STYLE.test(label)) {
        paragraph.toc = true;
        break;
      }
      if (seen.has(id) || seen.size >= 64 || (!styles.has(id) && label !== "normal" && !HEADING_STYLE.test(label))) {
        paragraph.unknownStyle = true;
        break;
      }
      if (HEADING_STYLE.test(label)) paragraph.headingStyle = true;
      seen.add(id);
      id = styles.get(id)?.base;
    }
  }
  return paragraphs;
}

function locateInParagraphs(paragraphs) {
  const discarded = [], candidates = [];
  let uncertain = paragraphs.some(p => p.unsupportedLayout);
  const body = paragraphs.filter(p => p.body);
  let position = 0;
  for (const p of paragraphs) {
    const late = p.body && position >= Math.ceil(body.length / 2);
    if (p.body) position++;
    if (!isReferenceHeading(p.text)) continue;
    if (!p.body || p.toc) {
      discarded.push({ indice: p.index, motivo: p.textbox ? "text_box" : !p.body ? "outside_body" : "toc" });
      continue;
    }
    if (p.unknownStyle || p.hasDeletedContent) {
      uncertain = true;
      discarded.push({ indice: p.index, motivo: p.unknownStyle ? "unresolved_style" : "tracked_change" });
      continue;
    }
    const headingStyle = p.headingStyle || HEADING_STYLE.test(normalizeHeading(p.style));
    const criterios = { texto: 40, corpo: 30, estilo: headingStyle ? 35 : 0, posicao: late ? 5 : 0 };
    criterios.total = criterios.texto + criterios.corpo + criterios.estilo + criterios.posicao;
    if (criterios.total >= 70) candidates.push({ indice: p.index, texto: p.text, estilo: p.style, criterios });
  }
  candidates.sort((a, b) => b.criterios.total - a.criterios.total);
  const [best, next] = candidates;
  if (!uncertain && best && best.criterios.total !== next?.criterios.total) {
    return { status: "found", ...best, descartados: discarded };
  }
  if (uncertain) discarded.push({ indice: null, motivo: "unsupported_bibliography_layout" });
  if (best && best.criterios.total === next?.criterios.total) {
    for (const candidate of candidates.filter(p => p.criterios.total === best.criterios.total)) {
      discarded.push({ indice: candidate.indice, motivo: "score_tie" });
    }
  }
  return { status: best || uncertain ? "ambiguous" : "not_found", indice: null, texto: null, estilo: null,
    criterios: best?.criterios ?? { texto: 0, corpo: 0, estilo: 0, posicao: 0, total: 0 }, descartados: discarded };
}

function localizarSecaoReferencias(documentXml) {
  try {
    return locateInParagraphs(applyParagraphStyles(inspectWordXml(documentXml).paragraphs));
  } catch (error) {
    if (error.message !== XML_ERROR) throw error;
    const result = locateInParagraphs([]);
    result.descartados.push({ indice: null, motivo: XML_ERROR });
    return result;
  }
}

function hasPendingMarker(paragraphs) {
  return paragraphs.some(p => [p.text, p.markerText].some(text =>
    typeof text === "string" && normalizeHeading(text).includes(normalizeHeading(MARCADOR))));
}

module.exports = { MARCADOR, XML_ERROR, decodeXml, headingLabel, inspectWordXml, isReferenceHeading,
  localizarSecaoReferencias, locateInParagraphs, applyParagraphStyles, hasPendingMarker };

/* SIASH — regras puras do Censo Neonatal / PIPA.
 * Sem acesso a DOM, localStorage, banco ou rede.
 * Datas de eventos exigem ISO 8601 com fuso explícito (ex.: 2026-11-08T00:00:00-03:00).
 * Censo da competência D: fotografia às 00:00:00 do dia D, horário de Pirapora (UTC-03).
 * Esta biblioteca NÃO substitui os lançamentos históricos nem altera indicadores existentes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIASH_CENSO = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const OFFSET_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  function instant(value) {
    if (typeof value !== "string" || !OFFSET_TIME.test(value) || !Number.isFinite(Date.parse(value)))
      throw new Error("Data/hora inválida ou sem fuso explícito");
    return Date.parse(value);
  }
  function midnight(date) {
    if (typeof date !== "string" || !DATE.test(date)) throw new Error("Data de censo inválida");
    const ms = Date.parse(date + "T00:00:00-03:00");
    if (!Number.isFinite(ms) || new Date(ms + 3 * 3600000).toISOString().slice(0, 10) !== date)
      throw new Error("Data de censo inexistente");
    return ms;
  }
  function assertAdmission(row) {
    if (!row || typeof row !== "object" || !row.id || !row.admittedAt || !row.originMunicipality)
      throw new Error("Internação sem ID, admissão ou município de origem");
    instant(row.admittedAt);
    if (row.discharge) {
      if (!row.discharge.id || !row.discharge.at || !["Alta", "Transferência", "Óbito"].includes(row.discharge.type))
        throw new Error("Saída incompleta");
      if (instant(row.discharge.at) < instant(row.admittedAt)) throw new Error("Saída anterior à admissão");
      if (row.discharge.pipaReferred && row.discharge.type !== "Alta")
        throw new Error("PIPA somente após alta");
    }
    return row;
  }
  function censusAtMidnight(admissions, date) {
    const at = midnight(date);
    const seen = new Set();
    return admissions.filter(row => {
      assertAdmission(row);
      if (seen.has(row.id)) throw new Error("ID de internação duplicado");
      seen.add(row.id);
      return instant(row.admittedAt) <= at && (!row.discharge || instant(row.discharge.at) > at);
    });
  }
  function pipaReferrals(admissions, month) {
    if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) throw new Error("Competência inválida");
    const seenAdmissions = new Set(), seenExits = new Set(), result = [];
    for (const row of admissions) {
      assertAdmission(row);
      if (seenAdmissions.has(row.id)) throw new Error("ID de internação duplicado");
      seenAdmissions.add(row.id);
      const d = row.discharge;
      if (!d || d.type !== "Alta" || d.pipaReferred !== true) continue;
      if (seenExits.has(d.id)) throw new Error("Evento de alta duplicado");
      seenExits.add(d.id);
      // O mês da alta é determinado no fuso hospitalar, não no UTC do navegador.
      const localDate = new Date(instant(d.at) - 3 * 3600000).toISOString().slice(0, 10);
      if (localDate.slice(0, 7) === month) result.push({
        admissionId: row.id, dischargeId: d.id, date: localDate,
        municipality: row.originMunicipality.trim()
      });
    }
    return result;
  }
  function pipaByMunicipality(admissions, month) {
    const counts = new Map();
    for (const item of pipaReferrals(admissions, month))
      counts.set(item.municipality, (counts.get(item.municipality) || 0) + 1);
    return [...counts].map(([municipality, count]) => ({ municipality, count }))
      .sort((a, b) => b.count - a.count || a.municipality.localeCompare(b.municipality, "pt-BR"));
  }
  return { assertAdmission, censusAtMidnight, pipaReferrals, pipaByMunicipality };
});

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { Actividad } from '@/services/actividades.service';
import { Campana } from '@/services/campanas.service';
import { Finca } from '@/services/fincas.service';
import { Parcela } from '@/services/parcelas.service';
import type { SigpacReference } from '@/services/sigpac.service';
import { slugify, todayIso } from '@/services/csv';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtSigpac(ref: SigpacReference | null): string {
  if (!ref) return '—';
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Deadline = performedAt + plazoSeguridadDias */
function fmtPlazoFin(performedAt: string, dias: number): string {
  const d = new Date(`${performedAt.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildHtml(
  finca: Finca,
  parcelas: Parcela[],
  campana: Campana | null,
  actividades: Actividad[],
  generatedAt: string,
): string {
  const parcelasById = new Map(parcelas.map((p) => [p.id, p]));

  // Sort by date ascending
  const sorted = [...actividades].sort((a, b) =>
    a.performedAt.localeCompare(b.performedAt),
  );

  const rows = sorted.map((a) => {
    const p = parcelasById.get(a.parcelaId);
    const f = a.fitosanitario!;
    const plazoFin = fmtPlazoFin(a.performedAt, f.plazoSeguridadDias);
    const areaCell = p?.areaHa !== null && p?.areaHa !== undefined
      ? `${p.areaHa} ha`
      : '—';

    return `
      <tr>
        <td>${esc(fmtDate(a.performedAt))}</td>
        <td>${esc(p?.name ?? '—')}</td>
        <td class="mono">${esc(fmtSigpac(p?.sigpacRef ?? null))}</td>
        <td>${esc(areaCell)}</td>
        <td><strong>${esc(f.productoComercial)}</strong></td>
        <td class="mono">${esc(f.numeroRegistro)}</td>
        <td>${esc(f.materiaActiva ?? '—')}</td>
        <td>${esc(String(f.dosis))} ${esc(f.dosisUnidad)}</td>
        <td>${f.volumenCaldoLHa !== null && f.volumenCaldoLHa !== undefined ? esc(String(f.volumenCaldoLHa)) + ' L/ha' : '—'}</td>
        <td>${esc(f.plagaObjetivo)}</td>
        <td style="text-align:center">${esc(String(f.plazoSeguridadDias))}</td>
        <td>${esc(plazoFin)}</td>
        <td>${esc(f.operadorNombre ?? '—')}</td>
        <td class="mono">${esc(f.operadorCarnet ?? '—')}</td>
      </tr>`;
  });

  const campanaInfo = campana
    ? `${esc(campana.name)} (${esc(fmtDate(campana.startDate))} – ${campana.endDate ? esc(fmtDate(campana.endDate)) : 'activa'})`
    : '—';

  const dateRange =
    sorted.length > 0
      ? `${fmtDate(sorted[0]!.performedAt)} — ${fmtDate(sorted[sorted.length - 1]!.performedAt)}`
      : '—';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cuaderno Fitosanitario · ${esc(finca.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9pt;
    color: #111;
    padding: 12mm 10mm;
    line-height: 1.3;
  }
  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #2d6a2d;
    padding-bottom: 6pt;
    margin-bottom: 10pt;
  }
  .header-left h1 {
    font-size: 14pt;
    font-weight: 800;
    color: #2d6a2d;
    letter-spacing: -0.3pt;
  }
  .header-left h2 {
    font-size: 10pt;
    font-weight: 600;
    color: #111;
    margin-top: 2pt;
  }
  .header-right {
    text-align: right;
    font-size: 8pt;
    color: #555;
  }
  /* ── Meta ── */
  .meta {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6pt;
    background: #f4f9f4;
    border: 1px solid #c8e0c8;
    border-radius: 4pt;
    padding: 6pt 8pt;
    margin-bottom: 10pt;
  }
  .meta-item label {
    font-size: 7pt;
    font-weight: 700;
    color: #2d6a2d;
    text-transform: uppercase;
    letter-spacing: 0.3pt;
    display: block;
    margin-bottom: 1pt;
  }
  .meta-item span { font-size: 9pt; }
  /* ── Legal note ── */
  .legal {
    font-size: 7.5pt;
    color: #555;
    margin-bottom: 8pt;
    padding: 4pt 6pt;
    border-left: 3pt solid #2d6a2d;
    background: #f9fdf9;
  }
  /* ── Table ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7.5pt;
    page-break-inside: auto;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th {
    background: #2d6a2d;
    color: #fff;
    font-weight: 700;
    padding: 4pt 3pt;
    text-align: left;
    vertical-align: bottom;
    font-size: 7pt;
    line-height: 1.2;
  }
  td {
    padding: 3pt;
    border-bottom: 0.5pt solid #ddd;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #f7faf7; }
  .mono { font-family: monospace; font-size: 7pt; }
  /* ── Footer ── */
  .footer {
    margin-top: 16pt;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 20pt;
    page-break-inside: avoid;
  }
  .footer-sig {
    border-top: 1pt solid #333;
    padding-top: 4pt;
    font-size: 8pt;
    color: #333;
  }
  .footer-sig .sig-label {
    font-size: 7pt;
    color: #777;
    text-transform: uppercase;
  }
  .generated {
    text-align: center;
    font-size: 7pt;
    color: #aaa;
    margin-top: 10pt;
  }
  @media print {
    body { padding: 0; }
    @page { size: A4 landscape; margin: 10mm; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>CampoLivo</h1>
    <h2>Cuaderno Fitosanitario — Registro de Tratamientos</h2>
  </div>
  <div class="header-right">
    <div>RD 1311/2012 · RD 1054/2022 (SIEX/CUE)</div>
    <div>Generado el ${esc(fmtDate(generatedAt))}</div>
  </div>
</div>

<div class="meta">
  <div class="meta-item">
    <label>Explotación</label>
    <span>${esc(finca.name)}</span>
  </div>
  <div class="meta-item">
    <label>Campaña</label>
    <span>${campanaInfo}</span>
  </div>
  <div class="meta-item">
    <label>Período de tratamientos</label>
    <span>${esc(dateRange)}</span>
  </div>
</div>

<div class="legal">
  Documento generado conforme al Anexo IV del RD 1311/2012 y el RD 1054/2022 (SIEX). Conservar durante
  al menos 3 años. Presentar ante la autoridad competente en caso de inspección.
</div>

<table>
  <thead>
    <tr>
      <th>Fecha<br>aplicación</th>
      <th>Parcela</th>
      <th>Ref. SIGPAC</th>
      <th>Superficie<br>tratada</th>
      <th>Nombre comercial<br>del producto</th>
      <th>Nº registro<br>del producto</th>
      <th>Materia activa</th>
      <th>Dosis aplicada</th>
      <th>Vol. caldo<br>(L/ha)</th>
      <th>Plaga / enfermedad<br>objetivo</th>
      <th>Plazo seg.<br>(días)</th>
      <th>Fin plazo<br>seguridad</th>
      <th>Nombre del<br>aplicador</th>
      <th>Nº carnet<br>ROPO</th>
    </tr>
  </thead>
  <tbody>
    ${rows.length > 0 ? rows.join('\n') : '<tr><td colspan="14" style="text-align:center;color:#888;padding:12pt">Sin tratamientos fitosanitarios registrados en el período seleccionado.</td></tr>'}
  </tbody>
</table>

<div class="footer">
  <div class="footer-sig">
    <div class="sig-label">Firma del titular</div>
    <br><br>
  </div>
  <div class="footer-sig">
    <div class="sig-label">Firma del técnico responsable</div>
    <br><br>
  </div>
  <div class="footer-sig">
    <div class="sig-label">Sello / fecha verificación</div>
    <br><br>
  </div>
</div>

<div class="generated">
  Generado con CampoLivo · ${esc(generatedAt)}
</div>

</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function exportCuadernoPdf(
  finca: Finca,
  parcelas: Parcela[],
  campana: Campana | null,
  actividades: Actividad[],
): Promise<void> {
  if (actividades.length === 0 && parcelas.length === 0) {
    throw new Error('No hay datos que exportar al cuaderno PDF.');
  }

  const generatedAt = new Date().toISOString();
  const html = buildHtml(finca, parcelas, campana, actividades, generatedAt);

  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
    // A4 landscape
    width: 841,
    height: 595,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Compartir archivos no está disponible en este dispositivo.');
  }

  const fileName = `cuaderno-fitosanitario-${slugify(finca.name) || 'finca'}-${todayIso()}.pdf`;
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Exportar cuaderno fitosanitario',
    UTI: 'com.adobe.pdf',
  });

  void fileName; // used for context, sharing uses the temp uri from expo-print
}

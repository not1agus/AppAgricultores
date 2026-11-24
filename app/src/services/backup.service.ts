// SDK 54: usamos el subpath `/legacy` para conservar la API antigua
// (cacheDirectory, EncodingType, writeAsStringAsync). Migrar a la nueva API
// (Paths/File) es un trabajo aparte; aquí mantenemos comportamiento exacto.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { actividadesService } from '@/services/actividades.service';
import type { AuthUser } from '@/services/auth.service';
import { campanasService } from '@/services/campanas.service';
import { slugify, todayIso } from '@/services/csv';
import { fincasService } from '@/services/fincas.service';
import { parcelasService } from '@/services/parcelas.service';
import { ticketsService } from '@/services/tickets.service';
import { transaccionesService } from '@/services/transacciones.service';

/**
 * Snapshot of every record the user can read, structured per-finca, ready
 * to be persisted as a JSON file and shared via the OS share sheet.
 *
 * Photos are referenced by URL — not embedded — to keep the backup small
 * and shareable through any channel. An offline archive of the photos
 * themselves is a separate problem (different UX, much larger payload),
 * intentionally out of scope here.
 *
 * Schema versioning is on the wire from day one so future readers (a
 * restore tool, a migration script, the user's accountant) can detect
 * incompatibilities instead of silently misinterpreting old fields.
 */

const SCHEMA_VERSION = 1;

export interface BackupProgress {
  /** Localised, user-facing description of the current step. */
  stage: string;
  /** Optional 0..1 hint for a progress bar; null when indeterminate. */
  ratio: number | null;
}

export type BackupProgressCallback = (p: BackupProgress) => void;

/**
 * Builds and shares a full JSON export of the user's data.
 *
 * Cost: 1 (list fincas) + N (parcelas) + N (campanas) + N (actividades) +
 * N (tickets) + M (transacciones, one per campana) round trips, where N
 * is the finca count. With the typical 1-3 fincas this is ~10-20 calls,
 * well within acceptable for a user-initiated one-shot action.
 *
 * On failure mid-flight we bail rather than ship a partial backup — a
 * file labelled "my data" that's silently missing fincas would be
 * actively harmful for restore/audit use cases.
 */
/** Browser download fallback for the web build (no expo-file-system /
 * expo-sharing). Blob + synthetic <a download>. */
function downloadJsonWeb(fileName: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBackup(
  user: AuthUser,
  onProgress?: BackupProgressCallback,
): Promise<void> {
  // On web we download directly; on native we need the OS share sheet.
  if (Platform.OS !== 'web') {
    const sharingAvailable = await Sharing.isAvailableAsync();
    if (!sharingAvailable) {
      throw new Error('Compartir no está disponible en este dispositivo.');
    }
  }

  onProgress?.({ stage: 'Listando fincas…', ratio: null });
  const fincas = await fincasService.list();

  const fincasOut: unknown[] = [];
  for (let i = 0; i < fincas.length; i++) {
    const f = fincas[i]!;
    const ratio = (i + 1) / Math.max(1, fincas.length);
    onProgress?.({
      stage: `Descargando datos de "${f.name}" (${i + 1}/${fincas.length})…`,
      ratio,
    });

    // Per-finca calls fanned out in parallel — ordering between parcelas /
    // campanas / actividades / tickets is independent so there's no reason
    // to serialise. Transacciones still need campanas to resolve first.
    const [parcelas, campanas, actividades, tickets] = await Promise.all([
      parcelasService.listByFinca(f.id),
      campanasService.listByFinca(f.id),
      actividadesService.list({ fincaId: f.id }),
      ticketsService.listByFinca(f.id),
    ]);

    const transaccionesByCampana = await Promise.all(
      campanas.map((c) =>
        transaccionesService
          .listByCampana(c.id)
          .then((tx) => ({ campanaId: c.id, transacciones: tx })),
      ),
    );
    const txByCampanaId = new Map(
      transaccionesByCampana.map((r) => [r.campanaId, r.transacciones]),
    );

    fincasOut.push({
      ...f,
      parcelas,
      campanas: campanas.map((c) => ({
        ...c,
        transacciones: txByCampanaId.get(c.id) ?? [],
      })),
      actividades,
      tickets,
    });
  }

  const document = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    fincas: fincasOut,
  };

  // 2-space indent: human-readable for the user opening it in a text
  // editor, still compact enough to share via email/WhatsApp without
  // hitting attachment limits for the typical farm scale.
  const json = JSON.stringify(document, null, 2);

  onProgress?.({ stage: 'Guardando archivo…', ratio: 1 });

  const fileName = `app-olivar-backup-${slugify(user.email) || 'usuario'}-${todayIso()}.json`;

  if (Platform.OS === 'web') {
    downloadJsonWeb(fileName, json);
    return;
  }

  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: 'Descargar mis datos',
    UTI: 'public.json',
  });
}

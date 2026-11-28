import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import type { MainStackParamList } from '@/navigation/types';
import { Ticket, ticketsService } from '@/services/tickets.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { fmtDate } from '@/utils/date';

type Props = NativeStackScreenProps<MainStackParamList, 'TicketsList'>;

/**
 * The user's mental model for tickets is action-oriented, not status-oriented:
 * "what needs my attention" vs "what's done". The four raw status values
 * (pending/processing/done/failed/manual) collapse into two buckets for the
 * user — anything that's not yet a confirmed transaction is "to-do".
 *
 * `review` = status !== 'done' OR transaccionId === null
 *   captures both pre-OCR / failed-OCR rows AND the gap between OCR finishing
 *   and the user pressing "Confirmar".
 * `confirmed` = transaccionId !== null
 *   the ticket has been promoted to a movement on the campaign ledger.
 *
 * Mutually exclusive: a ticket is in exactly one of these (plus `all`).
 */
type StatusBucket = 'all' | 'review' | 'confirmed';

const BUCKET_LABELS: Record<StatusBucket, string> = {
  all: 'Todos',
  review: 'Por revisar',
  confirmed: 'Confirmados',
};

const BUCKET_PRESETS: StatusBucket[] = ['all', 'review', 'confirmed'];

function ticketBucket(t: Ticket): Exclude<StatusBucket, 'all'> {
  return t.transaccionId !== null ? 'confirmed' : 'review';
}

function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function ticketTotal(t: Ticket): number | null {
  const fields = t.corrected ?? t.parsed;
  return fields?.totalEur ?? null;
}

function summaryLine(ticket: Ticket): string {
  const fields = ticket.corrected ?? ticket.parsed ?? {};
  const parts: string[] = [];
  if (fields.almazara) parts.push(fields.almazara);
  if (fields.fecha) parts.push(fmtDate(fields.fecha));
  if (fields.totalEur !== null && fields.totalEur !== undefined) {
    parts.push(`${fields.totalEur.toFixed(2)} €`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Sin datos todavía';
}

interface TicketsStats {
  total: number;
  reviewCount: number;
  confirmedCount: number;
  /** Sum of `totalEur` over confirmed tickets only — that's the figure that
   * matches what hit the campaign ledger. Pending tickets may have OCR'd
   * totals but until confirmed they're not committed numbers. */
  confirmedTotalEur: number;
  /** Subset of confirmedTotalEur where we actually had a totalEur to add.
   * If a confirmed ticket has no OCR'd total (rare but possible — manual
   * confirm with amount captured elsewhere), it's counted as 1 confirmed
   * but contributes 0 to the sum, which would lie about the total. We track
   * the count separately so the UI can hint when the sum is incomplete. */
  confirmedWithTotalCount: number;
}

function computeStats(list: Ticket[]): TicketsStats {
  let reviewCount = 0;
  let confirmedCount = 0;
  let confirmedTotalEur = 0;
  let confirmedWithTotalCount = 0;
  for (const t of list) {
    const bucket = ticketBucket(t);
    if (bucket === 'review') reviewCount += 1;
    else {
      confirmedCount += 1;
      const total = ticketTotal(t);
      if (total !== null) {
        confirmedTotalEur += total;
        confirmedWithTotalCount += 1;
      }
    }
  }
  return {
    total: list.length,
    reviewCount,
    confirmedCount,
    confirmedTotalEur,
    confirmedWithTotalCount,
  };
}

export function TicketsListScreen({ route, navigation }: Props): JSX.Element {
  const { fincaId } = route.params;
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [bucket, setBucket] = useState<StatusBucket>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setTickets(await ticketsService.listByFinca(fincaId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando tickets');
    }
  }, [fincaId]);

  // Reload every time the screen regains focus so new scans show up.
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    void load().finally(() => setLoading(false));
    return unsub;
  }, [load, navigation]);

  // Stats are computed over the full unfiltered list — they're a global
  // health view of the finca's ticket pile, not of the current narrowing.
  // A "confirmed: 5" cell is only meaningful as an absolute, not relative
  // to whatever filter is on.
  const stats = useMemo(() => computeStats(tickets), [tickets]);

  const filteredByBucket = useMemo(() => {
    if (bucket === 'all') return tickets;
    return tickets.filter((t) => ticketBucket(t) === bucket);
  }, [tickets, bucket]);

  // Trim once per query change so a stray space doesn't filter to empty.
  const normalisedQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const visibleTickets = useMemo(() => {
    if (normalisedQuery.length === 0) return filteredByBucket;
    return filteredByBucket.filter((t) => {
      const fields = t.corrected ?? t.parsed;
      if (fields?.almazara?.toLowerCase().includes(normalisedQuery))
        return true;
      if (fields?.fecha?.toLowerCase().includes(normalisedQuery)) return true;
      if (t.notes?.toLowerCase().includes(normalisedQuery)) return true;
      return false;
    });
  }, [filteredByBucket, normalisedQuery]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  const isFiltered = bucket !== 'all' || normalisedQuery.length > 0;
  // Only flag "incomplete sum" when there's at least one confirmed ticket
  // missing a total — otherwise the note is noise.
  const sumIsPartial =
    stats.confirmedCount > 0 &&
    stats.confirmedWithTotalCount < stats.confirmedCount;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Tickets</Text>
        <Button
          title="Escanear"
          onPress={() => navigation.navigate('TicketScan', { fincaId })}
        />
      </View>

      {tickets.length > 0 ? (
        <Card style={styles.statsCard}>
          <View style={styles.statsRow}>
            <StatCol label="Total" value={String(stats.total)} />
            <StatCol
              label="Por revisar"
              value={String(stats.reviewCount)}
              highlight={stats.reviewCount > 0}
            />
            <StatCol
              label="Confirmados"
              value={String(stats.confirmedCount)}
            />
          </View>
          <View style={styles.statsRow}>
            <View style={styles.totalCol}>
              <Text style={styles.statLabel}>Total facturado (confirmados)</Text>
              <Text style={styles.totalValue}>
                {fmtEur(stats.confirmedTotalEur)}
              </Text>
              {sumIsPartial ? (
                <Text style={styles.statsNote}>
                  {stats.confirmedCount - stats.confirmedWithTotalCount} sin
                  importe registrado — total parcial
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      ) : null}

      {tickets.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bucketRow}
        >
          {BUCKET_PRESETS.map((b) => {
            const selected = bucket === b;
            // Show count next to each chip so the user picks knowingly —
            // tapping "Por revisar (0)" only to land on an empty state is
            // a small but real annoyance.
            const count =
              b === 'all'
                ? stats.total
                : b === 'review'
                  ? stats.reviewCount
                  : stats.confirmedCount;
            return (
              <Text
                key={b}
                onPress={() => setBucket(b)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                {BUCKET_LABELS[b]} · {count}
              </Text>
            );
          })}
        </ScrollView>
      ) : null}

      {tickets.length > 0 ? (
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar por almazara, fecha o notas"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              style={styles.searchClear}
              hitSlop={8}
              accessibilityLabel="Limpiar búsqueda"
            >
              <Text style={styles.searchClearText}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visibleTickets}
        keyExtractor={(t) => t.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tickets.length === 0
              ? 'Aún no hay tickets. Pulsa «Escanear» para capturar el primero.'
              : normalisedQuery.length > 0
                ? `Sin coincidencias para "${query.trim()}".`
                : isFiltered
                  ? 'Sin tickets en este filtro.'
                  : 'Sin tickets.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Card
            onPress={() =>
              navigation.navigate('TicketDetail', {
                ticketId: item.id,
                fincaId,
              })
            }
          >
            <View style={styles.row}>
              <Text style={styles.itemTitle}>{summaryLine(item)}</Text>
              <StatusPill status={item.status} />
            </View>
            {item.transaccionId ? (
              <Text style={styles.itemMeta}>Confirmado como transacción</Text>
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}

function StatCol({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): JSX.Element {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          highlight ? { color: theme.colors.danger } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  statsCard: {
    marginBottom: theme.spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statCol: {
    flex: 1,
  },
  totalCol: {
    flex: 1,
    marginTop: theme.spacing.sm,
  },
  statLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    ...typography.display,
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
  },
  totalValue: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  statsNote: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },
  bucketRow: {
    paddingBottom: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    fontSize: 13,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  searchWrap: {
    position: 'relative',
    marginBottom: theme.spacing.md,
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingRight: 36,
    color: theme.colors.text,
    fontSize: 14,
  },
  searchClear: {
    position: 'absolute',
    right: theme.spacing.sm,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearText: {
    color: theme.colors.textMuted,
    fontSize: 22,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  separator: { height: theme.spacing.sm },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    marginRight: theme.spacing.sm,
  },
  itemMeta: {
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    fontSize: 12,
  },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
});

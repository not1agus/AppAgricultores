import { StyleSheet, Text, View } from 'react-native';

import type { TicketStatus } from '@/services/tickets.service';
import { theme } from '@/theme';

const LABEL: Record<TicketStatus, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  done: 'OCR listo',
  failed: 'OCR falló',
  manual: 'Manual',
};

const COLOR: Record<TicketStatus, string> = {
  pending: '#8A8F83',
  processing: '#C08A2E',
  done: theme.colors.primary,
  failed: theme.colors.danger,
  manual: '#5C6655',
};

interface StatusPillProps {
  status: TicketStatus;
}

export function StatusPill({ status }: StatusPillProps): JSX.Element {
  return (
    <View style={[styles.pill, { backgroundColor: COLOR[status] }]}>
      <Text style={styles.text}>{LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});

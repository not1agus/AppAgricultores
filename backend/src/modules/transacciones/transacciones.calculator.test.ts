import { computeCampanaSummary } from './transacciones.calculator';

const CAMPANA_ID = 'campana-test-001';

describe('computeCampanaSummary', () => {
  it('returns all-zeros for an empty campaign', () => {
    const result = computeCampanaSummary(CAMPANA_ID, []);
    expect(result.campanaId).toBe(CAMPANA_ID);
    expect(result.totalIngresos).toBe(0);
    expect(result.totalGastos).toBe(0);
    expect(result.balance).toBe(0);
    expect(result.count).toBe(0);
  });

  it('sums only ingresos', () => {
    const result = computeCampanaSummary(CAMPANA_ID, [
      { kind: 'ingreso', amount_eur: 1000 },
      { kind: 'ingreso', amount_eur: 500 },
    ]);
    expect(result.totalIngresos).toBe(1500);
    expect(result.totalGastos).toBe(0);
    expect(result.balance).toBe(1500);
    expect(result.count).toBe(2);
  });

  it('sums only gastos', () => {
    const result = computeCampanaSummary(CAMPANA_ID, [
      { kind: 'gasto', amount_eur: 300 },
      { kind: 'gasto', amount_eur: 150 },
    ]);
    expect(result.totalIngresos).toBe(0);
    expect(result.totalGastos).toBe(450);
    expect(result.balance).toBe(-450);
  });

  it('computes balance = ingresos - gastos', () => {
    const result = computeCampanaSummary(CAMPANA_ID, [
      { kind: 'ingreso', amount_eur: 2000 },
      { kind: 'gasto',   amount_eur: 800 },
      { kind: 'gasto',   amount_eur: 200 },
    ]);
    expect(result.totalIngresos).toBe(2000);
    expect(result.totalGastos).toBe(1000);
    expect(result.balance).toBe(1000);
  });

  it('handles string amounts (from Postgres NUMERIC columns)', () => {
    const result = computeCampanaSummary(CAMPANA_ID, [
      { kind: 'ingreso', amount_eur: '1234.56' },
      { kind: 'gasto',   amount_eur: '234.56' },
    ]);
    expect(result.totalIngresos).toBeCloseTo(1234.56);
    expect(result.totalGastos).toBeCloseTo(234.56);
    expect(result.balance).toBeCloseTo(1000);
  });

  it('skips rows with non-finite amounts', () => {
    const result = computeCampanaSummary(CAMPANA_ID, [
      { kind: 'ingreso', amount_eur: NaN },
      { kind: 'ingreso', amount_eur: 500 },
    ]);
    expect(result.totalIngresos).toBe(500);
    expect(result.count).toBe(2); // NaN row still counted
  });

  it('handles a large number of transactions correctly', () => {
    // 100 ingresos of 10, 50 gastos of 10
    const rows = [
      ...Array.from({ length: 100 }, () => ({ kind: 'ingreso' as const, amount_eur: 10 })),
      ...Array.from({ length: 50 },  () => ({ kind: 'gasto'   as const, amount_eur: 10 })),
    ];
    const result = computeCampanaSummary(CAMPANA_ID, rows);
    expect(result.totalIngresos).toBe(1000);
    expect(result.totalGastos).toBe(500);
    expect(result.balance).toBe(500);
    expect(result.count).toBe(150);
  });

  it('preserves floating-point precision for real olive-price math', () => {
    // 249 kg × 0.65 €/kg = 161.85 €
    const kgPrecio = 0.65;
    const kg = 249;
    const result = computeCampanaSummary(CAMPANA_ID, [
      { kind: 'ingreso', amount_eur: +(kgPrecio * kg).toFixed(2) },
      { kind: 'gasto',   amount_eur: 50 },
    ]);
    expect(result.totalIngresos).toBeCloseTo(161.85, 2);
    expect(result.balance).toBeCloseTo(111.85, 2);
  });
});

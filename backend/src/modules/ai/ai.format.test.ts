import { toPlainText } from './ai.format';

describe('toPlainText', () => {
  it('quita negritas, títulos, citas y separadores', () => {
    const md = [
      'Respeta el **Plazo de Seguridad** del producto.',
      '',
      '### ¿Cómo se calcula?',
      '> **Fecha permitida** = Fecha del tratamiento + Días del plazo',
      '',
      '---',
      '',
      '### ⚠️ Importante',
    ].join('\n');
    expect(toPlainText(md)).toBe(
      [
        'Respeta el Plazo de Seguridad del producto.',
        '',
        '¿Cómo se calcula?',
        'Fecha permitida = Fecha del tratamiento + Días del plazo',
        '',
        '⚠️ Importante',
      ].join('\n'),
    );
  });

  it('convierte viñetas "* " en "- " y mantiene las numeradas', () => {
    expect(toPlainText('* **No se puede:** antes\n1. **Del producto:** x')).toBe(
      '- No se puede: antes\n1. Del producto: x',
    );
  });

  it('quita la cursiva sin tocar multiplicaciones', () => {
    expect(toPlainText('*Ejemplo:* 0,5 L/ha * 3 ha = 1,5 L')).toBe(
      'Ejemplo: 0,5 L/ha * 3 ha = 1,5 L',
    );
  });

  it('no cambia texto plano ni guiones normales', () => {
    const plain = '- ❌ Cantidad: 15 L no cuadra con 0,5 L/ha × 3 ha.\n✅ Sin incoherencias detectadas';
    expect(toPlainText(plain)).toBe(plain);
  });
});

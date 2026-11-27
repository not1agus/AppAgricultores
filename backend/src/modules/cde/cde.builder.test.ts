import type { Actividad, Fitosanitario } from '../actividades/actividades.types';
import type { Parcela } from '../parcelas/parcelas.types';
import { buildCdeRows, CDE_COLUMNS, formatDecimalEs, isoToEsDate, toCsv } from './cde.builder';

const TODAY = '2026-11-26';

function parcela(over: Partial<Parcela> = {}): Parcela {
  return {
    id: 'p1',
    fincaId: 'f1',
    name: 'Olivar norte',
    areaHa: 3.4521,
    sigpacRef: {
      provincia: '23',
      municipio: '050',
      agregado: '0',
      zona: '0',
      poligono: '12',
      parcela: '345',
      recinto: '2',
    },
    geometry: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function fito(over: Partial<Fitosanitario> = {}): Fitosanitario {
  return {
    productoComercial: 'Producto X',
    numeroRegistro: '23339',
    materiaActiva: 'Dimetoato 40%',
    dosis: 0.125,
    dosisUnidad: 'L/hL',
    plagaObjetivo: 'Mosca del olivo',
    plazoSeguridadDias: 21,
    volumenCaldoLHa: 800,
    operadorNombre: 'Ana López',
    operadorCarnet: 'JAE-1',
    cultivoEspecie: 'Olivo',
    cultivoVariedad: 'Picual',
    superficieTratadaHa: 2.1234,
    justificacion: 'Superado umbral en trampas',
    cantidadProducto: 1.25,
    cantidadUnidad: 'L',
    operadorNif: '12345678Z',
    operadorRopo: '2300012345S',
    equipoDescripcion: 'Atomizador Hardi 1000',
    equipoRoma: 'ROMA-998',
    eficacia: 'Buena',
    ...over,
  };
}

function actividad(over: Partial<Actividad> = {}): Actividad {
  return {
    id: 'a1',
    parcelaId: 'p1',
    type: 'tratamiento_fitosanitario',
    performedAt: '2026-10-05',
    description: null,
    costEur: null,
    photos: [],
    fitosanitario: fito(),
    campanaId: null,
    createdBy: 'u1',
    createdAt: '2026-10-05T10:00:00Z',
    updatedAt: '2026-10-05T10:00:00Z',
    ...over,
  };
}

const col = (name: (typeof CDE_COLUMNS)[number]): number => CDE_COLUMNS.indexOf(name);

describe('buildCdeRows — tratamiento completo', () => {
  it('genera una fila con exactamente las columnas oficiales', () => {
    const { rows, problems } = buildCdeRows([actividad()], [parcela()], TODAY);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(CDE_COLUMNS.length);
  });

  it('copia los datos del usuario sin redondear ni transformar', () => {
    const [row] = buildCdeRows([actividad()], [parcela()], TODAY).rows;
    expect(row![col('Fecha de tratamiento')]).toBe('05/10/2026');
    expect(row![col('Superficie tratada (ha)')]).toBe('2,1234');
    expect(row![col('Cantidad de producto utilizada')]).toBe('1,25');
    expect(row![col('Unidad')]).toBe('L');
    expect(row![col('Cultivo (especie)')]).toBe('Olivo');
    expect(row![col('Variedad')]).toBe('Picual');
    expect(row![col('Agregado')]).toBe('0');
    expect(row![col('Recinto')]).toBe('2');
    expect(row![col('Aplicador: NIF')]).toBe('12345678Z');
  });

  it('no incluye datos que la norma no pide (dosis, caldo, plazo, nombres internos)', () => {
    const [row] = buildCdeRows([actividad()], [parcela()], TODAY).rows;
    const joined = row!.join('|');
    expect(joined).not.toContain('0,125'); // dosis
    expect(joined).not.toContain('800'); // volumen de caldo
    expect(joined).not.toContain('Olivar norte'); // nombre interno de la parcela
    expect(joined).not.toContain('JAE-1'); // carnet ≠ ROPO
    expect(CDE_COLUMNS).not.toContain('Dosis');
    expect(CDE_COLUMNS).not.toContain('Plazo seguridad (días)');
  });

  it('deja vacíos los campos condicionales que el usuario no tiene (ROMA, asesor, observaciones)', () => {
    const [row] = buildCdeRows(
      [actividad({ fitosanitario: fito({ equipoRoma: null }) })],
      [parcela()],
      TODAY,
    ).rows;
    expect(row![col('Equipo: nº inscripción ROMA')]).toBe('');
    expect(row![col('Asesor: NIF')]).toBe('');
    expect(row![col('Observaciones')]).toBe('');
  });

  it('ignora actividades que no son tratamientos fitosanitarios', () => {
    const { rows, problems } = buildCdeRows(
      [actividad(), actividad({ id: 'a2', type: 'poda', fitosanitario: null })],
      [parcela()],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it('ordena cronológicamente', () => {
    const { rows } = buildCdeRows(
      [
        actividad({ id: 'b', performedAt: '2026-10-09' }),
        actividad({ id: 'a', performedAt: '2026-03-01' }),
      ],
      [parcela()],
      TODAY,
    );
    expect(rows.map((r) => r[0])).toEqual(['01/03/2026', '09/10/2026']);
  });
});

describe('buildCdeRows — nunca rellena datos que faltan', () => {
  it('cada campo obligatorio vacío bloquea la fila y se informa', () => {
    const { rows, problems } = buildCdeRows(
      [
        actividad({
          fitosanitario: fito({
            cultivoEspecie: null,
            cultivoVariedad: '  ',
            superficieTratadaHa: null,
            justificacion: undefined,
            materiaActiva: null,
            cantidadProducto: null,
            cantidadUnidad: null,
            operadorNombre: null,
            operadorNif: null,
            operadorRopo: null,
            equipoDescripcion: null,
            eficacia: null,
          }),
        }),
      ],
      [parcela()],
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.fixIn).toBe('actividad');
    const msg = problems[0]!.messages.join(' ');
    for (const label of [
      'Cultivo (especie)',
      'Variedad',
      'Superficie tratada',
      'Justificación de la actuación',
      'Materia activa',
      'Cantidad de producto utilizada',
      'Nombre del aplicador',
      'NIF del aplicador',
      'Nº ROPO del aplicador',
      'Equipo de aplicación',
      'Valoración de la eficacia',
    ]) {
      expect(msg).toContain(label);
    }
  });

  it('no usa la superficie de la parcela como superficie tratada', () => {
    const { rows, problems } = buildCdeRows(
      [actividad({ fitosanitario: fito({ superficieTratadaHa: null }) })],
      [parcela({ areaHa: 5 })],
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(problems[0]!.messages.join(' ')).toContain('Superficie tratada');
  });

  it('bloquea parcelas sin SIGPAC o con SIGPAC incompleto (sin suponer agregado/zona = 0)', () => {
    const sinSigpac = buildCdeRows([actividad()], [parcela({ sigpacRef: null })], TODAY);
    expect(sinSigpac.rows).toEqual([]);
    expect(sinSigpac.problems[0]!.fixIn).toBe('parcela');

    const incompleto = buildCdeRows(
      [actividad()],
      [parcela({ sigpacRef: { provincia: '23', municipio: '050', poligono: '12', parcela: '345' } })],
      TODAY,
    );
    expect(incompleto.rows).toEqual([]);
    expect(incompleto.problems[0]!.messages[0]).toBe(
      'Referencia SIGPAC incompleta: falta agregado, zona, recinto',
    );
  });

  it('exige el asesor completo si se ha empezado a rellenar', () => {
    const { rows, problems } = buildCdeRows(
      [actividad({ fitosanitario: fito({ asesorNombre: 'Luis', asesorNif: null }) })],
      [parcela()],
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(problems[0]!.messages.join(' ')).toContain('Datos del asesor incompletos');
  });

  it('detecta superficie tratada mayor que la parcela y fechas futuras', () => {
    const { problems } = buildCdeRows(
      [
        actividad({
          performedAt: '2026-12-01',
          fitosanitario: fito({ superficieTratadaHa: 9 }),
        }),
      ],
      [parcela({ areaHa: 3.4521 })],
      TODAY,
    );
    const msg = problems[0]!.messages.join(' ');
    expect(msg).toContain('es mayor que la de la parcela');
    expect(msg).toContain('posterior a hoy');
  });

  it('marca tratamientos sin bloque fitosanitario', () => {
    const { rows, problems } = buildCdeRows(
      [actividad({ fitosanitario: null })],
      [parcela()],
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(problems[0]!.messages).toEqual(['El tratamiento no tiene datos fitosanitarios']);
  });
});

describe('formato', () => {
  it('formatDecimalEs no redondea', () => {
    expect(formatDecimalEs(0.4523)).toBe('0,4523');
    expect(formatDecimalEs(12)).toBe('12');
    expect(formatDecimalEs(null)).toBe('');
  });

  it('isoToEsDate', () => {
    expect(isoToEsDate('2026-03-07')).toBe('07/03/2026');
    expect(isoToEsDate(null)).toBe('');
  });

  it('toCsv escapa ; comillas y saltos de línea', () => {
    const csv = toCsv(['A', 'B'], [['x;y', 'di "hola"\nadiós']]);
    expect(csv).toBe('A;B\r\n"x;y";"di ""hola""\nadiós"');
  });
});

import {
  addHours,
  isOnTheHour,
  localDateString,
  localHour,
  localInstant,
  parseLocalDate,
} from './local-time';

describe('local-time (hora de Lima, UTC-5)', () => {
  it('convierte una hora local en el instante UTC correcto', () => {
    expect(localInstant(2026, 11, 14, 20).toISOString()).toBe('2026-11-15T01:00:00.000Z');
    expect(localInstant(2026, 11, 14, 8).toISOString()).toBe('2026-11-14T13:00:00.000Z');
  });

  it('obtiene la hora local de un instante, también al cruzar la medianoche UTC', () => {
    expect(localHour(new Date('2026-11-15T01:00:00Z'))).toBe(20);
    expect(localHour(new Date('2026-11-14T05:00:00Z'))).toBe(0);
  });

  it('obtiene la fecha local aunque en UTC ya sea el día siguiente', () => {
    expect(localDateString(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-14');
  });

  it('ida y vuelta: localHour(localInstant(h)) === h', () => {
    for (let h = 0; h < 24; h++) {
      expect(localHour(localInstant(2026, 12, 31, h))).toBe(h);
    }
  });

  it('valida fechas reales', () => {
    expect(parseLocalDate('2026-11-14')).toEqual({ year: 2026, month: 11, day: 14 });
    expect(parseLocalDate('2026-02-31')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('14/11/2026')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
  });

  it('acepta el 29 de febrero solo en año bisiesto', () => {
    expect(parseLocalDate('2028-02-29')).not.toBeNull();
    expect(parseLocalDate('2027-02-29')).toBeNull();
  });

  it('detecta horas en punto', () => {
    expect(isOnTheHour(new Date('2026-11-15T01:00:00Z'))).toBe(true);
    expect(isOnTheHour(new Date('2026-11-15T01:30:00Z'))).toBe(false);
    expect(isOnTheHour(new Date('2026-11-15T01:00:00.500Z'))).toBe(false);
  });

  it('suma horas', () => {
    expect(addHours(new Date('2026-11-15T01:00:00Z'), 2).toISOString()).toBe('2026-11-15T03:00:00.000Z');
  });
});

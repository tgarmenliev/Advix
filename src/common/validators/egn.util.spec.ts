import { ageFromEgn, egnBirthDate, isValidEgn } from './egn.util';

// Валидни ЕГН-та, генерирани по официалния алгоритъм
// (дата + тегла 2,4,8,5,10,9,7,3,6, mod 11, остатък 10 → 0)
const VALID_EGNS = {
  '8506151239': new Date(Date.UTC(1985, 5, 15)), // 1985-06-15 (mm 01–12 → 19xx)
  '0441310010': new Date(Date.UTC(2004, 0, 31)), // 2004-01-31 (mm+40 → 20xx)
  '9331024562': new Date(Date.UTC(1893, 10, 2)), // 1893-11-02 (mm+20 → 18xx)
  '5209231178': new Date(Date.UTC(1952, 8, 23)), // 1952-09-23
  '1052057894': new Date(Date.UTC(2010, 11, 5)), // 2010-12-05
};

describe('ЕГН валидация', () => {
  it.each(Object.keys(VALID_EGNS))('приема валидно ЕГН %s', (egn) => {
    expect(isValidEgn(egn)).toBe(true);
  });

  it('отхвърля ЕГН с грешна контролна цифра', () => {
    // Валидното е 8506151239 — всяка друга последна цифра е невалидна
    for (const digit of '012345678') {
      if (digit !== '9') {
        expect(isValidEgn(`850615123${digit}`)).toBe(false);
      }
    }
  });

  it('отхвърля невалидна дата в първите 6 цифри', () => {
    expect(isValidEgn('8502301239')).toBe(false); // 30 февруари
    expect(isValidEgn('8513151239')).toBe(false); // месец 13
    expect(isValidEgn('8533151239')).toBe(false); // месец 33 (извън 21–32)
    expect(isValidEgn('8553151239')).toBe(false); // месец 53 (извън 41–52)
    expect(isValidEgn('8506321239')).toBe(false); // ден 32
  });

  it('отхвърля грешен формат', () => {
    expect(isValidEgn('123')).toBe(false); // твърде кратко
    expect(isValidEgn('85061512390')).toBe(false); // 11 цифри
    expect(isValidEgn('85O6151239')).toBe(false); // буква
    expect(isValidEgn(8506151239)).toBe(false); // не е string
    expect(isValidEgn(null)).toBe(false);
    expect(isValidEgn(undefined)).toBe(false);
  });

  it.each(Object.entries(VALID_EGNS))(
    'извлича правилната дата на раждане от %s',
    (egn, expected) => {
      expect(egnBirthDate(egn)).toEqual(expected);
    },
  );
});

describe('ageFromEgn — възраст от различни десетилетия', () => {
  const today = new Date(Date.UTC(2026, 6, 9)); // 2026-07-09

  it('1985-06-15 → 41 (рожденият ден е минал)', () => {
    expect(ageFromEgn('8506151239', today)).toBe(41);
  });

  it('2004-01-31 → 22', () => {
    expect(ageFromEgn('0441310010', today)).toBe(22);
  });

  it('1893-11-02 → 132 (рожденият ден не е минал)', () => {
    expect(ageFromEgn('9331024562', today)).toBe(132);
  });

  it('1952-09-23 → 73 (рожденият ден не е минал)', () => {
    expect(ageFromEgn('5209231178', today)).toBe(73);
  });

  it('2010-12-05 → 15', () => {
    expect(ageFromEgn('1052057894', today)).toBe(15);
  });

  it('точно на рождения ден възрастта се увеличава', () => {
    expect(ageFromEgn('8506151239', new Date(Date.UTC(2026, 5, 15)))).toBe(41);
    expect(ageFromEgn('8506151239', new Date(Date.UTC(2026, 5, 14)))).toBe(40);
  });

  it('връща null при невалидно ЕГН', () => {
    expect(ageFromEgn('invalid', today)).toBeNull();
  });
});

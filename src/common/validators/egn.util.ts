/**
 * Българска ЕГН валидация и извличане на данни.
 *
 * Формат: YYMMDD XXX C
 * - Месец 01–12  → роден 1900–1999
 * - Месец 21–32  → роден 1800–1899 (месец − 20)
 * - Месец 41–52  → роден 2000–2099 (месец − 40)
 * - 10-та цифра е контролна: сума на първите 9 цифри по тегла
 *   2,4,8,5,10,9,7,3,6, по модул 11; остатък 10 → контролна 0.
 */

const EGN_WEIGHTS = [2, 4, 8, 5, 10, 9, 7, 3, 6];

/** Извлича датата на раждане от ЕГН или връща null при невалидна дата. */
export function egnBirthDate(egn: string): Date | null {
  if (!/^\d{10}$/.test(egn)) {
    return null;
  }

  const yy = Number(egn.slice(0, 2));
  const rawMonth = Number(egn.slice(2, 4));
  const day = Number(egn.slice(4, 6));

  let year: number;
  let month: number;
  if (rawMonth >= 1 && rawMonth <= 12) {
    year = 1900 + yy;
    month = rawMonth;
  } else if (rawMonth >= 21 && rawMonth <= 32) {
    year = 1800 + yy;
    month = rawMonth - 20;
  } else if (rawMonth >= 41 && rawMonth <= 52) {
    year = 2000 + yy;
    month = rawMonth - 40;
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return isRealDate ? date : null;
}

/** Проверява контролната цифра по официалния алгоритъм. */
export function egnChecksumValid(egn: string): boolean {
  if (!/^\d{10}$/.test(egn)) {
    return false;
  }
  const sum = EGN_WEIGHTS.reduce(
    (acc, weight, i) => acc + weight * Number(egn[i]),
    0,
  );
  const remainder = sum % 11;
  const checkDigit = remainder === 10 ? 0 : remainder;
  return checkDigit === Number(egn[9]);
}

/** Пълна ЕГН валидация: 10 цифри + валидна дата + валидна контролна цифра. */
export function isValidEgn(egn: unknown): egn is string {
  return (
    typeof egn === 'string' &&
    egnBirthDate(egn) !== null &&
    egnChecksumValid(egn)
  );
}

/**
 * Изчислява навършените години от ЕГН.
 * @param at — референтна дата (по подразбиране днес); параметризирана за тестове
 */
export function ageFromEgn(egn: string, at: Date = new Date()): number | null {
  const birthDate = egnBirthDate(egn);
  if (!birthDate) {
    return null;
  }
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayNotYetReached =
    at.getUTCMonth() < birthDate.getUTCMonth() ||
    (at.getUTCMonth() === birthDate.getUTCMonth() &&
      at.getUTCDate() < birthDate.getUTCDate());
  if (birthdayNotYetReached) {
    age -= 1;
  }
  return age;
}

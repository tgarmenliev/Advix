/**
 * Замества динамични placeholder-и от вида `{key}` в текста със стойности от
 * подадената карта. Непознати placeholder-и се оставят непокътнати (за да е ясно,
 * че нещо липсва, вместо да изчезне тихо).
 *
 * Пример: fillPlaceholders("Здравейте, {clientName}", { clientName: "Иван" })
 *         → "Здравейте, Иван"
 */
export function fillPlaceholders(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

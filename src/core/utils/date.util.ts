export function now(): Date {
  return new Date();
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function formatDate(date: Date, locale = 'en-US'): string {
  return date.toLocaleDateString(locale);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

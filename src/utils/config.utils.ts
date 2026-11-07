import { ConfigService } from '@nestjs/config';

export function getBoolean(
  config: ConfigService,
  name: string,
  defaultValue: boolean,
): boolean {
  const raw = config.get<unknown>(name);
  if (raw === undefined) return defaultValue;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function getPositiveInteger(
  config: ConfigService,
  name: string,
  defaultValue: number,
): number {
  const raw = config.get<unknown>(name);
  if (raw === undefined) {
    return defaultValue;
  }

  const value = Number(raw);
  if (
    (typeof raw !== 'string' && typeof raw !== 'number') ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 2_147_483_647
  ) {
    throw new Error(`${name} must be an integer between 1 and 2147483647`);
  }
  return value;
}

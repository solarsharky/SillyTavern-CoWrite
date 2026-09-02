/**
 * Clone data that belongs to CoWrite's JSON contracts.
 *
 * Vue and Pinia expose reactive values as Proxy objects. Browser structuredClone
 * rejects those proxies, while serializing them to JSON intentionally unwraps
 * them and also mirrors the format used by account files and backups.
 */
export function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('共笔只能克隆可序列化的 JSON 数据。');
  return JSON.parse(serialized) as T;
}

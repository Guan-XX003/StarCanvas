export function wanjuanAccountRecordsPage(result: any) {
  const items = Array.isArray(result?.items)
    ? result.items
    : Array.isArray(result?.records)
      ? result.records
      : [];
  const nextCursor = String(result?.nextCursor || ``);
  return { items, nextCursor, hasMore: Boolean(nextCursor) };
}

export function wanjuanMergeAccountRecordPages(current: any[], incoming: any[]) {
  const output = Array.isArray(current) ? [...current] : [];
  const seen = new Set(output.map((item, index) => String(item?.id || item?.ledgerId || `index:${index}`)));
  (Array.isArray(incoming) ? incoming : []).forEach((item, index) => {
    const key = String(item?.id || item?.ledgerId || `incoming:${index}`);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(item);
  });
  return output;
}

export function wanjuanAccountRecordRequestIsCurrent(options: {
  cancelled?: boolean;
  requestScope: string;
  currentScope: string;
  requestId: number;
  currentRequestId: number;
}) {
  return options.cancelled !== true
    && options.requestScope === options.currentScope
    && options.requestId === options.currentRequestId;
}

const localDateBoundary = (value: unknown, endExclusive = false) => {
  const match = String(value || ``).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ``;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return ``;
  if (endExclusive) date.setDate(date.getDate() + 1);
  return date.toISOString();
};

/** Convert date-only controls into RFC3339 instants with explicit timezone. */
export function wanjuanBuildAccountRecordTimeRange(fromDate: unknown, toDate: unknown) {
  const from = fromDate ? localDateBoundary(fromDate) : ``;
  const to = toDate ? localDateBoundary(toDate, true) : ``;
  if ((fromDate && !from) || (toDate && !to) || (from && to && Date.parse(from) >= Date.parse(to))) {
    throw new Error(`账单日期范围无效`);
  }
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

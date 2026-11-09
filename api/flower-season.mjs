import { DatabaseSync } from 'node:sqlite';
import { validDate } from '../lib/language.mjs';

export function readFlowerMonths(dbPath, startMonth, endMonth) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      WITH bounds(start_month, end_month) AS (VALUES (?, ?)), annual AS (
        SELECT name, SUM(bunches) AS total_bunches FROM flower_gift_monthly GROUP BY name
      ), monthly AS (
        SELECT *, CAST(SUBSTR(month, 6, 2) AS INTEGER) AS month_number
        FROM flower_gift_monthly
      )
      SELECT f.name, COUNT(DISTINCT SUBSTR(f.month, 1, 4)) AS years_observed,
             SUM(f.bunches) AS bunches,
             ROUND(SUM(f.bunches) * 100.0 / annual.total_bunches, 2) AS annual_share_pct
      FROM monthly f JOIN annual ON f.name = annual.name CROSS JOIN bounds
      WHERE (start_month <= end_month AND month_number BETWEEN start_month AND end_month)
         OR (start_month > end_month AND (month_number >= start_month OR month_number <= end_month))
      GROUP BY f.name, annual.total_bunches
      HAVING COUNT(DISTINCT SUBSTR(f.month, 1, 4)) >= 2
      ORDER BY annual_share_pct DESC, bunches DESC, f.name
    `).all(startMonth, endMonth);
  } finally {
    db.close();
  }
}

const periodPrompt = '몇 월에 선물할 꽃을 찾으세요? “5월”이나 “3~5월”처럼 알려주세요.';
const flowerRequest = /생화|꽃다발|제철\s*꽃|(?<![가-힣])꽃(?=$|[\s,.!?을를이은는으만도과에])/;
const otherFlowerTypes = /조화|비누꽃|드라이플라워|프리저브드/;
const excludedFlower = /(?:생화|꽃다발|꽃)(?:은|는|을|도)?\s*(?:말고|제외|빼|아닌|대신)/;
const seasons = { 봄: [3, 5], 여름: [6, 8], 가을: [9, 11], 겨울: [12, 2] };
const isMonth = month => month >= 1 && month <= 12;

function readPeriod(text, deliveryBy) {
  const range = text.match(/(?<!\d)(\d{1,2})\s*(?:월\s*)?(?:[~～-]|부터)\s*(\d{1,2})\s*월/);
  if (range) {
    const months = range.slice(1).map(Number);
    return months.every(isMonth) ? months : null;
  }
  const date = text.match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/)?.[0];
  if (date) {
    const month = Number(date.slice(5, 7));
    return validDate(date) ? [month, month] : null;
  }
  const months = [...new Set(Array.from(text.matchAll(/(?<!\d)(\d{1,2})\s*월/g), match => Number(match[1])))];
  if (months.length) return months.length === 1 && isMonth(months[0]) ? [months[0], months[0]] : null;
  const season = text.match(/(?:^|\s)(봄|여름|가을|겨울)(?=$|[\s,.!?에철쯤부터])/);
  if (season) return seasons[season[1]];
  if (!deliveryBy || !validDate(deliveryBy)) return null;
  const month = Number(deliveryBy.slice(5, 7));
  return [month, month];
}

export function createFlowerAdvice(dbPath) {
  // Verify the local dataset at startup so a misconfigured preview fails visibly.
  if (!readFlowerMonths(dbPath, 1, 12).length) throw Error('꽃 거래 통계가 비어 있습니다.');
  return ({ text, history, state, issues }) => {
    const explicit = flowerRequest.test(text) && !otherFlowerTypes.test(text) && !excludedFlower.test(text);
    const last = history.at(-1);
    const followUp = last?.role === 'assistant' && last.text === periodPrompt &&
      /^(?:\d{1,2}\s*월(?:\s*(?:[~～-]|부터)\s*\d{1,2}\s*월)?|\d{1,2}\s*[~～-]\s*\d{1,2}\s*월|\d{4}-\d{2}-\d{2}|봄|여름|가을|겨울)(?:에요|이에요|이요|요)?[.!]?$/.test(text.trim());
    if (!explicit && !followUp) return null;

    const period = readPeriod(text, state.delivery_by);
    const session = { state, issues };
    if (!period) {
      const question = { key: 'issue', text: periodPrompt, choices: [] };
      return { session, message: periodPrompt, question };
    }
    const [start, end] = period;
    const label = start === end ? `${start}월` : `${start}~${end}월`;
    const rows = readFlowerMonths(dbPath, start, end).slice(0, 3);
    const names = rows.map(row => row.name).join(', ');
    const message = rows.length
      ? `${label}에 선물할 생화로 ${names}을 추천해요. 2023~2025년 aT 양재 절화 경매에서 이 기간에 거래가 상대적으로 집중된 품목이에요. 꽃다발 가격과 재고는 꽃집에서 확인해 주세요.`
      : `${label}에 여러 해 반복해서 거래된 꽃을 찾지 못했어요. 다른 기간을 알려주세요.`;
    const question = { key: null, text: message, choices: [] };
    return { session, message, question };
  };
}

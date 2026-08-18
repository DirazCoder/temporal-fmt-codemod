import { format } from 'date-fns';
import dayjs from 'dayjs';

const d = new Date('2026-08-04T15:45:30');
const formatted = format(d, 'yyyy-MM-dd HH:mm:ss');
const dayjsFormatted = dayjs(d).format('YYYY-MM-DD HH:mm:ss');
const chained = dayjs(d).add(1, 'day').format('YYYY-MM-DD');
const ambiguous = dayjs(d).format('X'); // unix timestamp — no temporal-fmt equivalent
console.log(formatted, dayjsFormatted, chained, ambiguous);

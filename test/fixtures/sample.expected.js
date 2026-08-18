import { format } from 'date-fns';
import dayjs from 'dayjs';

const d = new Date('2026-08-04T15:45:30');
const formatted = format(d, "yyyy-MM-dd HH:mm:ss");
const dayjsFormatted = format(d, "yyyy-MM-dd HH:mm:ss");
const chained = format(d.add({
  days: 1
}), "yyyy-MM-dd");
const // TODO(temporal-fmt-codemod): dayjs tokens [X] have no direct temporal-fmt equivalent — see temporal-fmt's README "Tokens" table. Rewrite manually if needed.
ambiguous = dayjs(d).format('X'); // unix timestamp — no temporal-fmt equivalent
console.log(formatted, dayjsFormatted, chained, ambiguous);


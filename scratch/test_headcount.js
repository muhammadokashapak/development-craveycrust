import { checkFastRoute } from '../src/services/intentParser.js';

async function test() {
  const queries = [
    '3 bandon k lie best deal batao pizza ki',
    '3 bandon k lie deal batao',
    '3 logo k liye burger deal',
    '2 bandon k liye pizza deal',
    '4 bandon ki deal'
  ];

  for (const q of queries) {
    console.log(`\n========================================`);
    console.log(`INPUT: "${q}"`);
    const res = await checkFastRoute({ text: q });
    console.log(`HANDLED: ${res.handled} (Route: ${res.routeName})`);
    console.log(`REPLY:\n${res.reply}`);
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

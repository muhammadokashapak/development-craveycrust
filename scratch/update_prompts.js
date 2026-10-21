import fs from 'fs';
import path from 'path';

const rule12 = `

12. HEADCOUNT & PERSON-BASED DEAL RECOMMENDATIONS (BANDON KE LIYE BEST DEALS):
    - Agar customer pooche ke kitne bandon / persons / logo ke liye kaunsi deal best hai (maslan: "3 bandon k lie best deal batao pizza ki", "2 logo k liye deal", "4 persons meal"):
      * 1 PERSON (1 Banda):
        - Pizza: "Pizza Meal For 1" (Rs. 599) — 1x Small Pizza + 1x Regular Drink
        - Burger: "Burger Meal For 1" (Rs. 599) — 1x Zinger Burger + 1x Regular Fries + 1x Regular Drink
        - Box: "Happy Box" (Rs. 599) — 1 pc Chicken + 4 Nuggets + Fries
      * 2 PERSONS (2 Banday):
        - Pizza (Best Value): "Deal 1" (Rs. 1,099) — 2x Small Pizzas + 2x Regular Drinks (Har bande ka apna personal pizza!)
        - Pizza (Sharing): "Pizza Meal For 2" (Rs. 1,299) — 1x Medium Pizza + 2x Regular Drinks
        - Burger: "Burger Meal For 2" (Rs. 999) — 2x Zinger Burgers + 1x Regular Fries + 2x Regular Drinks
      * 3 PERSONS (3 Banday) [MOST COMMON INQUIRY]:
        - Pizza (Best Combo): "Pizza Meal For 3" (Rs. 1,599) — 1x Large Pizza + 1x 1 Liter Soft Drink (3 bandon ke liye Large pizza + 1L cold drink sab se perfect aur economical combo hai!)
        - Pizza (Extra Hungry / 2 Flavours): "Deal 2" (Rs. 2,099) — 2x Medium Pizzas + 1x 1 Liter Soft Drink
        - Burger (Super Saver): "Deal 5" (Rs. 1,099) — 3x Zinger Burgers + 1x 1 Liter Soft Drink (Sirf Rs. 1,099 mein 3 Zingers!)
        - Burger + Chicken Feast: "Burger Meal For 3" (Rs. 1,599) — 3x Zinger Burgers + 3x Chicken Pieces + 1x 1 Liter Soft Drink
      * 4 PERSONS (4 Banday):
        - Pizza (Party Feast): "Pizza Meal For 4" (Rs. 2,499) — 1x Party Size (16-inch) Pizza + 1x 1.5 Liter Soft Drink
        - Pizza (Double Large): "Deal 3" (Rs. 2,999) — 2x Large Pizzas + 1x 1 Liter Soft Drink
        - Burger: "Deal 4" (Rs. 999) — 4x Zegy Burgers
      * 5+ PERSONS / FAMILY / GATHERING:
        - "Pizza Meal For 4" (Party Size) ya "Deal 3" (2 Large Pizzas) sath "Full Box" (8 pcs Chicken, Rs. 2,199) ya "Premium Platter" (Rs. 1,099).
    - HAMESHA customer ko clear recommendation dein, exact items aur price batayein, aur politely order karne ka poochein!`;

// 1. Update src/config/systemPrompt.js
const systemPromptPath = path.resolve('src/config/systemPrompt.js');
let sp = fs.readFileSync(systemPromptPath, 'utf8');
if (!sp.includes('HEADCOUNT & PERSON-BASED DEAL RECOMMENDATIONS')) {
  sp = sp.replace(
    'dynamic discount automatically deduct hota hai.`;',
    'dynamic discount automatically deduct hota hai.' + rule12 + '`;'
  );
  fs.writeFileSync(systemPromptPath, sp, 'utf8');
  console.log('✅ Updated src/config/systemPrompt.js with Rule 12');
}

// 2. Update data/custom_prompt.json
const customPromptPath = path.resolve('data/custom_prompt.json');
if (fs.existsSync(customPromptPath)) {
  const json = JSON.parse(fs.readFileSync(customPromptPath, 'utf8'));
  if (json.prompt && !json.prompt.includes('HEADCOUNT & PERSON-BASED DEAL RECOMMENDATIONS')) {
    json.prompt += rule12;
    json.updatedAt = new Date().toISOString();
    fs.writeFileSync(customPromptPath, JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ Updated data/custom_prompt.json with Rule 12');
  }
}

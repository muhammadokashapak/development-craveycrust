import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/services/intentParser.js');
let content = fs.readFileSync(filePath, 'utf8');

const targetAnchor = '    // ── 3. Live Deals (General Deals List) (<= 7 words, no deal number, no order action) ──';

const insertCode = `    // ── 2g. Headcount / Person-based Deal Recommendations (Zero Tokens, e.g. "3 bandon k lie best deal batao pizza ki") ──
    const personQueryMatch = lower.match(/\\b(?:(\\d+|ek|aik|do|teen|tin|char|chaar|panch|paanch|one|two|three|four|five)\\s*(?:bandon|bande|bando|persons?|logon?|logo|people|afraad|members?|friends?|heads?|pax)|(?:for\\s*)(\\d+)\\s*(?:persons?|people|pax)?)\\b/i);
    const isDealOrRecommendQuery = /\\b(deal|deals|offer|offers|best|recommend|mangwa|mangwayen|kya\\s*(?:loun|lein|mangwayen|h)|chahiye|batao|bataiye|dikhao)\\b/i.test(lower);

    if (personQueryMatch && isDealOrRecommendQuery && !hasCartOrOrderAction) {
        let count = 0;
        const rawNum = (personQueryMatch[1] || personQueryMatch[2] || '').toLowerCase();
        if (/^(?:1|ek|aik|one)$/.test(rawNum)) count = 1;
        else if (/^(?:2|do|two)$/.test(rawNum)) count = 2;
        else if (/^(?:3|teen|tin|three)$/.test(rawNum)) count = 3;
        else if (/^(?:4|char|chaar|four)$/.test(rawNum)) count = 4;
        else if (/^(?:5|panch|paanch|five)$/.test(rawNum)) count = 5;
        else if (!isNaN(parseInt(rawNum, 10))) count = parseInt(rawNum, 10);

        if (count >= 1) {
            const isPizza = /\\b(pi[z]+a|piza)\\b/i.test(lower);
            const isBurger = /\\b(burger|zinger)\\b/i.test(lower);

            let recReply = '';
            if (count === 3) {
                if (isBurger) {
                    recReply = \`🍔 *3 Bandon ke liye Best Burger Deals:*\\n\\n\` +
                        \`1️⃣ *Deal 5* — Rs. 1,099 (Super Saver)\\n\` +
                        \`• 3x Crispy Zinger Burgers\\n\` +
                        \`• 1x 1 Liter Chilled Soft Drink\\n\` +
                        \`_(Sirf Rs. 1,099 mein 3 Zingers + 1L cold drink!)\\_\\n\\n\` +
                        \`2️⃣ *Burger Meal For 3* — Rs. 1,599 (Full Feast)\\n\` +
                        \`• 3x Zinger Burgers\\n\` +
                        \`• 3x Crispy Chicken Pieces\\n\` +
                        \`• 1x 1 Liter Chilled Soft Drink\\n\\n\` +
                        \`Aapke liye kaunsi deal add karun? Bas deal ka naam bata dein! 😊\`;
                } else if (isPizza) {
                    recReply = \`🍕 *3 Bandon ke liye Best Pizza Deals:*\\n\\n\` +
                        \`1️⃣ *Pizza Meal For 3* — Rs. 1,599 ⭐ (Sab se Best & Recommended)\\n\` +
                        \`• 1x Large Pizza (Apni pasand ke kisi bhi flavour mein!)\\n\` +
                        \`• 1x 1 Liter Chilled Soft Drink\\n\` +
                        \`_(3 bandon ke liye Large pizza aur 1 Liter cold drink sab se perfect aur economical combo hai!)\\_\\n\\n\` +
                        \`2️⃣ *Deal 2* — Rs. 2,099 (2 Pizzas Combo)\\n\` +
                        \`• 2x Medium Pizzas\\n\` +
                        \`• 1x 1 Liter Chilled Soft Drink\\n\` +
                        \`_(Agar alag alag flavours pasand hon to 2 Medium pizzas best hain!)\\_\\n\\n\` +
                        \`Aapke liye kaunsi deal add karun? Bas deal ka naam bata dein (jaise *'Pizza Meal For 3'* ya *'Deal 2'*)! 😊\`;
                } else {
                    recReply = \`🎉 *3 Bandon ke liye Cravey Crust ki Best Deals:*\\n\\n\` +
                        \`🍕 *PIZZA OPTION:*\\n\` +
                        \`• *Pizza Meal For 3* — Rs. 1,599 (1x Large Pizza + 1x 1 Liter Soft Drink)\\n\\n\` +
                        \`🍔 *BURGER OPTION:*\\n\` +
                        \`• *Deal 5* — Rs. 1,099 (3x Zinger Burgers + 1x 1 Liter Soft Drink)\\n\` +
                        \`• *Burger Meal For 3* — Rs. 1,599 (3x Zinger Burgers + 3x Chicken Pieces + 1x 1L Drink)\\n\\n\` +
                        \`Aap kya pasand karenge — Pizza ya Burgers? Deal ka naam bata dein, foran add kar denge! 😊\`;
                }
            } else if (count === 2) {
                if (isBurger) {
                    recReply = \`🍔 *2 Bandon ke liye Best Burger Deal:*\\n\\n\` +
                        \`• *Burger Meal For 2* — Rs. 999\\n\` +
                        \`• 2x Crispy Zinger Burgers\\n\` +
                        \`• 1x Regular Fries\\n\` +
                        \`• 2x Regular Soft Drinks\\n\\n\` +
                        \`Kya yeh deal aapke liye cart mein add kar doon? 😊\`;
                } else if (isPizza) {
                    recReply = \`🍕 *2 Bandon ke liye Best Pizza Deals:*\\n\\n\` +
                        \`1️⃣ *Deal 1* — Rs. 1,099 ⭐ (Best Value)\\n\` +
                        \`• 2x Small Pizzas (Dono ke liye apna personal pizza!)\\n\` +
                        \`• 2x Regular Soft Drinks\\n\\n\` +
                        \`2️⃣ *Pizza Meal For 2* — Rs. 1,299\\n\` +
                        \`• 1x Medium / Regular Pizza\\n\` +
                        \`• 2x Regular Soft Drinks\\n\\n\` +
                        \`Aapke liye kaunsi deal add karun? 😊\`;
                } else {
                    recReply = \`🎉 *2 Bandon ke liye Best Deals:*\\n\\n\` +
                        \`🍕 *Deal 1* — Rs. 1,099 (2x Small Pizzas + 2x Regular Drinks)\\n\` +
                        \`🍕 *Pizza Meal For 2* — Rs. 1,299 (1x Medium Pizza + 2x Regular Drinks)\\n\` +
                        \`🍔 *Burger Meal For 2* — Rs. 999 (2x Zinger Burgers + Fries + 2x Drinks)\\n\\n\` +
                        \`Aapko kaunsi pasand hai? Bas naam bata dein! 😊\`;
                }
            } else if (count === 1) {
                if (isBurger) {
                    recReply = \`🍔 *1 Person ke liye Best Burger Deal:*\\n\\n\` +
                        \`• *Burger Meal For 1* — Rs. 599\\n\` +
                        \`• 1x Crispy Zinger Burger\\n\` +
                        \`• 1x Regular Fries\\n\` +
                        \`• 1x Regular Soft Drink\\n\\n\` +
                        \`Kya yeh add kar doon? 😊\`;
                } else {
                    recReply = \`🍕 *1 Person ke liye Best Pizza Meal:*\\n\\n\` +
                        \`• *Pizza Meal For 1* — Rs. 599\\n\` +
                        \`• 1x Small Pizza (Apni pasand ke flavour mein!)\\n\` +
                        \`• 1x Regular Soft Drink\\n\\n\` +
                        \`Kya yeh add kar doon? 😊\`;
                }
            } else if (count === 4) {
                if (isBurger) {
                    recReply = \`🍔 *4 Bandon ke liye Best Burger Deal:*\\n\\n\` +
                        \`• *Deal 4* — Rs. 999 ⭐ (Super Value)\\n\` +
                        \`• 4x Juicy Zegy Burgers\\n\` +
                        \`_(Sirf Rs. 999 mein 4 burgers!)\\_\\n\\n\` +
                        \`Kya yeh deal add kar doon? 😊\`;
                } else {
                    recReply = \`🍕 *4 Bandon ke liye Best Pizza Deals:*\\n\\n\` +
                        \`1️⃣ *Pizza Meal For 4* — Rs. 2,499 ⭐ (Party Feast)\\n\` +
                        \`• 1x Giant Party Size Pizza (16 Inches!)\\n\` +
                        \`• 1x 1.5 Liter Chilled Soft Drink\\n\\n\` +
                        \`2️⃣ *Deal 3* — Rs. 2,999 (2 Large Pizzas)\\n\` +
                        \`• 2x Large Pizzas\\n\` +
                        \`• 1x 1 Liter Soft Drink\\n\\n\` +
                        \`Aapke liye kaunsi deal add karun? 😊\`;
                }
            } else {
                recReply = \`🎉 *\${count} Bandon / Party ke liye Cravey Crust ki Best Deals:*\\n\\n\` +
                    \`🍕 *Pizza Meal For 4* — Rs. 2,499 (1x Giant Party Size 16-inch Pizza + 1.5L Drink)\\n\` +
                    \`🍕 *Deal 3* — Rs. 2,999 (2x Large Pizzas + 1L Drink)\\n\` +
                    \`🍗 *Full Box* — Rs. 2,199 (8 Pcs Fresh Fried Chicken + Fries + Garlic Sauce + 2 Buns)\\n\` +
                    \`🍱 *Premium Platter* — Rs. 1,099 (4 Pcs Behari Roll + 6 Pcs Wings + Fries & Dip)\\n\\n\` +
                    \`Aap kitne pizzas ya burgers order karna chahenge? Hum aapke liye best combo ready kar dete hain! 😊\`;
            }

            return {
                handled: true,
                routeName: 'headcount_deal_recommendation',
                reply: recReply,
            };
        }
    }

`;

if (!content.includes('Headcount / Person-based Deal Recommendations')) {
    content = content.replace(targetAnchor, insertCode + targetAnchor);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ Successfully inserted headcount deal recommendation route in intentParser.js');
} else {
    console.log('ℹ️ Headcount deal recommendation already exists in intentParser.js');
}

import { getDbClient } from '../src/db/client.js';

async function check() {
  const p = getDbClient();
  const rest = await p.restaurant.findUnique({ where: { slug: 'cravey-crust' } });
  const cats = await p.category.findMany({
    where: { restaurant_id: rest.id },
    include: { menu_items: { include: { variants: true } } },
    orderBy: { sort_order: 'asc' }
  });
  console.log('=== Cravey Crust Categories & Items ===');
  for (const c of cats) {
    console.log(`Cat [${c.sort_order}]: ${c.name} (${c.menu_items.length} items)`);
    for (const item of c.menu_items) {
      console.log(`   - ${item.name} (Rs. ${item.base_price}) [variants: ${item.variants.map(v => v.name + ': ' + v.price).join(', ')}]`);
    }
  }

  const deals = await p.deal.findMany({
    where: { restaurant_id: rest.id },
    include: { deal_items: { include: { menu_item: true, menu_variant: true } } },
    orderBy: { sort_order: 'asc' }
  });
  console.log('\n=== Cravey Crust Deals in Deals Table ===');
  for (const d of deals) {
    console.log(`Deal [${d.sort_order}]: ${d.name} (Rs. ${d.deal_price}) -> Items: ${d.deal_items.map(di => di.quantity + 'x ' + di.menu_item.name + (di.menu_variant ? ' (' + di.menu_variant.name + ')' : '')).join(', ')}`);
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

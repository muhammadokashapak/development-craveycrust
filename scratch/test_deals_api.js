import { generateAdminToken } from '../src/services/authService.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';

async function test() {
  const restId = await getDefaultRestaurantId();
  const token = generateAdminToken({
    id: 'admin-test',
    username: 'admin',
    restaurantId: restId,
    role: 'SUPER_ADMIN'
  });

  const r = await fetch('http://localhost:3000/api/admin/deals', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const d = await r.json();
  console.log('API /api/admin/deals success:', d.success);
  console.log('Deals count in Admin API:', d.data ? d.data.length : 0);
  if (d.data) {
    d.data.forEach(x => {
      const items = x.items && x.items.length > 0 ? x.items.map(i => `${i.quantity}x ${i.item_name}${i.variant_name ? ' (' + i.variant_name + ')' : ''}`).join(', ') : 'none';
      console.log(`• ${x.name} (Rs. ${x.deal_price}) -> Items: [${items}] | Description: ${x.description || 'null'}`);
    });
  }
}
test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

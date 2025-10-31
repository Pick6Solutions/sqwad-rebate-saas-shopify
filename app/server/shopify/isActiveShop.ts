import { db } from '../firebase';

export async function isActiveShop(shopDomain: string): Promise<boolean> {
  console.log(shopDomain)
  const snap = await db.doc(`shops/${shopDomain}`).get();
  return snap.exists && snap.get('active') === true;
}

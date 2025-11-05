import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebase";

export type GameRecord = {
  id: string;
  name?: string | null;
  startAt?: Timestamp | null;
  endAt?: Timestamp | null;
  active?: boolean | null;
  [key: string]: unknown;
};

/**
 * Finds the most recent game whose `active` flag is true.
 * Returns null if no scheduled/active game exists for the shop.
 */
export async function findActiveGame(
  shopId: string
): Promise<{ id: string; data: GameRecord } | null> {
  const gamesCol = db.collection("shops").doc(shopId).collection("games");
  const snapshot = await gamesCol
    .where("active", "==", true)
    .orderBy("startAt", "desc")
    .limit(1)
    .get();

  const doc = snapshot.docs[0];
  if (!doc) return null;
  const data = (doc.data() || {}) as GameRecord;
  return { id: doc.id, data: { ...data, id: doc.id } };
}

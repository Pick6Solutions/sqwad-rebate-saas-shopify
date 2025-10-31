import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from "node:fs";
import path from "node:path";

const projectId = process.env.FIREBASE_PROJECT_ID;

// ESM-safe: no `require`
function credential() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p) {
    // Use absolute path; resolve from CWD if relative
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (fs.existsSync(abs)) {
      const json = JSON.parse(fs.readFileSync(abs, "utf8"));
      return cert(json);
    } else {
      console.warn(`[firebase] GOOGLE_APPLICATION_CREDENTIALS not found at ${abs}; falling back to applicationDefault()`);
    }
  }
  return applicationDefault();
}

if (!getApps().length) {
  initializeApp({ credential: credential(), projectId });
}

export const db = getFirestore();
export const auth = getAuth();
// Re-export FieldValue if you use it elsewhere
export { FieldValue };

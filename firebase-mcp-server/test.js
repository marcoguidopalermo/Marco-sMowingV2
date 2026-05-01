import admin from "firebase-admin";
import fs from "fs";
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
async function test() {
  try {
    const collections = await db.listCollections();
    console.log("✅ SUCCESS! Conectado a Firebase. Colecciones encontradas: " + collections.map(c => c.id).join(", "));
  } catch (e) {
    console.error("❌ ERROR!", e.message);
  }
}
test();

import admin from "firebase-admin";
import fs from "fs";
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
async function test() {
  try {
    const doc = await db.collection('artifacts').doc('default-app-id').get();
    if (doc.exists) {
      console.log("✅ DATA FOUND!");
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.log("❌ Document default-app-id NOT FOUND!");
    }
  } catch (e) {
    console.error("❌ ERROR!", e.message);
  }
}
test();

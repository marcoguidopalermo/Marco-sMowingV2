import admin from "firebase-admin";
import fs from "fs";
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
async function getLink() {
  try {
    const link = await admin.auth().generatePasswordResetLink("marcoguidopalermo@gmail.com");
    console.log("RESET LINK: " + link);
  } catch (e) {
    console.error("ERROR: ", e.message);
  }
}
getLink();

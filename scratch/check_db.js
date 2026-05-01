import admin from 'firebase-admin';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./firebase-mcp-server/serviceAccountKey.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function check() {
  try {
    const doc = await db.collection('artifacts').doc('default-app-id').get();
    if (doc.exists) {
      console.log('Document found:', JSON.stringify(doc.data(), null, 2).substring(0, 500) + '...');
    } else {
      console.log('Document default-app-id not found in collection artifacts.');
    }
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

check();

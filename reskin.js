import fs from 'fs';

let content = fs.readFileSync('src/App.jsx', 'utf8');

// Replace colors
content = content.replace(/amber-/g, 'lime-');
content = content.replace(/blue-/g, 'green-');
content = content.replace(/indigo-/g, 'teal-');

// Replace HardHat with Leaf
content = content.replace(/HardHat/g, 'Leaf');

// English fixes (No more spanish)
// Look for any remaining spanish strings if I added any?
// Actually, earlier I added a toast message in Spanish in the test script, but App.jsx has mostly English.
// Let's check for any Spanish text in App.jsx.

fs.writeFileSync('src/App.jsx', content);
console.log('Reskinned App.jsx successfully.');

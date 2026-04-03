const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const puzzlesDir = path.join(root, 'assets', 'puzzles');
const outFile = path.join(root, 'data', 'puzzles.json');
const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function toTitle(name) {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function main() {
  if (!fs.existsSync(puzzlesDir)) fs.mkdirSync(puzzlesDir, { recursive: true });

  const items = fs.readdirSync(puzzlesDir)
    .filter((file) => allowed.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((file, idx) => {
      const base = path.basename(file, path.extname(file));
      return {
        id: base,
        title: toTitle(base),
        image: `assets/puzzles/${file}`,
        theme: 'Библейский пазл',
        verse: '',
        caption: '',
        order: idx + 1
      };
    });

  const payload = {
    generatedAt: new Date().toISOString(),
    items
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Generated ${items.length} puzzles -> ${path.relative(root, outFile)}`);
}

main();

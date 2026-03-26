const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const W = 2400, H = 3000;
const BG = '#FAF6F0';
const DARK = '#2C2C2C';
const ACCENT = '#8B4513';
const GOLD = '#C49A3C';
const fontPath = path.join(__dirname, 'fonts', 'Bravura.otf');
const bravuraBase64 = fs.readFileSync(fontPath).toString('base64');

// SMuFL codepoints for Bravura
const SYM = {
  whole:     '\uE1D2', half:      '\uE1D3', quarter:   '\uE1D5',
  eighth:    '\uE1D7', sixteenth: '\uE1D9',
  wholeRest: '\uE4E3', halfRest:  '\uE4E4', quarterRest: '\uE4E5',
  eighthRest:'\uE4E6', sixteenthRest:'\uE4E7',
  treble:    '\uE050', bass:      '\uE062',
  sharp:     '\uE262', flat:      '\uE260', natural:   '\uE261',
  staff5:    '\uE014',
};

const notes = [
  { sym: 'whole', rest: 'wholeRest', name: 'Whole Note', beats: '4 beats', restName: 'Whole Rest' },
  { sym: 'half', rest: 'halfRest', name: 'Half Note', beats: '2 beats', restName: 'Half Rest' },
  { sym: 'quarter', rest: 'quarterRest', name: 'Quarter Note', beats: '1 beat', restName: 'Quarter Rest' },
  { sym: 'eighth', rest: 'eighthRest', name: 'Eighth Note', beats: '½ beat', restName: 'Eighth Rest' },
  { sym: 'sixteenth', rest: 'sixteenthRest', name: 'Sixteenth Note', beats: '¼ beat', restName: 'Sixteenth Rest' },
];

// Staff lines helper
function staffLines(x, y, w, count=5) {
  let s = '';
  for (let i = 0; i < count; i++) {
    s += `<line x1="${x}" y1="${y + i*24}" x2="${x+w}" y2="${y + i*24}" stroke="#AAA" stroke-width="2"/>`;
  }
  return s;
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <style>
    @font-face {
      font-family: 'Bravura';
      src: url('data:font/opentype;base64,${bravuraBase64}');
    }
  </style>
  <linearGradient id="headerGrad" x1="0" y1="0" x2="${W}" y2="0">
    <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.15"/>
    <stop offset="50%" stop-color="${GOLD}" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="${GOLD}" stop-opacity="0.15"/>
  </linearGradient>
  <filter id="shadow" x="-2%" y="-2%" width="104%" height="104%">
    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.08"/>
  </filter>
</defs>

<rect width="${W}" height="${H}" fill="${BG}"/>

<!-- Decorative top border -->
<rect x="0" y="0" width="${W}" height="12" fill="${GOLD}"/>
<rect x="0" y="12" width="${W}" height="3" fill="${ACCENT}"/>

<!-- Header background -->
<rect x="0" y="40" width="${W}" height="280" fill="url(#headerGrad)"/>

<!-- Title with treble clef decoration -->
<text x="320" y="210" font-family="Bravura" font-size="160" fill="${GOLD}" opacity="0.5">${SYM.treble}</text>
<text x="${W/2}" y="170" font-family="Georgia, serif" font-size="108" font-weight="bold" fill="${DARK}" text-anchor="middle" letter-spacing="8">NOTE VALUES</text>
<text x="${W/2}" y="250" font-family="Georgia, serif" font-size="64" fill="${ACCENT}" text-anchor="middle" letter-spacing="12">&amp; RESTS</text>
<text x="${W-320}" y="210" font-family="Bravura" font-size="160" fill="${GOLD}" opacity="0.5" text-anchor="end">${SYM.bass}</text>

<!-- Decorative line -->
<line x1="400" y1="290" x2="${W-400}" y2="290" stroke="${GOLD}" stroke-width="2"/>
<circle cx="${W/2}" cy="290" r="6" fill="${GOLD}"/>
<circle cx="400" cy="290" r="4" fill="${GOLD}"/>
<circle cx="${W-400}" cy="290" r="4" fill="${GOLD}"/>

<!-- Column Headers -->
<rect x="150" y="350" width="${W-300}" height="70" fill="${DARK}" rx="8"/>
<text x="430" y="398" font-family="Georgia, serif" font-size="36" fill="${BG}" text-anchor="middle" letter-spacing="4">NOTE</text>
<text x="920" y="398" font-family="Georgia, serif" font-size="36" fill="${BG}" text-anchor="middle" letter-spacing="4">NAME</text>
<text x="1350" y="398" font-family="Georgia, serif" font-size="36" fill="${BG}" text-anchor="middle" letter-spacing="4">DURATION</text>
<text x="1750" y="398" font-family="Georgia, serif" font-size="36" fill="${BG}" text-anchor="middle" letter-spacing="4">REST</text>
<text x="${W-220}" y="398" font-family="Georgia, serif" font-size="36" fill="${BG}" text-anchor="middle" letter-spacing="4">REST</text>
`;

const startY = 520;
const rowH = 260;

notes.forEach((n, i) => {
  const y = startY + i * rowH;
  const cy = y + rowH/2;
  
  // Row background
  if (i % 2 === 0) {
    svg += `<rect x="150" y="${y}" width="${W-300}" height="${rowH}" fill="#F0E8D8" rx="6" filter="url(#shadow)"/>`;
  } else {
    svg += `<rect x="150" y="${y}" width="${W-300}" height="${rowH}" fill="#FAF4EA" rx="6" filter="url(#shadow)"/>`;
  }
  
  // Staff lines behind note
  svg += staffLines(280, cy - 48, 300);
  
  // Note symbol (Bravura)
  svg += `<text x="430" y="${cy + 12}" font-family="Bravura" font-size="120" fill="${DARK}" text-anchor="middle">${SYM[n.sym]}</text>`;
  
  // Name
  svg += `<text x="920" y="${cy - 10}" font-family="Georgia, serif" font-size="46" font-weight="bold" fill="${DARK}" text-anchor="middle">${n.name}</text>`;
  svg += `<text x="920" y="${cy + 40}" font-family="Georgia, serif" font-size="30" fill="#888" text-anchor="middle">${n.restName}</text>`;
  
  // Duration with beat visualization
  svg += `<text x="1350" y="${cy + 5}" font-family="Georgia, serif" font-size="56" font-weight="bold" fill="${ACCENT}" text-anchor="middle">${n.beats}</text>`;
  
  // Beat dots
  const beatCount = [4, 2, 1, 0.5, 0.25][i];
  const dotCount = Math.min(beatCount * 4, 16);
  const dotSpacing = 30;
  const dotStartX = 1350 - (dotCount - 1) * dotSpacing / 2;
  for (let d = 0; d < dotCount; d++) {
    const filled = d < (beatCount <= 1 ? dotCount : beatCount * 4);
    svg += `<circle cx="${dotStartX + d * dotSpacing}" cy="${cy + 50}" r="8" fill="${filled ? GOLD : '#DDD'}" opacity="${filled ? 0.7 : 0.3}"/>`;
  }
  
  // Staff lines behind rest
  svg += staffLines(1600, cy - 48, 300);
  
  // Rest symbol (Bravura)
  svg += `<text x="1750" y="${cy + 12}" font-family="Bravura" font-size="120" fill="${DARK}" text-anchor="middle">${SYM[n.rest]}</text>`;
  
  // Equivalent notation
  svg += `<text x="${W-220}" y="${cy + 5}" font-family="Georgia, serif" font-size="36" fill="${GOLD}" text-anchor="middle">= ${n.beats}</text>`;
});

// Duration Tree Section
const treeY = startY + notes.length * rowH + 60;
svg += `
<rect x="150" y="${treeY}" width="${W-300}" height="580" fill="#EDE5D5" rx="12" filter="url(#shadow)"/>
<text x="${W/2}" y="${treeY + 70}" font-family="Georgia, serif" font-size="56" font-weight="bold" fill="${DARK}" text-anchor="middle" letter-spacing="6">DURATION TREE</text>
<text x="${W/2}" y="${treeY + 115}" font-family="Georgia, serif" font-size="30" fill="#888" text-anchor="middle">Each note divides into two of the next smaller value</text>
`;

const levels = [
  { count: 1, sym: 'whole', label: '1 Whole' },
  { count: 2, sym: 'half', label: '2 Halves' },
  { count: 4, sym: 'quarter', label: '4 Quarters' },
  { count: 8, sym: 'eighth', label: '8 Eighths' },
];

const treeStartY = treeY + 170;
const treeH = 100;
const treeLeft = 350;
const treeRight = W - 550;

levels.forEach((lv, li) => {
  const y2 = treeStartY + li * treeH;
  const spacing = (treeRight - treeLeft) / (lv.count + 1);
  
  for (let j = 0; j < lv.count; j++) {
    const cx = treeLeft + spacing * (j + 1);
    
    // Connection lines to parent
    if (li > 0) {
      const parentCount = levels[li-1].count;
      const parentSpacing = (treeRight - treeLeft) / (parentCount + 1);
      const parentX = treeLeft + parentSpacing * (Math.floor(j/2) + 1);
      svg += `<line x1="${parentX}" y1="${treeStartY + (li-1) * treeH + 25}" x2="${cx}" y2="${y2 - 25}" stroke="${GOLD}" stroke-width="2" opacity="0.5"/>`;
    }
    
    // Note symbol
    svg += `<text x="${cx}" y="${y2 + 15}" font-family="Bravura" font-size="60" fill="${DARK}" text-anchor="middle">${SYM[lv.sym]}</text>`;
  }
  
  // Label
  svg += `<text x="${W - 280}" y="${y2 + 10}" font-family="Georgia, serif" font-size="30" fill="${ACCENT}" text-anchor="middle">${lv.label}</text>`;
});

// Footer
svg += `
<rect x="0" y="${H-60}" width="${W}" height="60" fill="${DARK}"/>
<text x="${W/2}" y="${H-22}" font-family="Georgia, serif" font-size="26" fill="#CCC" text-anchor="middle" letter-spacing="4">MUSIC THEORY ESSENTIALS</text>

<!-- Corner decorations -->
<text x="80" y="${H-80}" font-family="Bravura" font-size="80" fill="${GOLD}" opacity="0.2">${SYM.treble}</text>
<text x="${W-80}" y="${H-80}" font-family="Bravura" font-size="80" fill="${GOLD}" opacity="0.2" text-anchor="end">${SYM.bass}</text>
</svg>`;

// Render
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
  font: { 
    loadSystemFonts: true,
    fontDirs: [path.join(__dirname, 'fonts')]
  }
});
const pngData = resvg.render();
const buf = pngData.asPng();
fs.writeFileSync('/private/tmp/note-values-v2.png', buf);
console.log('Done! Size:', (buf.length/1024).toFixed(0), 'KB');
console.log('File: /private/tmp/note-values-v2.png');
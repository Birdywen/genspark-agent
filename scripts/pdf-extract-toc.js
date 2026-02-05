const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const pdfPath = process.argv[2] || '/Users/yay/Downloads/It_39_s_Easy_To_Play_Popular_Classics.pdf';

async function extractText() {
  const buffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse(buffer);
  const data = await parser.parse();
  
  console.log('Total pages:', data.numpages);
  console.log('\n=== First 8000 chars of text ===\n');
  console.log(data.text.substring(0, 8000));
}

extractText().catch(console.error);

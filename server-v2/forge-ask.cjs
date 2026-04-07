var fs = require('fs');
var prompt = fs.readFileSync('/tmp/forge-db-expert-prompt.json', 'utf8');
var messages = JSON.parse(prompt);

// Build a single prompt string from the messages
var fullPrompt = messages.map(function(m) {
  return '[' + m.role + ']\n' + m.content;
}).join('\n\n');

fs.writeFileSync('/tmp/forge-db-expert-flat.txt', fullPrompt);
console.log('Flat prompt saved.', fullPrompt.length, 'chars');

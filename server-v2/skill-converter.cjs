const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const db = new Database('data/agent.db');

const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === 'export') {
  // DB -> MD: 导出一个或全部 skill 为 SKILL.md 格式
  const skills = arg 
    ? [db.prepare("SELECT * FROM skills WHERE name=?").get(arg)]
    : db.prepare("SELECT * FROM skills WHERE enabled=1").all();
  
  const outDir = arg ? null : '/private/tmp/skills-export';
  if (!arg) fs.mkdirSync(outDir, { recursive: true });

  for (const s of skills) {
    if (!s) { console.log('Skill not found: ' + arg); continue; }
    const tags = s.tags ? s.tags.split(',').map(t => t.trim()) : [];
    let md = '---\n';
    md += 'name: ' + s.name + '\n';
    md += 'description: ' + s.description.replace(/\n/g, ' ') + '\n';
    if (s.version) md += 'metadata:\n  version: ' + s.version + '\n  category: ' + (s.category || 'general') + '\n  source: ' + (s.source || 'custom') + '\n';
    if (tags.length) md += '  tags: [' + tags.join(', ') + ']\n';
    md += '---\n\n';
    md += s.instructions + '\n';

    if (arg) {
      console.log(md);
    } else {
      const dir = path.join(outDir, s.name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
      console.log('Exported: ' + s.name + ' -> ' + dir);
    }
  }
  if (!arg) console.log('\nAll exported to ' + outDir);

} else if (cmd === 'import') {
  // MD -> DB: 从 SKILL.md 文件或目录导入
  const target = arg;
  if (!target) { console.log('Usage: node skill-converter.cjs import <path-to-SKILL.md-or-dir>'); process.exit(1); }

  const files = [];
  if (fs.statSync(target).isDirectory()) {
    // 扫描目录下所有 SKILL.md
    const scan = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) scan(full);
        else if (f === 'SKILL.md') files.push(full);
      }
    };
    scan(target);
  } else {
    files.push(target);
  }

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // 解析 YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) { console.log('SKIP (no frontmatter): ' + file); continue; }
    
    const fm = fmMatch[1];
    const body = fmMatch[2].trim();
    
    // 简单 YAML 解析
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    const versionMatch = fm.match(/version:\s*(.+)$/m);
    const categoryMatch = fm.match(/category:\s*(.+)$/m);
    const tagsMatch = fm.match(/tags:\s*\[(.+)\]/m);
    
    if (!nameMatch) { console.log('SKIP (no name): ' + file); continue; }
    
    const name = nameMatch[1].trim();
    const desc = descMatch ? descMatch[1].trim() : name;
    const version = versionMatch ? versionMatch[1].trim() : '1.0.0';
    const category = categoryMatch ? categoryMatch[1].trim() : 'imported';
    const tags = tagsMatch ? tagsMatch[1].trim() : 'imported';
    
    // 检查 scripts 目录
    const skillDir = path.dirname(file);
    const scriptsDir = path.join(skillDir, 'scripts');
    let scripts = null;
    if (fs.existsSync(scriptsDir)) {
      const scriptFiles = {};
      for (const sf of fs.readdirSync(scriptsDir)) {
        scriptFiles[sf] = fs.readFileSync(path.join(scriptsDir, sf), 'utf8');
      }
      scripts = JSON.stringify(scriptFiles);
    }

    // 检查 references 目录
    const refsDir = path.join(skillDir, 'references');
    let refs = null;
    if (fs.existsSync(refsDir)) {
      const refFiles = {};
      for (const rf of fs.readdirSync(refsDir)) {
        const full = path.join(refsDir, rf);
        if (fs.statSync(full).isFile()) {
          refFiles[rf] = fs.readFileSync(full, 'utf8');
        }
      }
      refs = JSON.stringify(refFiles);
    }

    db.prepare(`INSERT OR REPLACE INTO skills (name, description, category, instructions, scripts, references_data, source, tags, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'imported-md', ?, ?, datetime('now'))`).run(
      name, desc, category, body, scripts, refs, tags, version
    );
    console.log('Imported: ' + name + ' from ' + file);
  }

} else if (cmd === 'list') {
  const skills = db.prepare("SELECT name, category, enabled, LENGTH(instructions) as len, tags FROM skills ORDER BY category, name").all();
  for (const s of skills) {
    const mark = s.enabled ? 'ON' : 'OFF';
    console.log(`[${mark}] ${s.category}/${s.name} (${s.len} chars) ${s.tags || ''}`);
  }
  console.log('\nTotal: ' + skills.length);

} else {
  console.log('Usage:');
  console.log('  node skill-converter.cjs list                    — 列出所有 skills');
  console.log('  node skill-converter.cjs export [name]           — 导出为 SKILL.md (name=单个, 不填=全部)');
  console.log('  node skill-converter.cjs import <path>           — 从 SKILL.md 文件或目录导入');
}

db.close();
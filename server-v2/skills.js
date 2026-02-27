// Skills 加载模块
// 自动加载 skills 目录下的所有 Skill，生成系统提示

import { readFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const KNOWLEDGE_DB = path.join(__dirname, '..', '..', '.agent_memory', 'project_knowledge.db');

class SkillsManager {
  constructor() {
    this.skills = [];
    this.systemPrompt = '';
  }

  /**
   * 加载所有 Skills
   */
  load() {
    // 检查 skills 目录是否存在
    if (!existsSync(SKILLS_DIR)) {
      console.log('⚠️  Skills 目录不存在，跳过加载');
      return;
    }

    // 读取 skills.json 索引
    const indexPath = path.join(SKILLS_DIR, 'skills.json');
    if (!existsSync(indexPath)) {
      console.log('⚠️  skills.json 不存在，跳过加载');
      return;
    }

    try {
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
      this.skills = index.skills || [];
      
      // 生成系统提示
      this.systemPrompt = this._generateSystemPrompt();
      
      console.log(`✅ 已加载 ${this.skills.length} 个 Skills`);
      this.skills.forEach(s => {
        console.log(`   - ${s.name}: ${s.description}`);
      });
    } catch (e) {
      console.error('❌ 加载 Skills 失败:', e.message);
    }
  }

  /**
   * 从数据库加载踩坑经验
   */
  _loadLessons() {
    if (!existsSync(KNOWLEDGE_DB)) return '';
    
    try {
      const rows = execSync(
        `sqlite3 -json "${KNOWLEDGE_DB}" "SELECT category, title, problem, solution FROM lessons_learned WHERE integrated = 0 AND category IN ('eval_js','ffmpeg') ORDER BY category, id"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      
      if (!rows || rows === '[]') return '';
      
      const lessons = JSON.parse(rows);
      let prompt = '\n# ⚠️ 踩坑经验（每次对话必读）\n\n';
      let currentCat = '';
      
      for (const l of lessons) {
        if (l.category !== currentCat) {
          currentCat = l.category;
          prompt += `\n## ${currentCat}\n\n`;
        }
        prompt += `### ${l.title}\n`;
        prompt += `**问题**: ${l.problem}\n`;
        prompt += `**解决**: ${l.solution}\n\n`;
      }
      
      return prompt;
    } catch (e) {
      console.error('⚠️ 加载踩坑经验失败:', e.message);
      return '';
    }
  }

  /**
   * 生成系统提示
   */
  _generateSystemPrompt() {
    // .ai-env.md 内容已合并到主 prompt，不再重复加载
    
    // 尝试读取预生成的系统提示
    const promptPath = path.join(SKILLS_DIR, 'SYSTEM_PROMPT_SKILLS.md');
    if (existsSync(promptPath)) {
      return readFileSync(promptPath, 'utf-8');
    }

    // 动态生成简短摘要（详细文档按需加载）
    let prompt = '# 已加载的 Skills\n\n';
    prompt += '以下 Skills 可用。需要详细参数时，读取对应的参考文档。\n\n';
    
    for (const skill of this.skills) {
      prompt += `- **${skill.name}**: ${skill.description}`;
      if (skill.tools && skill.tools.length > 0) {
        prompt += ` (${skill.tools.length} 个工具)`;
      }
      prompt += '\n';
    }
    
    prompt += `\n如需使用 Skill，可读取 \`${SKILLS_DIR}/<skill-name>/SKILL.md\` 获取详细指南。\n`;
    prompt += `\n如需查看完整工具文档，读取 \`/Users/yay/workspace/genspark-agent/docs/TOOLS_GUIDE.md\`\n`;
    
    // 自动加载踩坑经验
    const lessonsPrompt = this._loadLessons();
    if (lessonsPrompt) {
      prompt += lessonsPrompt;
      console.log('✅ 已加载踩坑经验到系统提示');
    }
    
    return prompt;
  }

  /**
   * 获取系统提示
   */
  getSystemPrompt() {
    return this.systemPrompt;
  }

  /**
   * 获取 Skill 列表
   */
  getSkillsList() {
    return this.skills.map(s => ({
      name: s.name,
      description: s.description,
      tools: s.tools || []
    }));
  }

  /**
   * 读取特定 Skill 的参考文档
   */
  getReference(skillName, refName) {
    const skill = this.skills.find(s => s.name === skillName);
    if (!skill) return null;
    
    const refPath = path.join(SKILLS_DIR, skill.path, skill.references || 'references', `${refName}.md`);
    if (!existsSync(refPath)) return null;
    
    return readFileSync(refPath, 'utf-8');
  }

  /**
   * 列出 Skill 的所有参考文档
   */
  listReferences(skillName) {
    const skill = this.skills.find(s => s.name === skillName);
    if (!skill) return [];
    
    const refDir = path.join( skill.references || 'references');
    if (!existsSync(refDir)) return [];
    
    return readdirSync(refDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  }
}

export default SkillsManager;

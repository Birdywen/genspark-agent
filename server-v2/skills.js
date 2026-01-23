// Skills 加载模块
// 自动加载 skills 目录下的所有 Skill，生成系统提示

import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

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
   * 生成系统提示
   */
  _generateSystemPrompt() {
    let envInfo = '';
    
    // 尝试读取本地环境信息
    const envPath = path.join(__dirname, '..', '..', '.ai-env.md');
    console.log('🔍 检查环境文件:', envPath, '存在:', existsSync(envPath));
    if (existsSync(envPath)) {
      envInfo = readFileSync(envPath, 'utf-8') + '\n\n---\n\n';
      console.log('✅ 已加载本地环境信息 (.ai-env.md), 长度:', envInfo.length);
    } else {
      console.log('⚠️ 环境文件不存在');
    }
    
    // 尝试读取预生成的系统提示
    const promptPath = path.join(SKILLS_DIR, 'SYSTEM_PROMPT_SKILLS.md');
    if (existsSync(promptPath)) {
      return envInfo + readFileSync(promptPath, 'utf-8');
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
    
    prompt += '\n如需使用 Skill，可读取 `skills/<skill-name>/SKILL.md` 获取详细指南。\n';
    
    return envInfo + prompt;
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
    
    const refDir = path.join(SKILLS_DIR, skill.path, skill.references || 'references');
    if (!existsSync(refDir)) return [];
    
    return readdirSync(refDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  }
}

export default SkillsManager;

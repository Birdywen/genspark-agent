#!/usr/bin/env node
/**
 * Newzik 自动登录脚本
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SECRETS_FILE = path.join(process.env.HOME, '.agent_secrets');

function loadSecrets() {
  const content = fs.readFileSync(SECRETS_FILE, 'utf-8');
  const secrets = {};
  content.split('\n').forEach(line => {
    // 支持带引号和不带引号的值
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      let value = match[2];
      // 去掉可能的引号
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      secrets[match[1]] = value;
    }
  });
  return secrets;
}

function updateSecret(key, value) {
  let content = fs.readFileSync(SECRETS_FILE, 'utf-8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trim() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(SECRETS_FILE, content);
  console.log(`✓ Updated ${key}`);
}

async function login() {
  const secrets = loadSecrets();
  const username = secrets.NEWZIK_USERNAME;
  const password = secrets.NEWZIK_PASSWORD;
  
  if (!username || !password) {
    console.error('Error: NEWZIK_USERNAME and NEWZIK_PASSWORD required');
    process.exit(1);
  }
  
  console.log(`Logging in as ${username}...`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  let tokenObtained = false;
  
  // 监听 token 响应
  page.on('response', async (res) => {
    const url = res.url();
    
    if (url.includes('/oauth/token') && res.status() === 200) {
      try {
        const data = await res.json();
        if (data.access_token && !tokenObtained) {
          tokenObtained = true;
          updateSecret('NEWZIK_ACCESS_TOKEN', data.access_token);
          if (data.uuid) updateSecret('NEWZIK_USER_UUID', data.uuid);
          if (data.refresh_token) updateSecret('NEWZIK_REFRESH_TOKEN', data.refresh_token);
          console.log('\n✓ Token captured!');
        }
      } catch(e) {}
    }
  });
  
  try {
    await page.goto('https://prod.newzik.com/uaa/oauth/authorize?response_type=code&client_id=newzik&redirect_uri=https://web.newzik.com&scope=MUSICIAN');
    await page.waitForSelector('.sc-eCImPb', { timeout: 10000 });
    console.log('✓ Login page loaded');
    
    await page.fill('.sc-eCImPb:nth-child(1) .sc-gKclnd', username);
    await page.fill('.sc-eCImPb:nth-child(2) .sc-gKclnd', password);
    console.log('✓ Credentials filled');
    
    await page.click('button.sc-hKwDye');
    console.log('✓ Login clicked');
    
    await page.waitForURL('**/web.newzik.com/**', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);
    
    if (tokenObtained) {
      console.log('\n✓ Login successful! Token saved to ~/.agent_secrets');
    } else {
      console.log('\n✗ Failed to obtain token');
      console.log('Final URL:', page.url());
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

async function checkToken() {
  const secrets = loadSecrets();
  const token = secrets.NEWZIK_ACCESS_TOKEN;
  
  if (!token) {
    console.log('No token found');
    return false;
  }
  
  try {
    const res = await fetch('https://prod.newzik.com/ws4/user/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-nz-product': 'com.syncsing.Newzik4',
        'Accept': 'application/json',
        'Origin': 'https://web.newzik.com'
      }
    });
    
    if (res.ok) {
      const user = await res.json();
      console.log(`✓ Token valid: ${user.name} (${user.email})`);
      return true;
    } else {
      console.log('✗ Token invalid, status:', res.status);
      return false;
    }
  } catch (error) {
    console.error('Error checking token:', error.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    await checkToken();
  } else if (args.includes('--force') || !(await checkToken())) {
    await login();
  } else {
    console.log('Token valid. Use --force to refresh.');
  }
}

main();

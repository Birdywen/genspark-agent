const https = require('https');

class CaptchaSolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async solve(siteKey, pageUrl) {
    console.log('Solving reCAPTCHA v2...');
    
    // Step 1: 创建任务
    const createTask = {
      clientKey: this.apiKey,
      task: {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey
      }
    };
    
    console.log('Creating task...');
    const createResult = await this.post('https://api.2captcha.com/createTask', createTask);
    
    if (createResult.errorId !== 0) {
      throw new Error(`2Captcha error: ${createResult.errorCode} - ${createResult.errorDescription}`);
    }
    
    const taskId = createResult.taskId;
    console.log('Task ID:', taskId);
    
    // Step 2: 等待结果
    for (let i = 0; i < 30; i++) {
      await this.sleep(5000);
      console.log(`Waiting... (${i + 1}/30)`);
      
      const result = await this.post('https://api.2captcha.com/getTaskResult', {
        clientKey: this.apiKey,
        taskId: taskId
      });
      
      if (result.status === 'ready') {
        console.log('Solved!');
        return result.solution.gRecaptchaResponse;
      }
      
      if (result.errorId !== 0) {
        throw new Error(`2Captcha error: ${result.errorCode}`);
      }
    }
    
    throw new Error('2Captcha timeout');
  }

  post(url, data) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON: ' + data));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = CaptchaSolver;

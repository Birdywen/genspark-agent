content = open('/Users/yay/workspace/genspark-agent/extension/content.js').read()

old_poll = '''        async pollProjectStatus(projectId, auth, onUpdate) {
          const startTime = Date.now();
          
          while (Date.now() - startTime < this.config.maxPollTime) {
            try {
              const project = await this.opusApiCall('GET', `/project/${projectId}`, null, auth);
              
              if (onUpdate) onUpdate(project.stage, project);
      
              if (project.stage === 'EDITOR' && project.resultVideo) {
                return project;
              }
      
              if (project.stage === 'FAILED' || project.stage === 'ERROR') {
                throw new Error('Project failed: ' + (project.error || project.stage));
              }
            } catch (e) {
              // Token 可能过期，尝试刷新
              if (e.message.includes('401')) {
                throw new Error('Token expired during polling. Please refresh opus.pro login.');
              }
              throw e;
            }
      
            await new Promise(r => setTimeout(r, this.config.pollInterval));
          }
      
          throw new Error('Polling timeout: video generation took too long');
        },'''

new_poll = '''        async pollProjectStatus(projectId, auth, onUpdate) {
          const startTime = Date.now();
          let consecutiveErrors = 0;
          
          while (Date.now() - startTime < this.config.maxPollTime) {
            try {
              // Re-fetch token each poll cycle (may have been refreshed)
              let currentAuth = auth;
              try {
                currentAuth = await this.getOpusToken();
              } catch(tokenErr) {
                // Token expired, wait and retry
                if (onUpdate) onUpdate('TOKEN_EXPIRED - please login opus.pro', null);
                await new Promise(r => setTimeout(r, 60000)); // wait 1 min
                continue;
              }
              
              const project = await this.opusApiCall('GET', `/project/${projectId}`, null, currentAuth);
              consecutiveErrors = 0;
              
              if (onUpdate) onUpdate(project.stage, project);
      
              if (project.stage === 'EDITOR' && project.resultVideo) {
                return project;
              }
      
              if (project.stage === 'FAILED' || project.stage === 'ERROR') {
                throw new Error('Project failed: ' + (project.error || project.stage));
              }
            } catch (e) {
              consecutiveErrors++;
              if (e.message.includes('401') || e.message.includes('Unauthorized')) {
                if (onUpdate) onUpdate('⚠️ Token expired, retrying in 60s... (login opus.pro to refresh)', null);
                await new Promise(r => setTimeout(r, 60000));
                if (consecutiveErrors > 10) {
                  throw new Error('Too many auth failures. Please login opus.pro and retry.');
                }
                continue;
              }
              if (consecutiveErrors > 5) throw e;
              if (onUpdate) onUpdate('⚠️ Error: ' + e.message + ', retrying...', null);
            }
      
            await new Promise(r => setTimeout(r, this.config.pollInterval));
          }
      
          throw new Error('Polling timeout: video generation took too long');
        },'''

if old_poll in content:
    content = content.replace(old_poll, new_poll)
    open('/Users/yay/workspace/genspark-agent/extension/content.js', 'w').write(content)
    print('SUCCESS: updated pollProjectStatus with token retry logic')
else:
    print('ERROR: old poll not found')
    idx = content.find('async pollProjectStatus')
    print('found at:', idx)
    if idx > -1:
        print(repr(content[idx:idx+100]))

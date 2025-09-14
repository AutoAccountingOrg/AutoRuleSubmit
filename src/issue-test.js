const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 创建一个支持选项的execAsync
const execAsync = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

class IssueTester {
  constructor(token, issueOwner, issueRepo, testOwner, testRepo) {
    this.token = token;
    this.issueOwner = issueOwner;  // issue来源仓库的owner
    this.issueRepo = issueRepo;    // issue来源仓库的repo
    this.testOwner = testOwner;    // 测试仓库的owner
    this.testRepo = testRepo;      // 测试仓库的repo
    this.octokit = require('@octokit/rest').Octokit;
    this.client = new this.octokit({ auth: token });
  }

  // 克隆测试仓库到本地
  async cloneTestRepository() {
    const repoPath = path.join(process.cwd(), 'temp-test-repo');
    
    // 如果目录已存在，先删除
    if (fs.existsSync(repoPath)) {
      await execAsync(`rm -rf "${repoPath}"`);
    }

    console.log('📥 正在克隆测试仓库...');
    
    try {
      // 使用token克隆私有仓库
      const cloneUrl = `https://${this.token}@github.com/${this.testOwner}/${this.testRepo}.git`;
      await execAsync(`git clone ${cloneUrl} "${repoPath}"`);
      console.log('✅ 测试仓库克隆成功');
      return repoPath;
    } catch (error) {
      console.error('❌ 克隆测试仓库失败:', error.message);
      throw error;
    }
  }

  // 获取issue内容（从issue仓库）
  async getIssueContent(issueNumber) {
    try {
      const { data: issue } = await this.client.issues.get({
        owner: this.issueOwner,
        repo: this.issueRepo,
        issue_number: issueNumber
      });
      
      console.log(`📋 获取到 Issue #${issueNumber}: ${issue.title}`);
      return issue.body;
    } catch (error) {
      console.error('❌ 获取issue内容失败:', error.message);
      throw error;
    }
  }

  // 提取数据URI
  async extractDataUri(issueContent) {



    const pattern = /\[数据过期时间：(.+?)]\((https?:\/\/[^\s)]+)\)/;
    const match = issueContent.match(pattern);

    if (match) {
      const expiryDate = match[1];
      const uri = match[2];
      console.log(`📅 数据过期时间: ${expiryDate}`);
      console.log(`🔗 URI: ${uri}`);

      try {
        const response = await new Promise((resolve, reject) => {
          https.get(uri, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve(data));
          }).on('error', reject);
        });

        console.log('✅ 成功获取数据内容');
        return response;
      } catch (err) {
        console.error('❌ 请求数据失败:', err.message);
        throw err;
      }
    } else {
      console.log('⚠️ 没有匹配到数据URI格式');
      return null;
    }
  }

  // 写入测试文件
  writeTestFile(content, repoPath) {
    const testFilePath = path.join(repoPath, 'src/rule/tests.txt');
    
    // 确保目录存在
    const dir = path.dirname(testFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(testFilePath, content);
    console.log(`📝 写入测试文件: ${testFilePath}`);
  }

  // 构建规则
  async buildRules(repoPath) {
    console.log('🔨 正在构建规则...');
    try {
      await execAsync('yarn install && yarn rollup -c', { cwd: repoPath });
      console.log('✅ 规则构建完成');
    } catch (error) {
      console.error('❌ 规则构建失败:', error.message);
      throw error;
    }
  }

  // 运行测试
  async runTest(repoPath) {
    console.log('🧪 正在运行测试...');
    try {
      const { stdout } = await execAsync('yarn quickTest', { cwd: repoPath });
      console.log('✅ 测试执行完成');
      return stdout;
    } catch (error) {
      console.error('❌ 测试执行失败:', error.message);
      // 返回错误输出，可能包含有用的信息
      return error.stdout || error.message;
    }
  }

  // 提取测试结果
  extractTestResult(output) {
    const match = output.match(/===========START===========([\s\S]*?)===========END===========/);
    return match ? match[1].trim() : null;
  }

  // 处理issue（在issue仓库上添加标签、评论、关闭）
  async handleIssue(issueNumber, resultContent,content) {
    try {

      // 在issue下添加评论
      await this.client.issues.createComment({
        owner: this.issueOwner,
        repo: this.issueRepo,
        issue_number: issueNumber,
        body: `该数据已适配，以下为自动识别的结果:
\`\`\`json
${resultContent}
\`\`\` 

如果您发现该数据未匹配，您可以做如下尝试：
    1. 更新自动记账到最新版：https://github.com/AutoAccountingOrg/AutoAccounting/releases
    2. 长按首页 - 规则部分的更新按钮，更新最新的规则，最新的规则版本：![](https://img.shields.io/github/v/release/AutoAccountingOrg/AutoRuleSubmit.svg)
    3. 在自动记账中，检查对应的规则是否被您禁用（开关为关闭状态）
    4. 检查日志中，是否存在错误输出（红色部分），如果有请提交日志至ankio@ankio.net
    5. **等待规则更新**，部分规则仓库已适配但是尚未发布，请等待发布后再试
    6. 注意：自动记账规则自v0.5.7开始实行付费更新，购买地址：https://license.ez-book.org/
    `
      });

      if (content.indexOf('反馈规则识别错误') > 0) {
        //报告bug的不处理
        return
      }
// 添加duplicate标签
      await this.client.issues.addLabels({
        owner: this.issueOwner,
        repo: this.issueRepo,
        issue_number: issueNumber,
        labels: ['duplicate']
      });

      // 关闭issue
      await this.client.issues.update({
        owner: this.issueOwner,
        repo: this.issueRepo,
        issue_number: issueNumber,
        state: 'closed'
      });

      console.log('✅ Issue处理完成');
    } catch (error) {
      console.error('❌ 处理issue失败:', error.message);
      throw error;
    }
  }

  // 测试单个issue
  async testIssue(issueNumber) {
    let repoPath = null;
    
    try {
      // 1. 克隆测试仓库
      repoPath = await this.cloneTestRepository();
      
      // 2. 获取issue内容（从issue仓库）
      const issueContent = await this.getIssueContent(issueNumber);
      
      // 3. 提取数据URI
      const dataContent = await this.extractDataUri(issueContent);
      if (!dataContent) {
        console.log('⚠️ 无法提取数据内容，跳过测试');
        return false;
      }
      
      // 4. 写入测试文件（到测试仓库）
      this.writeTestFile(dataContent, repoPath);
      
      // 5. 构建规则（在测试仓库中）
      await this.buildRules(repoPath);
      
      // 6. 运行测试（在测试仓库中）
      const output = await this.runTest(repoPath);
      
      // 7. 提取测试结果
      const result = this.extractTestResult(output);
      
      if (result) {
        console.log('✅ 测试成功，找到匹配结果');
        console.log('📊 测试结果:', result);
        
        // 8. 处理issue（在issue仓库中）
        await this.handleIssue(issueNumber, result,issueContent);
        return true;
      } else {
        console.log('⚠️ 未找到测试结果');
        return false;
      }
      
    } catch (error) {
      console.error('❌ 测试过程出错:', error.message);
      return false;
    } finally {
      // 清理临时目录
      if (repoPath && fs.existsSync(repoPath)) {
        try {
          await execAsync(`rm -rf "${repoPath}"`);
          console.log('🧹 清理临时目录完成');
        } catch (error) {
          console.warn('⚠️ 清理临时目录失败:', error.message);
        }
      }
    }
  }

  // 测试所有open的issues
  async testAllIssues() {
    let repoPath = null;
    
    try {
      // 1. 克隆测试仓库
      repoPath = await this.cloneTestRepository();
      
      // 2. 获取所有open的issues（从issue仓库）
      console.log('📋 获取所有open的issues...');
      const { data: issues } = await this.client.issues.listForRepo({
        owner: this.issueOwner,
        repo: this.issueRepo,
        state: 'open'
      });
      
      console.log(`📊 找到 ${issues.length} 个open的issues`);
      
      let successCount = 0;
      let failCount = 0;
      
      // 3. 逐个处理issues
      for (const issue of issues) {
        console.log(`\n🔍 处理 Issue #${issue.number}: ${issue.title}`);
        
        try {

          // 提取数据URI
          const dataContent = await this.extractDataUri(issue.body);
          if (!dataContent) {
            console.log(`⚠️ Issue #${issue.number} 无法提取数据内容，跳过`);
            continue;
          }
          
          // 写入测试文件（到测试仓库）
          this.writeTestFile(dataContent, repoPath);
          
          // 构建规则（只在第一次执行，在测试仓库中）
          if (successCount === 0 && failCount === 0) {
            await this.buildRules(repoPath);
          }
          
          // 运行测试（在测试仓库中）
          const output = await this.runTest(repoPath);
          const result = this.extractTestResult(output);
          
          if (result) {
            console.log(`✅ Issue #${issue.number} 测试成功`);
            // 处理issue（在issue仓库中）
            await this.handleIssue(issue.number, result,issue.body);
            successCount++;
          } else {
            console.log(`⚠️ Issue #${issue.number} 未找到测试结果`);
            failCount++;
          }
          
        } catch (error) {
          console.error(`❌ Issue #${issue.number} 处理失败:`, error.message);
          failCount++;
        }
      }
      
      console.log(`\n📊 测试完成统计:`);
      console.log(`  成功: ${successCount} 个`);
      console.log(`  失败: ${failCount} 个`);
      
      return successCount > 0;
      
    } catch (error) {
      console.error('❌ 批量测试过程出错:', error.message);
      return false;
    } finally {
      // 清理临时目录
      if (repoPath && fs.existsSync(repoPath)) {
        try {
          await execAsync(`rm -rf "${repoPath}"`);
          console.log('🧹 清理临时目录完成');
        } catch (error) {
          console.warn('⚠️ 清理临时目录失败:', error.message);
        }
      }
    }
  }
}

module.exports = IssueTester; 
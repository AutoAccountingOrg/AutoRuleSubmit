const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

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

/**
 * Release 类 - 自动化发布工具
 * 
 * 功能特性：
 * - 克隆仓库并切换到指定commit
 * - 构建项目并打包dist目录
 * - 生成分类的更新日志
 * - 创建GitHub tag和release
 * - 上传构建包及相关信息到指定地址
 * 
 * 上传内容包括：
 * - 构建包文件 (file)
 * - 版本号 (tag)
 * - 更新日志 (changelog)
 * - 构建时间 (buildTime)
 * - 仓库信息 (repo)
 * - Commit数量 (commitCount)
 * - Commit列表 (commits)
 * - 包文件大小 (packageSize)
 * - 包文件MD5 (packageMD5)
 */
class Release {
  constructor(token, owner, repo) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;

    this.runInRepo = "AutoRuleSubmit"

    this.octokit = new Octokit({ auth: token });
    
    // 统一的规则配置
    this.commitRules = [
      { pattern: 'feat:', category: 'features', title: '✨ 新功能' },
      { pattern: 'fix:', category: 'fixes', title: '🐛 修复' },
      { pattern: 'docs:', category: 'docs', title: '📝 文档' },
      { pattern: 'style:', category: 'style', title: '💄 样式' },
      { pattern: 'refactor:', category: 'refactor', title: '♻️ 重构' },
      { pattern: 'perf:', category: 'perf', title: '⚡ 性能' },
      { pattern: 'test:', category: 'test', title: '🧪 测试' },
      { pattern: 'chore:', category: 'chore', title: '🔧 构建' },
    ];
  }

  // 克隆仓库到本地
  async cloneRepository() {
    const repoPath = path.join(process.cwd(), 'temp-release-repo');
    
    // 如果目录已存在，先删除
    if (fs.existsSync(repoPath)) {
      await execAsync(`rm -rf "${repoPath}"`);
    }

    console.log('📥 正在克隆仓库...');
    
    try {
      // 使用token克隆私有仓库
      const cloneUrl = `https://${this.token}@github.com/${this.owner}/${this.repo}.git`;
      await execAsync(`git clone ${cloneUrl} "${repoPath}"`);
      console.log('✅ 仓库克隆成功');
      return repoPath;
    } catch (error) {
      console.error('❌ 克隆仓库失败:', error.message);
      throw error;
    }
  }

  // 切换到指定commit
  async checkoutCommit(repoPath, commitHash) {
    console.log(`🔀 切换到commit: ${commitHash}`);
    try {
      await execAsync(`git checkout ${commitHash}`, { cwd: repoPath });
      console.log('✅ 切换成功');
    } catch (error) {
      console.error('❌ 切换commit失败:', error.message);
      throw error;
    }
  }

  // 获取两个commit之间的差异
  async getCommitsDiff(repoPath, fromCommit, toCommit) {
    console.log(`📊 获取commit差异: ${fromCommit} -> ${toCommit}`);
    try {
      const { stdout } = await execAsync(`git log --oneline ${fromCommit}..${toCommit}`, { cwd: repoPath });
      return stdout.trim().split('\n').filter(line => line.trim());
    } catch (error) {
      console.error('❌ 获取commit差异失败:', error.message);
      throw error;
    }
  }

  // 构建项目
  async buildProject(repoPath) {
    console.log('🔨 正在构建项目...');
    try {
      // 安装依赖
      console.log('📦 安装依赖...');
      await execAsync('yarn install', { cwd: repoPath });
      console.log('✅ 依赖安装完成');

      // 执行构建
      console.log('🔨 执行构建...');
      await execAsync('yarn rollup -c', { cwd: repoPath });
      console.log('✅ 构建完成');
    } catch (error) {
      console.error('❌ 构建失败:', error.message);
      throw error;
    }
  }

  // 打包dist目录
  async packageDist(repoPath, tag) {
    console.log('📦 正在打包dist目录...');
    try {
      const distPath = path.join(repoPath, 'dist');
      const packagePath = path.join(process.cwd(), `${tag}-dist.zip`);

      // 检查dist目录是否存在
      if (!fs.existsSync(distPath)) {
        throw new Error('dist目录不存在，构建可能失败');
      }

      // 创建zip包
      await execAsync(`cd "${repoPath}" && zip -r "${packagePath}" dist/`);
      console.log(`✅ 打包完成: ${packagePath}`);
      return packagePath;
    } catch (error) {
      console.error('❌ 打包失败:', error.message);
      throw error;
    }
  }

  // 推送构建包、更新日志和版本信息到指定地址
  async uploadPackage(packagePath, tag, changelog, commits) {
    console.log('📤 正在上传构建包和相关信息...');
    
    // 硬编码的上传地址
    const uploadUrl = 'https://license.ez-book.org/github';
    const uploadToken = process.env.UPLOAD_TOKEN;
    
    if (!uploadToken) {
      console.log('⚠️ 未提供UPLOAD_TOKEN环境变量，跳过上传');
      return true;
    }
    
    try {
      // 使用 node-fetch 进行更可靠的 HTTP 请求
      const fetch = require('node-fetch');
      const FormData = require('form-data');
      const form = new FormData();
      
      // 添加构建包文件
      form.append('file', fs.createReadStream(packagePath));
      
      // 添加tag版本号
      form.append('tag', tag);
      
      // 添加更新日志
      form.append('changelog', changelog);
      
      // 添加构建时间
      form.append('buildTime', new Date().toISOString());
      form.append('token', uploadToken);

      // 添加额外的元数据
      form.append('commitCount', commits.length.toString());
      form.append('commits', JSON.stringify(commits));
      
      // 获取文件大小
      const stats = fs.statSync(packagePath);
      form.append('packageSize', stats.size.toString());
      
      // 计算文件MD5
      const crypto = require('crypto');
      const fileBuffer = fs.readFileSync(packagePath);
      const hash = crypto.createHash('md5');
      hash.update(fileBuffer);
      const md5 = hash.digest('hex');
      form.append('packageMD5', md5);
      
      // 添加仓库信息
      form.append('repo', `${this.owner}/${this.repo}`);

      console.log('📡 发送请求到:', uploadUrl);
      console.log('📦 文件大小:', stats.size, '字节');
      console.log('🔐 MD5:', md5);
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: form,
        headers: {
          ...form.getHeaders(),
          'User-Agent': 'AutoRuleSubmit-Release/1.0'
        },
        timeout: 60000 // 60秒超时
      });

      console.log('📡 响应状态:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const responseText = await response.text();
      console.log('📡 响应内容:', responseText);

      console.log('✅ 上传成功');
      console.log(`📦 构建包: ${packagePath}`);
      console.log(`🏷️ 版本号: ${tag}`);
      console.log(`📝 更新日志: ${changelog.length} 字符`);
      console.log(`📊 Commit数量: ${commits.length}`);
      return true;
    } catch (error) {
      console.error('❌ 上传失败:', error.message);
      console.error('❌ 错误详情:', error.stack);
      throw error;
    }
  }

  // 生成更新日志
  generateChangelog(commits) {
    console.log('📝 正在生成更新日志...');
    
    // 初始化分类对象
    const changelog = {};
    this.commitRules.forEach(rule => {
      changelog[rule.category] = [];
    });
    changelog.other = [];

    // 分类commit
    commits.forEach(commit => {
      const message = commit.replace(/^[a-f0-9]+ /, ''); // 移除commit hash
      const matchedRule = this.commitRules.find(rule => 
        message.toLowerCase().includes(rule.pattern.toLowerCase())
      );
      
      if (matchedRule) {
        changelog[matchedRule.category].push(message);
      } else {
        changelog.other.push(message);
      }
    });

    // 生成markdown格式的更新日志
    let markdown = '';
    
    // 按规则顺序输出分类
    this.commitRules.forEach(rule => {
      if (changelog[rule.category].length > 0) {
        markdown += `## ${rule.title}\n\n`;
        changelog[rule.category].forEach(message => {
          markdown += `- ${message}\n`;
        });
        markdown += '\n';
      }
    });

    // 输出其他分类
    if (changelog.other.length > 0) {
      markdown += `## 📦 其他\n\n`;
      changelog.other.forEach(message => {
        markdown += `- ${message}\n`;
      });
      markdown += '\n';
    }

    console.log('✅ 更新日志生成完成');
    return markdown;
  }

  // 创建GitHub release
  async createRelease(tag, changelog) {
    console.log(`🏷️ 正在创建release: ${tag}`);
    try {
      const response = await this.octokit.repos.createRelease({
        owner: this.owner,
        repo: this.runInRepo,
        tag_name: tag,
        name: `Release ${tag}`,
        body: changelog,
        draft: false,
        prerelease: false
      });

      console.log('✅ Release创建成功');
      return response.data;
    } catch (error) {
      console.error('❌ 创建release失败:', error.message);
      throw error;
    }
  }

  // 创建tag
  async createTag(tag, commitHash) {
    console.log(`🏷️ 正在创建tag: ${tag}`);
    try {
      const response = await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.runInRepo,
        ref: `refs/tags/${tag}`,
      //  sha: commitHash
      });

      console.log('✅ Tag创建成功');
      return response.data;
    } catch (error) {
      console.error('❌ 创建tag失败:', error.message);
      throw error;
    }
  }

  // 执行完整的release流程
  async executeRelease(tag, fromCommit, toCommit) {
    let repoPath = null;
    let packagePath = null;
    
    try {
      // 1. 克隆仓库
      repoPath = await this.cloneRepository();
      
      // 2. 切换到目标commit
      await this.checkoutCommit(repoPath, toCommit);
      
      // 3. 获取commit差异
      const commits = await this.getCommitsDiff(repoPath, fromCommit, toCommit);
      console.log(`📊 找到 ${commits.length} 个commit`);
      
      // 4. 生成更新日志
      const changelog = this.generateChangelog(commits);
      
      // 5. 构建项目
      await this.buildProject(repoPath);
      
      // 6. 打包dist目录
      packagePath = await this.packageDist(repoPath, tag);
      
      // 7. 上传构建包
      await this.uploadPackage(packagePath, tag, changelog, commits);
      
      // 8. 创建tag
      await this.createTag(tag, toCommit);
      
      // 9. 创建release
      await this.createRelease(tag, changelog);
      
      console.log('🎉 Release流程完成！');
      return true;
      
    } catch (error) {
      console.error('❌ Release流程失败:', error.message);
      return false;
    } finally {
      // 清理临时文件
      if (repoPath && fs.existsSync(repoPath)) {
        try {
          await execAsync(`rm -rf "${repoPath}"`);
          console.log('🧹 清理临时目录完成');
        } catch (error) {
          console.warn('⚠️ 清理临时目录失败:', error.message);
        }
      }
      
      if (packagePath && fs.existsSync(packagePath)) {
        try {
          fs.unlinkSync(packagePath);
          console.log('🧹 清理临时包文件完成');
        } catch (error) {
          console.warn('⚠️ 清理临时包文件失败:', error.message);
        }
      }
    }
  }
}

module.exports = Release; 
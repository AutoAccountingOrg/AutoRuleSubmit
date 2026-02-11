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
      await execAsync('yarn generatedRuleList', { cwd: repoPath });
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

  // 计算文件MD5（流式处理，避免大文件OOM）
  calculateMD5(filePath) {
    return new Promise((resolve, reject) => {
      const crypto = require('crypto');
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  // 推送构建包、更新日志和版本信息到指定地址
  async uploadPackage(packagePath, tag, changelog, commits) {
    console.log('📤 正在上传构建包和相关信息...');
    
    // 硬编码的上传地址
    const uploadUrl = 'http://license.ez-book.org/github';
    const uploadToken = process.env.UPLOAD_TOKEN;
    
    if (!uploadToken) {
      console.log('⚠️ 未提供UPLOAD_TOKEN环境变量，跳过上传');
      return true;
    }
    
    try {
      // 获取文件大小
      const stats = fs.statSync(packagePath);
      console.log('📦 文件大小:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
      
      // 计算文件MD5（流式处理）
      console.log('🔐 正在计算MD5...');
      const md5 = await this.calculateMD5(packagePath);
      console.log('🔐 MD5:', md5);
      
      // 使用 node-fetch 进行 HTTP 请求
      const fetch = require('node-fetch');
      const AbortController = require('abort-controller');
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
      form.append('packageSize', stats.size.toString());
      form.append('packageMD5', md5);
      
      // 添加仓库信息
      form.append('repo', `${this.owner}/${this.repo}`);

      console.log('📡 发送请求到:', uploadUrl);
      
      // 上传进度追踪
      let uploadedBytes = 0;
      const totalBytes = stats.size;
      let lastProgress = 0;
      
      form.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        const progress = Math.floor((uploadedBytes / totalBytes) * 100);
        
        // 每10%输出一次，避免刷屏
        if (progress - lastProgress >= 10) {
          console.log(`📤 上传进度: ${progress}% (${(uploadedBytes / 1024 / 1024).toFixed(2)}MB / ${(totalBytes / 1024 / 1024).toFixed(2)}MB)`);
          lastProgress = progress;
        }
      });
      
      // 设置5分钟超时（正确的方式）
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 300000); // 5分钟
      
      let response;
      try {
        response = await fetch(uploadUrl, {
          method: 'POST',
          body: form,
          headers: {
            ...form.getHeaders(),
            'User-Agent': 'AutoRuleSubmit-Release/1.0'
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

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
      if (error.name === 'AbortError') {
        console.error('❌ 上传超时（5分钟），请检查网络连接');
      } else {
        console.error('❌ 上传失败:', error.message);
        console.error('❌ 错误详情:', error.stack);
      }
      throw error;
    }
  }

  // 文本emoji转真实emoji映射表
  convertEmojiCode(code) {
    const emojiMap = {
      ':sparkles:': '✨',
      ':bug:': '🐛',
      ':memo:': '📝',
      ':lipstick:': '💄',
      ':recycle:': '♻️',
      ':zap:': '⚡',
      ':white_check_mark:': '✅',
      ':wrench:': '🔧',
      ':fire:': '🔥',
      ':rocket:': '🚀',
      ':tada:': '🎉',
      ':construction:': '🚧',
      ':bookmark:': '🔖',
      ':lock:': '🔒',
      ':arrow_up:': '⬆️',
      ':arrow_down:': '⬇️',
      ':globe_with_meridians:': '🌐',
      ':pencil2:': '✏️',
      ':package:': '📦',
      ':alien:': '👽',
      ':truck:': '🚚',
      ':page_facing_up:': '📄',
      ':boom:': '💥',
      ':bento:': '🍱',
      ':wheelchair:': '♿',
      ':bulb:': '💡',
      ':beers:': '🍻',
      ':speech_balloon:': '💬',
      ':card_file_box:': '🗃️',
      ':loud_sound:': '🔊',
      ':mute:': '🔇',
      ':busts_in_silhouette:': '👥',
      ':children_crossing:': '🚸',
      ':building_construction:': '🏗️',
      ':iphone:': '📱',
      ':clown_face:': '🤡',
      ':egg:': '🥚',
      ':see_no_evil:': '🙈',
      ':camera_flash:': '📸',
      ':alembic:': '⚗️',
      ':mag:': '🔍',
      ':label:': '🏷️',
      ':seedling:': '🌱',
      ':triangular_flag_on_post:': '🚩',
      ':goal_net:': '🥅',
      ':dizzy:': '💫',
      ':wastebasket:': '🗑️',
      ':passport_control:': '🛂',
      ':adhesive_bandage:': '🩹',
      ':monocle_face:': '🧐',
      ':coffin:': '⚰️',
      ':test_tube:': '🧪',
      ':necktie:': '👔',
      ':stethoscope:': '🩺',
      ':bricks:': '🧱',
      ':technologist:': '🧑‍💻',
    };
    return emojiMap[code] || code;
  }

  // 生成更新日志
  generateChangelog(commits) {
    console.log('📝 正在生成更新日志...');
    
    // 解析格式: :emoji: (category): content
    const commitPattern = /^:([a-z_]+):\s*\([^)]+\):\s*(.+)$/i;
    
    let markdown = '';

    commits.forEach(commit => {
      const message = commit.replace(/^[a-f0-9]+ /, ''); // 移除commit hash
      const match = message.match(commitPattern);
      
      if (match) {
        const emojiCode = `:${match[1]}:`;
        const content = match[2].trim();
        const emoji = this.convertEmojiCode(emojiCode);
        markdown += `- ${emoji} ${content}\n`;
      } else {
        markdown += `- ${message}\n`;
      }
    });

    console.log('✅ 更新日志生成完成');
    return markdown;
  }

  // 创建GitHub release
  async createRelease(tag, changelog,sha) {
    console.log(`🏷️ 正在创建release: ${tag}`);
    try {
      const response = await this.octokit.repos.createRelease({
        owner: this.owner,
        repo: this.runInRepo,
        tag_name: tag,
        name: `Release ${tag}`,
        body: changelog,
        draft: false,
        prerelease: false,
        sha:sha
      });

      console.log('✅ Release创建成功');
      return response.data;
    } catch (error) {
      console.error('❌ 创建release失败:', error.message);
      throw error;
    }
  }

  // 创建tag
  async createTag(tag, sha) {
    console.log(`🏷️ 正在创建tag: ${tag}`);
    try {
      const response = await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.runInRepo,
        ref: `refs/tags/${tag}`,
       sha: sha
      });

      console.log('✅ Tag创建成功');
      return response.data;
    } catch (error) {
      console.error('❌ 创建tag失败:', error.message);
      throw error;
    }
  }

  // 提交 rules.md 到当前仓库
  async commitRulesMd(repoPath, tag) {
    console.log('📄 正在提交 rules.md...');
    
    const rulesPath = path.join(repoPath, 'rules.md');
    
    if (!fs.existsSync(rulesPath)) {
      console.warn('⚠️ rules.md 不存在，跳过提交');
      return null;
    }

    try {
      const content = fs.readFileSync(rulesPath, 'utf-8');
      const contentBase64 = Buffer.from(content).toString('base64');
      
      // 尝试获取现有文件的 sha（用于更新）
      let existingSha = null;
      try {
        const { data } = await this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.runInRepo,
          path: 'rules.md'
        });
        existingSha = data.sha;
      } catch (e) {
        // 文件不存在，将创建新文件
      }

      const params = {
        owner: this.owner,
        repo: this.runInRepo,
        path: 'rules.md',
        message: `docs: 更新规则列表 ${tag}`,
        content: contentBase64
      };

      if (existingSha) {
        params.sha = existingSha;
      }

      const response = await this.octokit.repos.createOrUpdateFileContents(params);
      
      console.log('✅ rules.md 提交成功');
      return response.data.commit.sha;
    } catch (error) {
      console.error('❌ 提交 rules.md 失败:', error.message);
      throw error;
    }
  }

  // 通过 bot 发送通知
  async sendBotNotification(tag, changelog, commits) {
    const botUrl = process.env.BOT_URL;
    const groupId = process.env.BOT_GROUP_ID;
    
    if (!botUrl || !groupId) {
      console.log('⚠️ 未提供 BOT_URL 或 BOT_GROUP_ID 环境变量，跳过通知');
      return;
    }

    console.log('📢 正在发送 bot 通知...');
    
    try {
      const fetch = require('node-fetch');
      
      // 构建通知消息
      const msg = `🎉 自动记账规则新版本发布: ${tag}\n\n` +
        `📦 仓库: ${this.owner}/${this.repo}\n` +
        `📊 提交数: ${commits.length}\n\n` +
        `${changelog}\n\n`+ `如需更新请先确保您已经购买 规则更新计划 。\n\n`;
      
      const params = new URLSearchParams();
      params.append('msg', msg);
      params.append('group_id', groupId);

      const response = await fetch(botUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AutoRuleSubmit-Release/1.0'
        },
        body: params.toString(),
        timeout: 300000
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      console.log('✅ Bot 通知发送成功');
    } catch (error) {
      console.warn('⚠️ Bot 通知发送失败:', error.message);
      // 通知失败不影响整体流程
    }
  }

  // 执行完整的release流程
  async executeRelease(tag, fromCommit, toCommit, sha) {
    let repoPath = null;
    let packagePath = null;
    let changelog = '';
    let commits = [];
    
    try {
      // 1. 克隆仓库
      repoPath = await this.cloneRepository();
      
      // 2. 切换到目标commit
      await this.checkoutCommit(repoPath, toCommit);
      
      // 3. 获取commit差异
      commits = await this.getCommitsDiff(repoPath, fromCommit, toCommit);
      console.log(`📊 找到 ${commits.length} 个commit`);
      
      // 4. 生成更新日志
      changelog = this.generateChangelog(commits);
      
      // 5. 构建项目
      await this.buildProject(repoPath);
      
      // 6. 打包dist目录
      packagePath = await this.packageDist(repoPath, tag);
      
      // 7. 上传构建包
      await this.uploadPackage(packagePath, tag, changelog, commits);
      
      // 8. 提交 rules.md 到当前仓库
      const newSha = await this.commitRulesMd(repoPath, tag);
      const tagSha = newSha || sha;
      
      // 9. 创建tag
      await this.createTag(tag, tagSha);
      
      // 10. 创建release
      await this.createRelease(tag, changelog, tagSha);
      
      // 11. 发送 bot 通知
      await this.sendBotNotification(tag, changelog, commits);
      
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